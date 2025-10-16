#!/usr/bin/env tsx

/**
 * Complete end-to-end demo of ZK-Balance proof system
 * 
 * This script demonstrates the full workflow:
 *   1. Generate sample dataset
 *   2. Commit to dataset (Merkle tree)
 *   3. Generate ZK proof
 *   4. Verify proof and check fairness
 */

import { parse } from 'csv-parse/sync';
import { stringify } from 'csv-stringify/sync';
import fs from 'fs/promises';
import { initPoseidon, toDecimalString } from '../src/hash.js';
import { buildMerkleTreeFromBits } from '../src/merkle.js';
import { checkBalance, printBanner, formatPercentage } from '../src/utils.js';

async function demo() {
  printBanner('ZK-Balance Demo');

  console.log('This demo shows a complete zero-knowledge proof workflow:');
  console.log('  1. Generate dataset with binary group attribute');
  console.log('  2. Commit to dataset using Merkle tree');
  console.log('  3. [Simulated] Generate & verify ZK proof');
  console.log('  4. Check fairness\n');

  // ============ STEP 1: Generate Dataset ============
  console.log('📊 Step 1: Generate Sample Dataset');
  console.log('   Creating 128 rows with ~50/50 balance...\n');

  const N = 128;
  const bits: number[] = [];
  
  for (let i = 0; i < N; i++) {
    bits.push(Math.random() < 0.5 ? 1 : 0);
  }

  const c0 = bits.filter(b => b === 0).length;
  const c1 = bits.filter(b => b === 1).length;

  console.log(`   ✓ Generated ${N} rows`);
  console.log(`   ✓ Group 0: ${c0} (${formatPercentage(c0/N)})`);
  console.log(`   ✓ Group 1: ${c1} (${formatPercentage(c1/N)})\n`);

  // ============ STEP 2: Commitment ============
  console.log('🔐 Step 2: Commit to Dataset');
  console.log('   Building Merkle tree...\n');

  await initPoseidon();
  const tree = buildMerkleTreeFromBits(bits);

  console.log(`   ✓ Merkle tree built (depth: ${tree.depth})`);
  console.log(`   ✓ Root: ${tree.getRootHex().substring(0, 20)}...\n`);

  // ============ STEP 3: Generate Proof (Simulated) ============
  console.log('🔧 Step 3: Generate ZK Proof');
  console.log('   [SIMULATED - requires full circuit setup]');
  console.log('   In production, this would:');
  console.log('     • Extract Merkle paths for all bits');
  console.log('     • Create witness (private inputs)');
  console.log('     • Run snarkjs.groth16.prove()');
  console.log('     • Output proof.json (~2KB)\n');

  // Show what the witness would look like
  const proofs = tree.getAllProofs();
  const firstProof = proofs[0];

  console.log(`   Example witness structure for first item:`);
  console.log(`     bit: ${bits[0]}`);
  console.log(`     siblings: [${firstProof.siblings.length} hashes]`);
  console.log(`     pathIndices: ${JSON.stringify(firstProof.pathIndices)}\n`);

  // ============ STEP 4: Verify (Simulated) ============
  console.log('✅ Step 4: Verify Proof & Check Fairness');
  console.log('   [SIMULATED - requires full circuit setup]');
  console.log('   In production, this would:');
  console.log('     • Run snarkjs.groth16.verify()');
  console.log('     • Check proof against public inputs\n');

  // We can still do the fairness check
  const balance = checkBalance(c0, c1, 0.1);

  console.log('   Public inputs that would be verified:');
  console.log(`     root: ${tree.getRootHex()}`);
  console.log(`     N: ${N}`);
  console.log(`     c0: ${c0}`);
  console.log(`     c1: ${c1}\n`);

  console.log('   Fairness Check:');
  console.log(`     Threshold: 10% of total`);
  console.log(`     Difference: |${c0} - ${c1}| = ${balance.difference}`);
  console.log(`     Percentage: ${formatPercentage(balance.percentage)}`);
  console.log(`     Result: ${balance.isFair ? '✅ FAIR' : '❌ NOT FAIR'}\n`);

  // ============ Summary ============
  printBanner('Demo Complete');

  console.log('What we demonstrated:');
  console.log('  ✓ Dataset generation with binary attribute');
  console.log('  ✓ Merkle tree commitment (public root)');
  console.log('  ✓ Witness structure for ZK proof');
  console.log('  ✓ Fairness verification\n');

  console.log('What\'s private:');
  console.log('  🔒 Individual row data');
  console.log('  🔒 Per-row group labels');
  console.log('  🔒 Merkle paths\n');

  console.log('What\'s public:');
  console.log('  🌍 Merkle root (commitment)');
  console.log('  🌍 Total count (N)');
  console.log('  🌍 Group counts (c0, c1)');
  console.log('  🌍 ZK proof (succinct)\n');

  console.log('To run with full ZK proofs:');
  console.log('  1. npm run setup:circuits  (one-time setup)');
  console.log('  2. npm run generate-data');
  console.log('  3. npm run commit');
  console.log('  4. npm run prove');
  console.log('  5. npm run verify\n');

  console.log('See PROJECT_OVERVIEW.md and QUICK_REFERENCE.md for details.\n');
}

demo().catch(error => {
  console.error('❌ Demo failed:', error);
  process.exit(1);
});
