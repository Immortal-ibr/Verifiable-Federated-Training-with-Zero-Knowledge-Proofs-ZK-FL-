#!/usr/bin/env tsx

/**
 * Commit to dataset by building Merkle tree
 * 
 * Usage:
 *   npm run commit -- --input data/sample.csv --output data/root.json
 */

import { program } from 'commander';
import { parse } from 'csv-parse/sync';
import fs from 'fs/promises';
import { initPoseidon } from '../src/hash.js';
import { buildMerkleTreeFromBits } from '../src/merkle.js';
import { writeJSON, calculateDepth } from '../src/utils.js';
import type { Commitment } from '../src/types.js';

async function commitDataset(
  inputPath: string,
  outputPath: string
): Promise<void> {
  console.log(`\n🔐 Committing to dataset...`);
  console.log(`   Input: ${inputPath}`);
  console.log(`   Output: ${outputPath}\n`);

  // Initialize Poseidon hasher
  await initPoseidon();

  // Read CSV
  const csvContent = await fs.readFile(inputPath, 'utf-8');
  const records = parse(csvContent, {
    columns: true,
    skip_empty_lines: true,
  });

  // Extract binary group attribute
  const bits = records.map((r: any) => parseInt(r.group, 10));

  console.log(`✓ Loaded ${bits.length} rows`);

  // Build Merkle tree
  const tree = buildMerkleTreeFromBits(bits);

  console.log(`✓ Built Merkle tree (depth: ${tree.depth})`);
  console.log(`✓ Root: ${tree.getRootHex()}\n`);

  // Create commitment
  const commitment: Commitment = {
    root: tree.getRootHex(),
    rootBigInt: tree.root,
    N: bits.length,
    depth: tree.depth,
    timestamp: Date.now(),
  };

  // Save commitment
  await writeJSON(outputPath, commitment);

  console.log(`✅ Commitment saved to: ${outputPath}\n`);
}

// CLI
program
  .name('commit')
  .description('Commit to dataset using Merkle tree')
  .option('-i, --input <path>', 'Input CSV file', 'data/sample.csv')
  .option('-o, --output <path>', 'Output commitment JSON', 'data/root.json')
  .action(async (options) => {
    try {
      await commitDataset(options.input, options.output);
    } catch (error) {
      console.error('❌ Error:', error);
      process.exit(1);
    }
  });

program.parse();
