/**
 * Type definitions for ZK-Balance project
 */

/**
 * A single data row with a binary group attribute
 */
export interface DataRow {
  id: number;
  group: 0 | 1;  // Binary attribute (e.g., 0=male, 1=female)
  // Additional fields can be added but won't be used in proof
  metadata?: Record<string, any>;
}

/**
 * Dataset with rows
 */
export interface Dataset {
  rows: DataRow[];
  totalCount: number;
}

/**
 * Merkle tree node
 */
export interface MerkleNode {
  hash: bigint;
  left?: MerkleNode;
  right?: MerkleNode;
  isLeaf: boolean;
  index?: number;
}

/**
 * Merkle proof for a single leaf
 */
export interface MerkleProof {
  leaf: bigint;
  siblings: bigint[];
  pathIndices: number[];  // 0 = left, 1 = right
  root: bigint;
}

/**
 * Merkle tree structure
 */
export interface MerkleTree {
  root: bigint;
  depth: number;
  leaves: bigint[];
  getProof(leafIndex: number): MerkleProof;
}

/**
 * Dataset commitment (Merkle root)
 */
export interface Commitment {
  root: string;          // Hex string
  rootBigInt: bigint;    // BigInt representation
  N: number;             // Dataset size
  depth: number;         // Tree depth
  timestamp: number;     // Commitment time
}

/**
 * Group counts
 */
export interface Counts {
  c0: number;  // Count of group 0
  c1: number;  // Count of group 1
  N: number;   // Total (c0 + c1)
}

/**
 * Public inputs for the circuit
 */
export interface PublicInputs {
  root: string;
  N: number;
  c0: number;
  c1: number;
}

/**
 * Private witness for the circuit
 */
export interface PrivateWitness {
  bits: number[];                    // Binary labels [0,1,0,1,...]
  siblings: string[][];              // Merkle siblings [N][DEPTH]
  pathIndices: number[][];           // Path directions [N][DEPTH]
}

/**
 * Complete witness (public + private)
 */
export interface Witness {
  root: string;
  N_public: number;
  c0: number;
  c1: number;
  bits: string[];                    // As strings for snarkjs
  siblings: string[][];
  pathIndices: string[][];
}

/**
 * ZK Proof structure (Groth16)
 */
export interface Proof {
  pi_a: string[];
  pi_b: string[][];
  pi_c: string[];
  protocol: string;
  curve: string;
}

/**
 * Proof package (proof + public inputs)
 */
export interface ProofPackage {
  proof: Proof;
  publicSignals: string[];
}

/**
 * Verification result
 */
export interface VerificationResult {
  proofValid: boolean;
  counts: Counts;
  fairnessCheck: {
    threshold: number;
    actualDifference: number;
    percentageDifference: number;
    isFair: boolean;
  };
  timestamp: number;
}

/**
 * Circuit configuration
 */
export interface CircuitConfig {
  N: number;          // Number of items
  DEPTH: number;      // Tree depth
  name: string;       // Circuit name
  wasmPath: string;   // Path to .wasm file
  zkeyPath: string;   // Path to .zkey file
  vkeyPath: string;   // Path to verification key
}

/**
 * Fairness parameters
 */
export interface FairnessParams {
  threshold: number;       // Max allowed imbalance (0.1 = 10%)
  checkType: 'absolute' | 'relative';
}

/**
 * Demo configuration
 */
export interface DemoConfig {
  datasetSize: number;
  balance: number;         // Target balance (0.5 = 50/50)
  fairnessThreshold: number;
  outputDir: string;
}

/**
 * Hash function type
 */
export type HashFunction = (inputs: bigint[]) => bigint;

/**
 * Circuit input signals
 */
export type CircuitSignals = Record<string, string | string[] | string[][]>;
