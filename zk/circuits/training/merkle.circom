pragma circom 2.0.0;

include "./poseidon.circom";

/*
 * Merkle Tree Verification Library (Training Component)
 * 
 * Shared with Component A. Provides Merkle tree verification
 * for proving batch membership in the committed dataset.
 * 
 * See ../balance/merkle.circom for full documentation.
 * 
 * Authors: Tarek Salama, Zeyad Elshafey, Ahmed Elbehiry
 * Date: November 11, 2025
 */

/*
 * MerkleProofVerifier
 * 
 * Verifies a single Merkle proof: proves that a leaf belongs to a tree with given root.
 * 
 * Parameters:
 *   DEPTH - Height of the Merkle tree
 * 
 * Inputs:
 *   leaf - Leaf value to verify
 *   root - Merkle root (public)
 *   siblings[DEPTH] - Sibling hashes along the path
 *   pathIndices[DEPTH] - Direction bits (0=left, 1=right)
 * 
 * Outputs:
 *   (none - constrains that computation reaches the root)
 */
template MerkleProofVerifier(DEPTH) {
    signal input leaf;
    signal input root;
    signal input siblings[DEPTH];
    signal input pathIndices[DEPTH];
    
    component hashers[DEPTH];
    signal hashes[DEPTH + 1];
    hashes[0] <== leaf;
    
    for (var i = 0; i < DEPTH; i++) {
        hashers[i] = PoseidonHash2();
        
        // Selector: if pathIndices[i] == 0, we're on the left
        // So: left = pathIndices[i] ? siblings[i] : hashes[i]
        //     right = pathIndices[i] ? hashes[i] : siblings[i]
        
        signal leftInput;
        signal rightInput;
        
        leftInput <== pathIndices[i] * (siblings[i] - hashes[i]) + hashes[i];
        rightInput <== pathIndices[i] * (hashes[i] - siblings[i]) + siblings[i];
        
        hashers[i].in1 <== leftInput;
        hashers[i].in2 <== rightInput;
        hashes[i + 1] <== hashers[i].out;
    }
    
    // Final hash must equal root
    root === hashes[DEPTH];
}

/*
 * MerkleTreeInclusionProof
 * 
 * Proves a value is in the Merkle tree, hashing it first.
 * 
 * Parameters:
 *   DEPTH - Tree depth
 * 
 * Inputs:
 *   value - Raw value (will be hashed to get leaf)
 *   root - Merkle root
 *   siblings[DEPTH] - Sibling hashes
 *   pathIndices[DEPTH] - Path directions
 */
template MerkleTreeInclusionProof(DEPTH) {
    signal input value;
    signal input root;
    signal input siblings[DEPTH];
    signal input pathIndices[DEPTH];
    
    // Hash the value to get leaf
    component leafHasher = PoseidonHash1();
    leafHasher.in <== value;
    signal leaf <== leafHasher.out;
    
    // Verify Merkle proof
    component verifier = MerkleProofVerifier(DEPTH);
    verifier.leaf <== leaf;
    verifier.root <== root;
    for (var i = 0; i < DEPTH; i++) {
        verifier.siblings[i] <== siblings[i];
        verifier.pathIndices[i] <== pathIndices[i];
    }
}

/*
 * BatchMerkleProof
 * 
 * Verifies multiple leaves belong to the same Merkle tree.
 * Used in Component B to prove training batch comes from dataset.
 * 
 * Parameters:
 *   N - Number of leaves to verify
 *   DEPTH - Tree depth
 * 
 * Inputs:
 *   leaves[N] - N leaf values
 *   root - Shared Merkle root
 *   siblings[N][DEPTH] - Sibling hashes for each leaf
 *   pathIndices[N][DEPTH] - Path directions for each leaf
 */
template BatchMerkleProof(N, DEPTH) {
    signal input leaves[N];
    signal input root;
    signal input siblings[N][DEPTH];
    signal input pathIndices[N][DEPTH];
    
    // Verify each leaf independently
    component verifiers[N];
    
    for (var i = 0; i < N; i++) {
        verifiers[i] = MerkleProofVerifier(DEPTH);
        verifiers[i].leaf <== leaves[i];
        verifiers[i].root <== root;
        
        for (var j = 0; j < DEPTH; j++) {
            verifiers[i].siblings[j] <== siblings[i][j];
            verifiers[i].pathIndices[j] <== pathIndices[i][j];
        }
    }
}
