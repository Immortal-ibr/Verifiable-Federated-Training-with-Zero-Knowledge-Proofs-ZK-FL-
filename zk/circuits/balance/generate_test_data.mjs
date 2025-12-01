#!/usr/bin/env node
/**
 * Generate test data for Component A using actual Poseidon hash from circomlib
 * This matches the hash function used in the circuit
 */

import { buildPoseidon } from 'circomlibjs';
import fs from 'fs';

async function main() {
    // Initialize Poseidon hash
    const poseidon = await buildPoseidon();
    const F = poseidon.F;
    
    console.log("=".repeat(60));
    console.log("COMPONENT A TEST - Data Generation (Real Poseidon)");
    console.log("=".repeat(60));
    
    // Test dataset: 8 binary labels (3 zeros, 5 ones)
    const labels = [0, 1, 1, 0, 1, 1, 1, 0];
    const N = labels.length;
    const DEPTH = 3; // 2^3 = 8
    
    console.log(`\nDataset: ${JSON.stringify(labels)}`);
    console.log(`Count of 0s (c0): ${labels.filter(x => x === 0).length}`);
    console.log(`Count of 1s (c1): ${labels.filter(x => x === 1).length}`);
    console.log(`Total (N): ${N}`);
    
    // Hash leaves using Poseidon(value)
    console.log("\nHashing leaves with Poseidon...");
    const leafHashes = labels.map(label => {
        const hash = poseidon([label]);
        return F.toObject(hash).toString();
    });
    
    // Pad to power of 2
    const paddedN = 2 ** DEPTH;
    while (leafHashes.length < paddedN) {
        const hash = poseidon([0]);
        leafHashes.push(F.toObject(hash).toString());
    }
    
    // Build Merkle tree
    console.log("Building Merkle tree...");
    const tree = [leafHashes];
    let currentLevel = leafHashes;
    
    while (currentLevel.length > 1) {
        const nextLevel = [];
        for (let i = 0; i < currentLevel.length; i += 2) {
            const left = currentLevel[i];
            const right = currentLevel[i + 1] || currentLevel[i];
            const hash = poseidon([left, right]);
            nextLevel.push(F.toObject(hash).toString());
        }
        tree.push(nextLevel);
        currentLevel = nextLevel;
    }
    
    const root = tree[tree.length - 1][0];
    console.log(`Tree depth: ${DEPTH}`);
    console.log(`Root hash: ${root}`);
    
    // Generate Merkle proofs for all leaves
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
            const sibling = siblingIndex < tree[level].length 
                ? tree[level][siblingIndex] 
                : tree[level][currentIndex];
            
            siblings.push(sibling);
            currentIndex = Math.floor(currentIndex / 2);
        }
        
        allSiblings.push(siblings);
        allPathIndices.push(pathIndices);
        console.log(`  Proof ${leafIndex}: ${siblings.length} siblings, path=${pathIndices}`);
    }
    
    // Create circuit input
    const circuitInput = {
        client_id: "1",
        root: root,
        N_public: N.toString(),
        c0: labels.filter(x => x === 0).length.toString(),
        c1: labels.filter(x => x === 1).length.toString(),
        bits: labels.map(b => b.toString()),
        siblings: allSiblings,
        pathIndices: allPathIndices.map(path => path.map(p => p.toString()))
    };
    
    // Save to file
    const outputFile = "test_input.json";
    fs.writeFileSync(outputFile, JSON.stringify(circuitInput, null, 2));
    
    console.log(`\n✅ Test input saved to: ${outputFile}`);
    console.log(`\nPublic inputs:`);
    console.log(`  client_id: ${circuitInput.client_id}`);
    console.log(`  root: ${circuitInput.root}`);
    console.log(`  N_public: ${circuitInput.N_public}`);
    console.log(`  c0: ${circuitInput.c0}`);
    console.log(`  c1: ${circuitInput.c1}`);
    console.log(`\nPrivate witness size:`);
    console.log(`  bits: ${circuitInput.bits.length} values`);
    console.log(`  siblings: ${circuitInput.siblings.length} x ${circuitInput.siblings[0].length} hashes`);
    console.log(`  pathIndices: ${circuitInput.pathIndices.length} x ${circuitInput.pathIndices[0].length} bits`);
    
    // Verify proofs
    console.log("\n" + "=".repeat(60));
    console.log("VERIFICATION TEST");
    console.log("=".repeat(60));
    
    let allValid = true;
    for (let i = 0; i < N; i++) {
        let currentHash = leafHashes[i];
        
        for (let j = 0; j < DEPTH; j++) {
            const sibling = allSiblings[i][j];
            const isRight = allPathIndices[i][j];
            
            const left = isRight ? sibling : currentHash;
            const right = isRight ? currentHash : sibling;
            
            const hash = poseidon([left, right]);
            currentHash = F.toObject(hash).toString();
        }
        
        const valid = currentHash === root;
        const status = valid ? "✓" : "✗";
        console.log(`  Proof ${i} (bit=${labels[i]}): ${status}`);
        
        if (!valid) allValid = false;
    }
    
    if (allValid) {
        console.log("\n✅ All Merkle proofs verify correctly!");
    } else {
        console.log("\n❌ Some proofs failed verification");
    }
    
    console.log("\n" + "=".repeat(60));
    console.log("✅ TEST DATA GENERATION COMPLETE");
    console.log("=".repeat(60));
}

main().catch(console.error);
