#!/usr/bin/env tsx

/**
 * Generate sample dataset with binary group attribute
 * 
 * Usage:
 *   npm run generate-data -- --rows 200 --balance 0.5 --output data/sample.csv
 */

import { program } from 'commander';
import { stringify } from 'csv-stringify/sync';
import fs from 'fs/promises';
import path from 'path';
import { ensureDir } from '../src/utils.js';

interface DataRow {
  id: number;
  group: number;
  name: string;
}

async function generateDataset(
  numRows: number,
  balance: number,
  outputPath: string
): Promise<void> {
  console.log(`\n🔧 Generating dataset...`);
  console.log(`   Rows: ${numRows}`);
  console.log(`   Balance: ${balance} (${balance * 100}% group 1)`);
  console.log(`   Output: ${outputPath}\n`);

  // Generate data
  const rows: DataRow[] = [];
  
  for (let i = 0; i < numRows; i++) {
    const group = Math.random() < balance ? 1 : 0;
    const name = `Person_${i.toString().padStart(4, '0')}`;
    
    rows.push({ id: i, group, name });
  }

  // Count groups
  const c0 = rows.filter(r => r.group === 0).length;
  const c1 = rows.filter(r => r.group === 1).length;

  console.log(`✓ Generated ${numRows} rows`);
  console.log(`   Group 0: ${c0} (${((c0 / numRows) * 100).toFixed(1)}%)`);
  console.log(`   Group 1: ${c1} (${((c1 / numRows) * 100).toFixed(1)}%)`);

  // Write CSV
  const csv = stringify(rows, {
    header: true,
    columns: ['id', 'group', 'name']
  });

  await ensureDir(path.dirname(outputPath));
  await fs.writeFile(outputPath, csv, 'utf-8');

  console.log(`\n✅ Dataset saved to: ${outputPath}\n`);
}

// CLI
program
  .name('generate-data')
  .description('Generate sample dataset with binary group attribute')
  .option('-r, --rows <number>', 'Number of rows', '200')
  .option('-b, --balance <number>', 'Target balance (0.5 = 50/50)', '0.5')
  .option('-o, --output <path>', 'Output CSV file', 'data/sample.csv')
  .action(async (options) => {
    const numRows = parseInt(options.rows, 10);
    const balance = parseFloat(options.balance);

    if (isNaN(numRows) || numRows <= 0) {
      console.error('❌ Invalid number of rows');
      process.exit(1);
    }

    if (isNaN(balance) || balance < 0 || balance > 1) {
      console.error('❌ Balance must be between 0 and 1');
      process.exit(1);
    }

    try {
      await generateDataset(numRows, balance, options.output);
    } catch (error) {
      console.error('❌ Error:', error);
      process.exit(1);
    }
  });

program.parse();
