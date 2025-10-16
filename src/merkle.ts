/**
 * Merkle Tree implementation for dataset commitment
 */

import { hashOne, hashTwo, toHex } from './hash.js';
import { MerkleTree, MerkleProof, MerkleNode } from './types.js';

export class MerkleTreeBuilder implements MerkleTree {
  public root: bigint;
  public depth: number;
  public leaves: bigint[];
  private nodes: bigint[][];

  constructor(values: bigint[]) {
    if (values.length === 0) {
      throw new Error('Cannot build Merkle tree from empty array');
    }

    // Ensure values.length is a power of 2
    const nextPowerOf2 = Math.pow(2, Math.ceil(Math.log2(values.length)));
    this.depth = Math.log2(nextPowerOf2);

    // Pad with zeros if necessary
    this.leaves = [...values];
    while (this.leaves.length < nextPowerOf2) {
      this.leaves.push(BigInt(0));
    }

    // Build the tree bottom-up
    this.nodes = [this.leaves.map(v => hashOne(v))];

    let currentLevel = this.nodes[0];
    
    for (let level = 0; level < this.depth; level++) {
      const nextLevel: bigint[] = [];
      
      for (let i = 0; i < currentLevel.length; i += 2) {
        const left = currentLevel[i];
        const right = currentLevel[i + 1];
        nextLevel.push(hashTwo(left, right));
      }
      
      this.nodes.push(nextLevel);
      currentLevel = nextLevel;
    }

    this.root = this.nodes[this.nodes.length - 1][0];
  }

  /**
   * Get Merkle proof for a leaf at given index
   */
  getProof(leafIndex: number): MerkleProof {
    if (leafIndex < 0 || leafIndex >= this.leaves.length) {
      throw new Error(`Invalid leaf index: ${leafIndex}`);
    }

    const siblings: bigint[] = [];
    const pathIndices: number[] = [];
    let currentIndex = leafIndex;

    // Start from leaf level (level 0) and go up
    for (let level = 0; level < this.depth; level++) {
      const isRightNode = currentIndex % 2 === 1;
      const siblingIndex = isRightNode ? currentIndex - 1 : currentIndex + 1;

      siblings.push(this.nodes[level][siblingIndex]);
      pathIndices.push(isRightNode ? 1 : 0);

      currentIndex = Math.floor(currentIndex / 2);
    }

    return {
      leaf: hashOne(this.leaves[leafIndex]),
      siblings,
      pathIndices,
      root: this.root,
    };
  }

  /**
   * Verify a Merkle proof
   */
  static verifyProof(proof: MerkleProof): boolean {
    let currentHash = proof.leaf;

    for (let i = 0; i < proof.siblings.length; i++) {
      const sibling = proof.siblings[i];
      const isRight = proof.pathIndices[i] === 1;

      currentHash = isRight
        ? hashTwo(sibling, currentHash)
        : hashTwo(currentHash, sibling);
    }

    return currentHash === proof.root;
  }

  /**
   * Get all proofs for all leaves (needed for circuit witness)
   */
  getAllProofs(): MerkleProof[] {
    const proofs: MerkleProof[] = [];
    
    for (let i = 0; i < this.leaves.length; i++) {
      proofs.push(this.getProof(i));
    }
    
    return proofs;
  }

  /**
   * Get root as hex string
   */
  getRootHex(): string {
    return toHex(this.root);
  }

  /**
   * Print tree structure (for debugging)
   */
  printTree(): void {
    console.log('\n=== Merkle Tree Structure ===');
    console.log(`Root: ${toHex(this.root)}`);
    console.log(`Depth: ${this.depth}`);
    console.log(`Leaves: ${this.leaves.length}\n`);

    for (let level = this.nodes.length - 1; level >= 0; level--) {
      const levelName = level === this.nodes.length - 1 ? 'Root' : `Level ${level}`;
      console.log(`${levelName}:`);
      
      this.nodes[level].forEach((hash, idx) => {
        console.log(`  [${idx}] ${toHex(hash).substring(0, 16)}...`);
      });
      
      console.log();
    }
  }
}

/**
 * Build a Merkle tree from binary values
 */
export function buildMerkleTreeFromBits(bits: number[]): MerkleTreeBuilder {
  const bigIntBits = bits.map(b => BigInt(b));
  return new MerkleTreeBuilder(bigIntBits);
}

/**
 * Batch verify multiple proofs
 */
export function batchVerifyProofs(proofs: MerkleProof[]): boolean {
  return proofs.every(proof => MerkleTreeBuilder.verifyProof(proof));
}
