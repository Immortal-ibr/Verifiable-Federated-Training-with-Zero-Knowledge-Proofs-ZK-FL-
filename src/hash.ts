/**
 * Hash utilities using Poseidon (ZK-friendly hash)
 */

import { buildPoseidon } from 'circomlibjs';

let poseidonInstance: any = null;

/**
 * Initialize Poseidon hasher (call once at startup)
 */
export async function initPoseidon(): Promise<void> {
  if (!poseidonInstance) {
    poseidonInstance = await buildPoseidon();
  }
}

/**
 * Hash a single value using Poseidon
 */
export function hashOne(value: bigint): bigint {
  if (!poseidonInstance) {
    throw new Error('Poseidon not initialized. Call initPoseidon() first.');
  }
  
  // Poseidon returns a field element
  const hash = poseidonInstance.F.toObject(poseidonInstance([value]));
  return BigInt(hash.toString());
}

/**
 * Hash two values using Poseidon (for Merkle tree nodes)
 */
export function hashTwo(left: bigint, right: bigint): bigint {
  if (!poseidonInstance) {
    throw new Error('Poseidon not initialized. Call initPoseidon() first.');
  }
  
  const hash = poseidonInstance.F.toObject(poseidonInstance([left, right]));
  return BigInt(hash.toString());
}

/**
 * Hash an array of values
 */
export function hashMany(values: bigint[]): bigint {
  if (!poseidonInstance) {
    throw new Error('Poseidon not initialized. Call initPoseidon() first.');
  }
  
  const hash = poseidonInstance.F.toObject(poseidonInstance(values));
  return BigInt(hash.toString());
}

/**
 * Convert bigint to hex string
 */
export function toHex(value: bigint): string {
  return '0x' + value.toString(16).padStart(64, '0');
}

/**
 * Convert hex string to bigint
 */
export function fromHex(hex: string): bigint {
  return BigInt(hex);
}

/**
 * Convert bigint to decimal string (for snarkjs)
 */
export function toDecimalString(value: bigint): string {
  return value.toString(10);
}

/**
 * Convert decimal string to bigint
 */
export function fromDecimalString(str: string): bigint {
  return BigInt(str);
}
