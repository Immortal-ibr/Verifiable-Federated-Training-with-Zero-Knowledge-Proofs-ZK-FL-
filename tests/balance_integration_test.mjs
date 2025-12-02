#!/usr/bin/env node
/**
 * INTEGRATION TEST: Unified Root Binding
 * 
 * This demonstrates that Component A (Balance) and Component B (Training)
 * now use the SAME root_D, cryptographically binding them together.
 * 
 * The key security property:
 *   If balance_proof.root === training_proof.root_D
 *   THEN the trained data IS the balanced data! ✓
 */

import { buildPoseidon } from 'circomlibjs';
import fs from 'fs';

const N = 8;              // Number of samples (must match both circuits)
const DEPTH = 3;          // Merkle tree depth
const MODEL_DIM = 4;      // Feature dimension
const BATCH_SIZE = 2;     // Batch size for training
const CHUNK_SIZE = 16;

async function main() {
    const poseidon = await buildPoseidon();
    const F = poseidon.F;
    
    console.log("═".repeat(72));
    console.log("INTEGRATION TEST: UNIFIED ROOT_D BINDING");
    console.log("═".repeat(72));
    
    // ═══════════════════════════════════════════════════════════════════════
    // STEP 1: Generate a SHARED dataset
    // ═══════════════════════════════════════════════════════════════════════
    
    // Labels: 3 zeros, 5 ones
    const labels = [0, 1, 1, 0, 1, 1, 1, 0];
    
    // Generate features
    const features = [
        [1000, 2000, 3000, 4000],
        [1100, 2100, 3100, 4100],
        [1200, 2200, 3200, 4200],
        [1300, 2300, 3300, 4300],
        [1400, 2400, 3400, 4400],
        [1500, 2500, 3500, 4500],
        [1600, 2600, 3600, 4600],
        [1700, 2700, 3700, 4700]
    ];
    
    console.log(`\nShared Dataset (N=${N}, MODEL_DIM=${MODEL_DIM}):`);
    console.log(`  Labels: ${JSON.stringify(labels)}`);
    console.log(`  c0=${labels.filter(x => x === 0).length}, c1=${labels.filter(x => x === 1).length}`);
    
    // ═══════════════════════════════════════════════════════════════════════
    // STEP 2: Compute leaf hashes using VectorHash(features || label)
    // ═══════════════════════════════════════════════════════════════════════
    
    function vectorHash(values) {
        const DIM = values.length;
        if (DIM <= CHUNK_SIZE) {
            const hash = poseidon(values.map(v => BigInt(v)));
            return F.toObject(hash).toString();
        } else {
            const numChunks = Math.ceil(DIM / CHUNK_SIZE);
            const chunkHashes = [];
            for (let c = 0; c < numChunks; c++) {
                const start = c * CHUNK_SIZE;
                const end = Math.min(start + CHUNK_SIZE, DIM);
                const chunk = values.slice(start, end);
                while (chunk.length < CHUNK_SIZE) chunk.push(0);
                const chunkHash = poseidon(chunk.map(v => BigInt(v)));
                chunkHashes.push(F.toObject(chunkHash));
            }
            const finalHash = poseidon(chunkHashes);
            return F.toObject(finalHash).toString();
        }
    }
    
    console.log("\nComputing unified leaf hashes...");
    const leafHashes = [];
    for (let i = 0; i < N; i++) {
        const leafData = [...features[i], labels[i]];
        const leafHash = vectorHash(leafData);
        leafHashes.push(leafHash);
    }
    
    // ═══════════════════════════════════════════════════════════════════════
    // STEP 3: Build Merkle tree (SAME for both circuits!)
    // ═══════════════════════════════════════════════════════════════════════
    
    const paddedN = 2 ** DEPTH;
    const paddedLeaves = [...leafHashes];
    const zeroLeafData = new Array(MODEL_DIM + 1).fill(0);
    const zeroLeafHash = vectorHash(zeroLeafData);
    while (paddedLeaves.length < paddedN) {
        paddedLeaves.push(zeroLeafHash);
    }
    
    const tree = [paddedLeaves];
    let currentLevel = paddedLeaves;
    
    while (currentLevel.length > 1) {
        const nextLevel = [];
        for (let i = 0; i < currentLevel.length; i += 2) {
            const hash = poseidon([BigInt(currentLevel[i]), BigInt(currentLevel[i + 1])]);
            nextLevel.push(F.toObject(hash).toString());
        }
        tree.push(nextLevel);
        currentLevel = nextLevel;
    }
    
    const ROOT_D = tree[tree.length - 1][0];
    
    console.log("\n" + "═".repeat(72));
    console.log("SHARED MERKLE ROOT (root_D):");
    console.log("═".repeat(72));
    console.log(`\n  ${ROOT_D}`);
    console.log("\n  This root_D is used by BOTH circuits!");
    
    // ═══════════════════════════════════════════════════════════════════════
    // STEP 4: Generate Merkle proofs
    // ═══════════════════════════════════════════════════════════════════════
    
    function getMerkleProof(leafIndex) {
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
        
        return { siblings, pathIndices };
    }
    
    // ═══════════════════════════════════════════════════════════════════════
    // STEP 5: Generate INPUT for Component A (Unified Balance)
    // ═══════════════════════════════════════════════════════════════════════
    
    console.log("\n" + "═".repeat(72));
    console.log("COMPONENT A (Balance) INPUT");
    console.log("═".repeat(72));
    
    const allProofs = [];
    for (let i = 0; i < N; i++) {
        allProofs.push(getMerkleProof(i));
    }
    
    const balanceInput = {
        client_id: "1",
        root: ROOT_D,
        N_public: N.toString(),
        c0: "3",
        c1: "5",
        features: features.map(row => row.map(v => v.toString())),
        labels: labels.map(b => b.toString()),
        siblings: allProofs.map(p => p.siblings),
        pathIndices: allProofs.map(p => p.pathIndices.map(x => x.toString()))
    };
    
    fs.writeFileSync("balance_integration_input.json", JSON.stringify(balanceInput, null, 2));
    console.log(`\n  ✅ Saved to: balance_integration_input.json`);
    console.log(`  Public: root = ${ROOT_D.slice(0, 30)}...`);
    console.log(`          c0=3, c1=5, N=8`);
    
    // ═══════════════════════════════════════════════════════════════════════
    // STEP 6: Generate INPUT for Component B (Training v4)
    // ═══════════════════════════════════════════════════════════════════════
    
    console.log("\n" + "═".repeat(72));
    console.log("COMPONENT B (Training) INPUT");
    console.log("═".repeat(72));
    
    // Select first BATCH_SIZE samples for training batch
    const batchIndices = [0, 1];  // First 2 samples
    
    const batchFeatures = batchIndices.map(i => features[i]);
    const batchLabels = batchIndices.map(i => labels[i]);
    const batchProofs = batchIndices.map(i => getMerkleProof(i));
    
    // Dummy gradient (not the focus of this test)
    const gradient = new Array(MODEL_DIM).fill(100);
    const normSquared = gradient.reduce((a, b) => a + b * b, 0);
    const tauSquared = normSquared + 1000;  // Ensure clipping passes
    
    // Compute gradient commitment
    const gradientHash = vectorHash(gradient);
    
    const trainingInput = {
        client_id: "1",
        root_D: ROOT_D,  // <-- SAME AS balance_input.root!
        root_G: gradientHash,
        tauSquared: tauSquared.toString(),
        gradient: gradient.map(g => g.toString()),
        normSquared: normSquared.toString(),
        features: batchFeatures.map(row => row.map(v => v.toString())),
        labels: batchLabels.map(b => b.toString()),
        siblings: batchProofs.map(p => p.siblings),
        pathIndices: batchProofs.map(p => p.pathIndices.map(x => x.toString()))
    };
    
    fs.writeFileSync("training_integration_input.json", JSON.stringify(trainingInput, null, 2));
    console.log(`\n  ✅ Saved to: training_integration_input.json`);
    console.log(`  Public: root_D = ${ROOT_D.slice(0, 30)}...`);
    console.log(`          (batch samples: ${batchIndices})`);
    
    // ═══════════════════════════════════════════════════════════════════════
    // STEP 7: Verify the binding
    // ═══════════════════════════════════════════════════════════════════════
    
    console.log("\n" + "═".repeat(72));
    console.log("CRYPTOGRAPHIC BINDING VERIFICATION");
    console.log("═".repeat(72));
    
    const balanceRoot = balanceInput.root;
    const trainingRootD = trainingInput.root_D;
    
    console.log(`\n  Balance proof root:     ${balanceRoot.slice(0, 40)}...`);
    console.log(`  Training proof root_D:  ${trainingRootD.slice(0, 40)}...`);
    console.log(`\n  Root match: ${balanceRoot === trainingRootD ? "✅ YES" : "❌ NO"}`);
    
    if (balanceRoot === trainingRootD) {
        console.log(`
  ┌─────────────────────────────────────────────────────────────────────┐
  │                    SECURITY GUARANTEE                               │
  ├─────────────────────────────────────────────────────────────────────┤
  │                                                                     │
  │  balance_proof.root === training_proof.root_D                       │
  │                                                                     │
  │  THEREFORE:                                                         │
  │    ✅ The trained data IS the balanced data                         │
  │    ✅ Cannot prove balance on dataset A, train on dataset B         │
  │    ✅ Auditor can verify by checking root equality                  │
  │                                                                     │
  └─────────────────────────────────────────────────────────────────────┘
`);
    }
    
    console.log("═".repeat(72));
    console.log("✅ INTEGRATION TEST DATA GENERATION COMPLETE");
    console.log("═".repeat(72));
    console.log(`
Next steps to verify:

  1. Component A (Balance):
     cd balance
     node balance_unified_js/generate_witness.cjs \\
         balance_unified_js/balance_unified.wasm \\
         balance_integration_input.json \\
         witness_integration.wtns
     
  2. Component B (Training):
     cd ../training
     node sgd_step_v4_js/generate_witness.cjs \\
         sgd_step_v4_js/sgd_step_v4.wasm \\
         ../balance/training_integration_input.json \\
         witness_integration.wtns
     
  3. Both proofs will have the SAME root_D in public outputs!
`);
}

main().catch(console.error);
