/**
 * Utility functions for ZK-Balance
 */

import fs from 'fs/promises';
import path from 'path';

/**
 * Ensure directory exists
 */
export async function ensureDir(dirPath: string): Promise<void> {
  try {
    await fs.mkdir(dirPath, { recursive: true });
  } catch (error: any) {
    if (error.code !== 'EEXIST') {
      throw error;
    }
  }
}

/**
 * Read JSON file
 */
export async function readJSON<T>(filePath: string): Promise<T> {
  const content = await fs.readFile(filePath, 'utf-8');
  return JSON.parse(content);
}

/**
 * Write JSON file
 */
export async function writeJSON(filePath: string, data: any): Promise<void> {
  await ensureDir(path.dirname(filePath));
  await fs.writeFile(filePath, JSON.stringify(data, null, 2), 'utf-8');
}

/**
 * Check if file exists
 */
export async function fileExists(filePath: string): Promise<boolean> {
  try {
    await fs.access(filePath);
    return true;
  } catch {
    return false;
  }
}

/**
 * Format large numbers with commas
 */
export function formatNumber(num: number): string {
  return num.toLocaleString('en-US');
}

/**
 * Format percentage
 */
export function formatPercentage(value: number, decimals: number = 2): string {
  return (value * 100).toFixed(decimals) + '%';
}

/**
 * Calculate percentage difference
 */
export function percentageDifference(a: number, b: number, total: number): number {
  return Math.abs(a - b) / total;
}

/**
 * Check if dataset is balanced within threshold
 */
export function checkBalance(
  c0: number,
  c1: number,
  threshold: number = 0.1
): {
  isFair: boolean;
  difference: number;
  percentage: number;
} {
  const total = c0 + c1;
  const difference = Math.abs(c0 - c1);
  const percentage = difference / total;

  return {
    isFair: percentage <= threshold,
    difference,
    percentage,
  };
}

/**
 * Time a function execution
 */
export async function timeExecution<T>(
  fn: () => Promise<T>,
  label: string
): Promise<{ result: T; duration: number }> {
  const start = Date.now();
  const result = await fn();
  const duration = Date.now() - start;

  console.log(`⏱️  ${label}: ${duration}ms`);

  return { result, duration };
}

/**
 * Pretty print results
 */
export function printResults(data: Record<string, any>): void {
  console.log('\n' + '='.repeat(60));
  Object.entries(data).forEach(([key, value]) => {
    console.log(`  ${key}: ${value}`);
  });
  console.log('='.repeat(60) + '\n');
}

/**
 * Format bytes to human readable
 */
export function formatBytes(bytes: number): string {
  if (bytes === 0) return '0 Bytes';

  const k = 1024;
  const sizes = ['Bytes', 'KB', 'MB', 'GB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));

  return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
}

/**
 * Generate random binary array
 */
export function generateRandomBits(
  length: number,
  balance: number = 0.5
): number[] {
  const bits: number[] = [];
  
  for (let i = 0; i < length; i++) {
    bits.push(Math.random() < balance ? 1 : 0);
  }
  
  return bits;
}

/**
 * Count occurrences in array
 */
export function countValues(arr: number[]): { c0: number; c1: number } {
  const c0 = arr.filter(v => v === 0).length;
  const c1 = arr.filter(v => v === 1).length;
  return { c0, c1 };
}

/**
 * Validate circuit parameters
 */
export function validateCircuitParams(N: number, depth: number): void {
  const maxLeaves = Math.pow(2, depth);
  
  if (N > maxLeaves) {
    throw new Error(
      `N (${N}) exceeds maximum for depth ${depth} (max: ${maxLeaves})`
    );
  }
  
  if (N <= 0) {
    throw new Error('N must be positive');
  }
  
  if (depth < 1 || depth > 20) {
    throw new Error('Depth must be between 1 and 20');
  }
}

/**
 * Calculate required tree depth for N items
 */
export function calculateDepth(N: number): number {
  return Math.ceil(Math.log2(N));
}

/**
 * Print banner
 */
export function printBanner(title: string): void {
  const width = 60;
  const padding = Math.max(0, Math.floor((width - title.length - 2) / 2));
  
  console.log('\n' + '═'.repeat(width));
  console.log('║' + ' '.repeat(padding) + title + ' '.repeat(width - padding - title.length - 2) + '║');
  console.log('═'.repeat(width) + '\n');
}
