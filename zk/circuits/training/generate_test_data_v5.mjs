#!/usr/bin/env node
/**
 * Generate test data for v5 with sign-magnitude decomposition
 * Based on working v4 generator structure
 */

import { buildPoseidon } from 'circomlibjs';
import fs from 'fs';

const BATCH_SIZE = 8;
const MODEL_DIM = 16;
const DEPTH = 7;
const N = 128;
const CHUNK_SIZE = 16;

// BN254 field prime
const p = 21888242871839275222246405745257275088548364400416034343698204186575808495617n;

// Seeded random for reproducibility
let seed = 42;
function seededRandom() {
    seed = (seed * 1103515245 + 12345) & 0x7fffffff;
    return seed / 0x7fffffff;
}

async function main() {
    const poseidon = await buildPoseidon();
    const F = poseidon.F;
    const clientId = 1n;
    const round = 1n;
    
    console.log("═".repeat(60));
    console.log("V5 TEST DATA GENERATION - Sign-Magnitude Decomposition");
    console.log("═".repeat(60));
    
    // VectorHash function (matches circuit)
    function vectorHash(values) {
        if (values.length <= CHUNK_SIZE) {
            const hash = poseidon(values.map(v => BigInt(v)));
            return F.toObject(hash);
        } else {
            const numChunks = Math.ceil(values.length / CHUNK_SIZE);
            const chunkHashes = [];
            for (let c = 0; c < numChunks; c++) {
                const startIdx = c * CHUNK_SIZE;
                const endIdx = Math.min(startIdx + CHUNK_SIZE, values.length);
                const chunk = values.slice(startIdx, endIdx).map(v => BigInt(v));
                const chunkHash = poseidon(chunk);
                chunkHashes.push(F.toObject(chunkHash));
            }
            return F.toObject(poseidon(chunkHashes));
        }
    }
    
    // Generate dataset with fixed-point features
    console.log("\n[1] Generating dataset...");
    const features = [];
    const labels = [];
    for (let i = 0; i < N; i++) {
        const row = [];
        for (let j = 0; j < MODEL_DIM; j++) {
            // Use integer values directly (scaled integers)
            row.push(Math.floor(seededRandom() * 1000));
        }
        features.push(row);
        labels.push(seededRandom() > 0.5 ? 1 : 0);
    }
    console.log(`    Generated ${N} samples with ${MODEL_DIM} features each`);
    
    // Build Merkle tree
    console.log("\n[2] Building Merkle tree...");
    
    // Hash leaves: VectorHash(features || label)
    const leafHashes = [];
    for (let i = 0; i < N; i++) {
        const sampleValues = [...features[i], labels[i]];
        const hash = vectorHash(sampleValues);
        leafHashes.push(hash);
    }
    
    // Pad to 2^DEPTH with zero hash
    const paddedN = 2 ** DEPTH;
    const zeroHash = F.toObject(poseidon([BigInt(0)]));
    while (leafHashes.length < paddedN) {
        leafHashes.push(zeroHash);
    }
    
    // Build tree bottom-up
    const tree = [leafHashes];
    let currentLevel = leafHashes;
    
    while (currentLevel.length > 1) {
        const nextLevel = [];
        for (let i = 0; i < currentLevel.length; i += 2) {
            const left = currentLevel[i];
            const right = currentLevel[i + 1];
            const hash = poseidon([BigInt(left), BigInt(right)]);
            nextLevel.push(F.toObject(hash));
        }
        tree.push(nextLevel);
        currentLevel = nextLevel;
    }
    
    const root_D = tree[tree.length - 1][0];
    console.log(`    root_D: ${root_D.toString().slice(0, 40)}...`);
    
    // Get Merkle proofs for batch
    function getMerkleProof(leafIdx) {
        const siblings = [];
        const pathIndices = [];
        let currentIdx = leafIdx;
        
        for (let level = 0; level < DEPTH; level++) {
            const siblingIdx = currentIdx ^ 1;  // XOR to get sibling
            siblings.push(tree[level][siblingIdx]);
            pathIndices.push(currentIdx % 2);
            currentIdx = Math.floor(currentIdx / 2);
        }
        
        return { siblings, pathIndices };
    }
    
    // Select batch
    console.log("\n[3] Selecting batch...");
    const batchIndices = [0, 1, 2, 3, 4, 5, 6, 7];
    const batchFeatures = batchIndices.map(i => features[i]);
    const batchLabels = batchIndices.map(i => labels[i]);
    const batchProofs = batchIndices.map(i => getMerkleProof(i));
    console.log(`    Batch indices: [${batchIndices.join(', ')}]`);
    
    // Verify Merkle proofs locally before submitting
    console.log("\n[3b] Verifying Merkle proofs locally...");
    let allValid = true;
    for (let i = 0; i < BATCH_SIZE; i++) {
        const leafIdx = batchIndices[i];
        let currentHash = leafHashes[leafIdx];
        const { siblings, pathIndices } = batchProofs[i];
        
        for (let level = 0; level < DEPTH; level++) {
            const sibling = siblings[level];
            const isRight = pathIndices[level];
            
            let left, right;
            if (isRight === 0) {
                left = currentHash;
                right = sibling;
            } else {
                left = sibling;
                right = currentHash;
            }
            
            currentHash = F.toObject(poseidon([BigInt(left), BigInt(right)]));
        }
        
        const valid = currentHash.toString() === root_D.toString();
        console.log(`    Proof ${i}: ${valid ? '✓' : '✗'}`);
        if (!valid) allValid = false;
    }
    
    if (!allValid) {
        console.error("❌ Merkle proof verification failed!");
        process.exit(1);
    }
    console.log("    All proofs verified! ✓");
    
    // Generate gradient with SIGN-MAGNITUDE DECOMPOSITION
    console.log("\n[4] Generating gradient with sign-magnitude decomposition...");
    const gradient = [];
    const gradPos = [];
    const gradNeg = [];
    
    for (let j = 0; j < MODEL_DIM; j++) {
        // Random gradient in range [-100, 100]
        const g = Math.floor(seededRandom() * 200) - 100;
        gradient.push(g);
        
        if (g >= 0) {
            gradPos.push(g);
            gradNeg.push(0);
        } else {
            gradPos.push(0);
            gradNeg.push(-g);  // Store absolute value
        }
    }
    
    // Compute norm squared
    const normSquared = gradient.reduce((sum, g) => sum + g * g, 0);
    const tauSquared = normSquared + 1000;  // Ensure clipping passes
    
    console.log(`    gradient:    [${gradient.slice(0, 5).join(', ')}...]`);
    console.log(`    gradPos:     [${gradPos.slice(0, 5).join(', ')}...]`);
    console.log(`    gradNeg:     [${gradNeg.slice(0, 5).join(', ')}...]`);
    console.log(`    normSquared: ${normSquared}`);
    console.log(`    tauSquared:  ${tauSquared} (norm + 1000 margin)`);
    
    // Commitment helper matches GradientCommitment in-circuit
    function gradientCommitment(gradientValues, clientIdBig, roundBig) {
        const gradHash = vectorHash(gradientValues);
        const metaHash = poseidon([clientIdBig, roundBig]);
        const finalHash = poseidon([gradHash, metaHash]);
        return F.toObject(finalHash);
    }

    // Compute gradient commitment (using field representation)
    console.log("\n[5] Computing gradient commitment...");
    const gradientField = gradient.map(g => g >= 0 ? BigInt(g) : p + BigInt(g));
    const root_G = gradientCommitment(gradientField, clientId, round);
    console.log(`    root_G: ${root_G.toString().slice(0, 40)}...`);
    
    // Build circuit input
    const input = {
        client_id: clientId.toString(),
        round: round.toString(),
        root_D: root_D.toString(),
        root_G: root_G.toString(),
        tauSquared: tauSquared.toString(),
        gradPos: gradPos.map(x => x.toString()),
        gradNeg: gradNeg.map(x => x.toString()),
        features: batchFeatures.map(row => row.map(x => x.toString())),
        labels: batchLabels.map(x => x.toString()),
        siblings: batchProofs.map(p => p.siblings.map(s => s.toString())),
        pathIndices: batchProofs.map(p => p.pathIndices.map(x => x.toString()))
    };
    
    fs.writeFileSync("test_input_v5.json", JSON.stringify(input, null, 2));
    
    console.log("\n" + "═".repeat(60));
    console.log("✅ SAVED: test_input_v5.json");
    console.log("═".repeat(60));
    console.log(`
Public Inputs:
  client_id:  ${input.client_id}
  root_D:     ${input.root_D.slice(0, 30)}...
  root_G:     ${input.root_G.slice(0, 30)}...
  tauSquared: ${input.tauSquared}

Private Inputs:
  gradPos:     ${MODEL_DIM} values (non-negative)
  gradNeg:     ${MODEL_DIM} values (non-negative)
  features:    ${BATCH_SIZE} x ${MODEL_DIM} matrix
  labels:      ${BATCH_SIZE} values
  siblings:    ${BATCH_SIZE} x ${DEPTH} hashes
  pathIndices: ${BATCH_SIZE} x ${DEPTH} bits

Key Security Improvement:
  v4: normSquared was TRUSTED (prover could lie)
  v5: normSquared is COMPUTED from gradPos^2 + gradNeg^2
      Cannot bypass clipping!
`);
}

main().catch(console.error);
