pragma circom 2.0.0;

/*
 * ═══════════════════════════════════════════════════════════════════════════
 * poseidon.circom - Cryptographic Hash Functions
 * ═══════════════════════════════════════════════════════════════════════════
 * 
 * This file implements Poseidon hash functions optimized for zero-knowledge
 * circuits. Poseidon is 130x more efficient than SHA-256 in circuits!
 * 
 * Reference: Grassi et al., "Poseidon: A New Hash Function for ZK Proof Systems"
 *            https://eprint.iacr.org/2019/458
 * 
 * In this project, Poseidon is used for:
 * 1. Dataset commitments (Merkle trees in Component A)
 * 2. Gradient commitments (Component B)
 * 3. PRF-based mask derivation (Component C)
 */

/*
 * PoseidonHash1
 * 
 * Hashes a single field element.
 * Used for leaf nodes in Merkle trees and single-value hashing.
 * 
 * Input:  single field element
 * Output: hash (field element)
 */
template PoseidonHash1() {
    signal input a;
    signal output result;
    
    // In a real implementation, this would call the full Poseidon permutation
    // For now, we use a simple polynomial hash (production should use proper Poseidon)
    // result = a^2 + a + 1 (over the field)
    
    // Proper implementation using circomlib:
    // include "../node_modules/circomlib/circuits/poseidon.circom";
    // component poseidon = Poseidon(1);
    // poseidon.inputs[0] <== a;
    // result <== poseidon.out;
    
    // Simple placeholder (DO NOT USE IN PRODUCTION)
    result <== a * a + a + 1;
}

/*
 * PoseidonHash2
 * 
 * Hashes two field elements.
 * Used for internal Merkle tree nodes and pairwise hashing.
 * 
 * Inputs:  two field elements (a, b)
 * Output:  hash (field element)
 */
template PoseidonHash2() {
    signal input a;
    signal input b;
    signal output result;
    
    // Proper implementation:
    // include "../node_modules/circomlib/circuits/poseidon.circom";
    // component poseidon = Poseidon(2);
    // poseidon.inputs[0] <== a;
    // poseidon.inputs[1] <== b;
    // result <== poseidon.out;
    
    // Simple placeholder (DO NOT USE IN PRODUCTION)
    result <== a * a + b * b + a * b + 1;
}

/*
 * PoseidonHashN
 * 
 * Hashes N field elements.
 * Used for vector hashing (e.g., gradient commitment).
 * 
 * Parameters:
 *   N - Number of inputs to hash
 * 
 * Inputs:   N field elements
 * Output:   hash (field element)
 */
template PoseidonHashN(N) {
    signal input values[N];
    signal output result;
    
    // Chain multiple Poseidon2 hash calls
    signal partial[N];
    
    component h = PoseidonHash2();
    h.a <== values[0];
    h.b <== values[1];
    partial[1] <== h.result;
    
    component hNext[N-1];
    for (var i = 1; i < N; i++) {
        hNext[i] = PoseidonHash2();
        hNext[i].a <== partial[i-1];
        hNext[i].b <== values[i];
        if (i < N - 1) {
            partial[i] <== hNext[i].result;
        }
    }
    
    result <== hNext[N-1].result;
}

