pragma circom 2.0.0;

/*
 * Poseidon Hash Implementation for ZK-Friendly Merkle Trees
 * 
 * Poseidon is a cryptographic hash function optimized for use in zero-knowledge proofs.
 * It is significantly more efficient than traditional hash functions (like SHA-256) 
 * when implemented as arithmetic circuits over finite fields.
 * 
 * IMPORTANT: This implementation uses circomlib's Poseidon for production security.
 * Reference: Grassi et al., "Poseidon: A New Hash Function for Zero-Knowledge Proof Systems"
 * https://eprint.iacr.org/2019/458
 * 
 * Installation: npm install circomlib
 */

include "../../../node_modules/circomlib/circuits/poseidon.circom";

/*
 * PoseidonHash2
 * 
 * Hashes two field elements (used for internal Merkle tree nodes).
 * This is the standard operation when combining left and right children.
 * 
 * Security: Collision-resistant under the Poseidon assumption
 * Constraints: ~153 for BN254 curve (typical SNARK curve)
 * 
 * Inputs:
 *   left - Left child hash (or leaf)
 *   right - Right child hash (or leaf)
 * 
 * Output:
 *   hash - Poseidon(left, right)
 */
template PoseidonHash2() {
    signal input left;
    signal input right;
    signal output hash;

    component hasher = Poseidon(2);
    hasher.inputs[0] <== left;
    hasher.inputs[1] <== right;
    hash <== hasher.out;
}

/*
 * PoseidonHash1
 * 
 * Hashes a single field element (used for leaf nodes).
 * This ensures that raw data values are hashed before being placed in the tree.
 * 
 * Why hash leaves? 
 * - Prevents second-preimage attacks
 * - Ensures uniform distribution of leaf values
 * - Separates leaf space from internal node space
 * 
 * Inputs:
 *   value - The raw data value (e.g., a label: 0 or 1)
 * 
 * Output:
 *   hash - Poseidon(value)
 */
template PoseidonHash1() {
    signal input value;
    signal output hash;

    component hasher = Poseidon(1);
    hasher.inputs[0] <== value;
    hash <== hasher.out;
}

/*
 * PoseidonHashN
 * 
 * General-purpose Poseidon hash for N inputs.
 * Useful for domain separation, commitment schemes, and PRF constructions.
 * 
 * Parameters:
 *   N - Number of inputs to hash (1 to 16 typically)
 * 
 * Inputs:
 *   inputs[N] - Array of field elements to hash
 * 
 * Output:
 *   hash - Poseidon(inputs[0], ..., inputs[N-1])
 */
template PoseidonHashN(N) {
    signal input inputs[N];
    signal output hash;

    component hasher = Poseidon(N);
    for (var i = 0; i < N; i++) {
        hasher.inputs[i] <== inputs[i];
    }
    hash <== hasher.out;
}
