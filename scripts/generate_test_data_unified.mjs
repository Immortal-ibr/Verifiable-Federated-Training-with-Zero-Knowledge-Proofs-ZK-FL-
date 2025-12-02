#!/usr/bin/env node
/**
 * Generate test data for UNIFIED Component A (Balance)
 * 
 * CRITICAL: This generates the SAME Merkle tree structure as Component B (Training)
 *   leaf = VectorHash(features || label)
 * 
 * This ensures root_D is identical in both components.
 */

import { buildPoseidon } from 'circomlibjs';
import fs from 'fs';

const N = 8;              // Number of samples  
const DEPTH = 3;          // Merkle tree depth (2^3 = 8)
const MODEL_DIM = 4;      // Feature dimension
const CHUNK_SIZE = 16;    // VectorHash chunk size

async function main() {
    const poseidon = await buildPoseidon();
    const F = poseidon.F;
    
    console.log("=".repeat(70));
    console.log("UNIFIED COMPONENT A TEST - Balance with VectorHash Leaves");
    console.log("=".repeat(70));
    
    // ═══════════════════════════════════════════════════════════════════════
    // STEP 1: Generate synthetic dataset (features + labels)
    // ═══════════════════════════════════════════════════════════════════════
    
    // Labels: 3 zeros, 5 ones (for balance proof)
    const labels = [0, 1, 1, 0, 1, 1, 1, 0];
    
    // Generate random features (scaled integers as in Component B)
    // Using small values for testing (1000x scaled)
    const features = [];
    for (let i = 0; i < N; i++) {
        const row = [];
        for (let j = 0; j < MODEL_DIM; j++) {
            // Random feature value between 0 and 10000 (representing 0.0 to 10.0)
            row.push(Math.floor(Math.random() * 10000));
        }
        features.push(row);
    }
    
    console.log(`\nDataset Configuration:`);
    console.log(`  N = ${N} samples`);
    console.log(`  MODEL_DIM = ${MODEL_DIM} features`);
    console.log(`  DEPTH = ${DEPTH} (tree supports 2^${DEPTH} = ${Math.pow(2, DEPTH)} leaves)`);
    console.log(`\nLabels: ${JSON.stringify(labels)}`);
    console.log(`  c0 (zeros): ${labels.filter(x => x === 0).length}`);
    console.log(`  c1 (ones):  ${labels.filter(x => x === 1).length}`);
    
    console.log(`\nFeatures (first 2 samples):`);
    for (let i = 0; i < Math.min(2, N); i++) {
        console.log(`  Sample ${i}: [${features[i].join(', ')}]`);
    }
    
    // ═══════════════════════════════════════════════════════════════════════
    // STEP 2: Compute leaf hashes using VectorHash(features || label)
    // This MUST match the circuit's VectorHash implementation
    // ═══════════════════════════════════════════════════════════════════════
    
    /**
     * VectorHash implementation matching the circuit:
     * - For DIM <= 16: Poseidon(all values)
     * - For DIM > 16: Poseidon(Poseidon(chunk0), Poseidon(chunk1), ...)
     */
    function vectorHash(values) {
        const DIM = values.length;
        
        if (DIM <= CHUNK_SIZE) {
            // Direct hash - all values fit in one Poseidon call
            const hash = poseidon(values.map(v => BigInt(v)));
            return F.toObject(hash).toString();
        } else {
            // Chunked hash
            const numChunks = Math.ceil(DIM / CHUNK_SIZE);
            const chunkHashes = [];
            
            for (let c = 0; c < numChunks; c++) {
                const start = c * CHUNK_SIZE;
                const end = Math.min(start + CHUNK_SIZE, DIM);
                const chunk = values.slice(start, end);
                
                // Pad chunk to CHUNK_SIZE with zeros
                while (chunk.length < CHUNK_SIZE) {
                    chunk.push(0);
                }
                
                const chunkHash = poseidon(chunk.map(v => BigInt(v)));
                chunkHashes.push(F.toObject(chunkHash));
            }
            
            // Hash all chunk hashes together
            const finalHash = poseidon(chunkHashes);
            return F.toObject(finalHash).toString();
        }
    }
    
    console.log("\nComputing leaf hashes with VectorHash(features || label)...");
    
    const leafHashes = [];
    for (let i = 0; i < N; i++) {
        // Concatenate features || label
        const leafData = [...features[i], labels[i]];
        const leafHash = vectorHash(leafData);
        leafHashes.push(leafHash);
        console.log(`  Leaf ${i}: VectorHash([${features[i].slice(0, 2).join(', ')}...] || ${labels[i]}) = ${leafHash.slice(0, 20)}...`);
    }
    
    // ═══════════════════════════════════════════════════════════════════════
    // STEP 3: Build Merkle tree (bottom-up)
    // ═══════════════════════════════════════════════════════════════════════
    
    // Pad to power of 2
    const paddedN = 2 ** DEPTH;
    const paddedLeaves = [...leafHashes];
    
    // Pad with hash of zero vector
    const zeroLeafData = new Array(MODEL_DIM + 1).fill(0);
    const zeroLeafHash = vectorHash(zeroLeafData);
    while (paddedLeaves.length < paddedN) {
        paddedLeaves.push(zeroLeafHash);
    }
    
    console.log("\nBuilding Merkle tree...");
    const tree = [paddedLeaves];
    let currentLevel = paddedLeaves;
    
    while (currentLevel.length > 1) {
        const nextLevel = [];
        for (let i = 0; i < currentLevel.length; i += 2) {
            const left = currentLevel[i];
            const right = currentLevel[i + 1];
            const hash = poseidon([BigInt(left), BigInt(right)]);
            nextLevel.push(F.toObject(hash).toString());
        }
        tree.push(nextLevel);
        currentLevel = nextLevel;
    }
    
    const root = tree[tree.length - 1][0];
    console.log(`  Tree levels: ${tree.length}`);
    console.log(`  Root (root_D): ${root.slice(0, 30)}...`);
    
    // ═══════════════════════════════════════════════════════════════════════
    // STEP 4: Generate Merkle proofs for all leaves
    // ═══════════════════════════════════════════════════════════════════════
    
    console.log("\nGenerating Merkle proofs...");
    const allSiblings = [];
    const allPathIndices = [];
    
    for (let leafIndex = 0; leafIndex < N; leafIndex++) {
        const siblings = [];
        const pathIndices = [];
        let currentIndex = leafIndex;
        
        for (let level = 0; level < DEPTH; level++) {
            const isRight = currentIndex % 2;
            pathIndices.push(isRight);
            
            const siblingIndex = isRight ? currentIndex - 1 : currentIndex + 1;
            siblings.push(tree[level][siblingIndex]);
            
            currentIndex = Math.floor(currentIndex / 2);
        }
        
        allSiblings.push(siblings);
        allPathIndices.push(pathIndices);
        console.log(`  Proof ${leafIndex}: path=${JSON.stringify(pathIndices)}`);
    }
    
    // ═══════════════════════════════════════════════════════════════════════
    // STEP 5: Create circuit input
    // ═══════════════════════════════════════════════════════════════════════
    
    const circuitInput = {
        client_id: "1",
        root: root,
        N_public: N.toString(),
        c0: labels.filter(x => x === 0).length.toString(),
        c1: labels.filter(x => x === 1).length.toString(),
        features: features.map(row => row.map(v => v.toString())),
        labels: labels.map(b => b.toString()),
        siblings: allSiblings,
        pathIndices: allPathIndices.map(path => path.map(p => p.toString()))
    };
    
    // Save to file
    const outputFile = "test_input_unified.json";
    fs.writeFileSync(outputFile, JSON.stringify(circuitInput, null, 2));
    
    console.log(`\n${"=".repeat(70)}`);
    console.log("CIRCUIT INPUT SUMMARY");
    console.log("=".repeat(70));
    console.log(`\n✅ Test input saved to: ${outputFile}`);
    console.log(`\nPublic inputs:`);
    console.log(`  client_id: ${circuitInput.client_id}`);
    console.log(`  root (root_D): ${circuitInput.root.slice(0, 30)}...`);
    console.log(`  N_public: ${circuitInput.N_public}`);
    console.log(`  c0: ${circuitInput.c0}`);
    console.log(`  c1: ${circuitInput.c1}`);
    console.log(`\nPrivate witness size:`);
    console.log(`  features: ${circuitInput.features.length} x ${circuitInput.features[0].length} values`);
    console.log(`  labels: ${circuitInput.labels.length} values`);
    console.log(`  siblings: ${circuitInput.siblings.length} x ${circuitInput.siblings[0].length} hashes`);
    console.log(`  pathIndices: ${circuitInput.pathIndices.length} x ${circuitInput.pathIndices[0].length} bits`);
    
    // ═══════════════════════════════════════════════════════════════════════
    // STEP 6: Verify proofs locally (sanity check)
    // ═══════════════════════════════════════════════════════════════════════
    
    console.log(`\n${"=".repeat(70)}`);
    console.log("LOCAL MERKLE PROOF VERIFICATION");
    console.log("=".repeat(70));
    
    let allValid = true;
    for (let i = 0; i < N; i++) {
        let currentHash = leafHashes[i];
        
        for (let j = 0; j < DEPTH; j++) {
            const sibling = allSiblings[i][j];
            const isRight = allPathIndices[i][j];
            
            const left = isRight ? sibling : currentHash;
            const right = isRight ? currentHash : sibling;
            
            const hash = poseidon([BigInt(left), BigInt(right)]);
            currentHash = F.toObject(hash).toString();
        }
        
        const valid = currentHash === root;
        const status = valid ? "✓" : "✗";
        console.log(`  Proof ${i} (label=${labels[i]}): ${status}`);
        
        if (!valid) allValid = false;
    }
    
    if (allValid) {
        console.log("\n✅ All Merkle proofs verify correctly!");
    } else {
        console.log("\n❌ Some proofs failed verification");
        process.exit(1);
    }
    
    // ═══════════════════════════════════════════════════════════════════════
    // STEP 7: Show how this binds to Component B
    // ═══════════════════════════════════════════════════════════════════════
    
    console.log(`\n${"=".repeat(70)}`);
    console.log("BINDING TO COMPONENT B (TRAINING)");
    console.log("=".repeat(70));
    console.log(`
This root_D can be used in BOTH:
  
  ┌─────────────────────────────────────────────────────────────┐
  │ Component A (Balance Proof)                                 │
  │   public input: root = ${root.slice(0, 20)}...
  │   proves: dataset has ${circuitInput.c0} zeros, ${circuitInput.c1} ones          │
  └─────────────────────────────────────────────────────────────┘
                              ↕ SAME ROOT
  ┌─────────────────────────────────────────────────────────────┐
  │ Component B (Training Proof)                                │
  │   public input: root_D = ${root.slice(0, 20)}...
  │   proves: batch came from this dataset                      │
  └─────────────────────────────────────────────────────────────┘

Security guarantee:
  If balance_proof.root === training_proof.root_D
  THEN the trained data IS the balanced data! ✓
`);
    
    console.log("=".repeat(70));
    console.log("✅ UNIFIED TEST DATA GENERATION COMPLETE");
    console.log("=".repeat(70));
}

main().catch(console.error);
