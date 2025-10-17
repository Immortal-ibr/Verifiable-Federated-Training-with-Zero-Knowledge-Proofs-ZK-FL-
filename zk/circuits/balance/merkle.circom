pragma circom 2.0.0;

include "./poseidon.circom";

/*
 * MerkleProofVerifier
 * 
 * Verifies that a leaf belongs to a Merkle tree with a given root.
 * 
 * Parameters:
 *   DEPTH - Height of the Merkle tree (e.g., 8 for 256 leaves)
 * 
 * Inputs:
 *   leaf - The hash of the data item
 *   siblings[DEPTH] - Sibling hashes on the path from leaf to root
 *   pathIndices[DEPTH] - Direction bits (0=left, 1=right) for each level
 *   root - The expected Merkle root
 */
template MerkleProofVerifier(DEPTH) {
    signal input leaf;
    signal input siblings[DEPTH];
    signal input pathIndices[DEPTH];
    signal input root;

    // Current hash as we move up the tree
    signal hashes[DEPTH + 1];
    hashes[0] <== leaf;

    // Components for hashing at each level
    component hashers[DEPTH];

    // For each level, hash current node with sibling
    for (var i = 0; i < DEPTH; i++) {
        hashers[i] = PoseidonHash2();

        // pathIndices[i] = 0 means current is left child
        // pathIndices[i] = 1 means current is right child
        
        // Ensure pathIndices is binary (0 or 1)
        pathIndices[i] * (1 - pathIndices[i]) === 0;

        // Select order based on path direction
        // If pathIndices[i] = 0: hash(current, sibling)
        // If pathIndices[i] = 1: hash(sibling, current)
        
        hashers[i].left <== hashes[i] + pathIndices[i] * (siblings[i] - hashes[i]);
        hashers[i].right <== siblings[i] + pathIndices[i] * (hashes[i] - siblings[i]);
        
        hashes[i + 1] <== hashers[i].hash;
    }

    // Final hash must equal root
    root === hashes[DEPTH];
}

/*
 * MerkleTreeInclusionProof
 * 
 * Proves that a value is included in a committed Merkle tree.
 * This is a wrapper that first hashes the value, then verifies the path.
 */
template MerkleTreeInclusionProof(DEPTH) {
    signal input value;              // The actual data value
    signal input siblings[DEPTH];
    signal input pathIndices[DEPTH];
    signal input root;

    // Hash the value to get the leaf
    component leafHasher = PoseidonHash1();
    leafHasher.value <== value;

    // Verify the Merkle path
    component verifier = MerkleProofVerifier(DEPTH);
    verifier.leaf <== leafHasher.hash;
    for (var i = 0; i < DEPTH; i++) {
        verifier.siblings[i] <== siblings[i];
        verifier.pathIndices[i] <== pathIndices[i];
    }
    verifier.root <== root;
}

/*
 * BatchMerkleProof
 * 
 * Proves that multiple values belong to the same Merkle tree.
 * Used to verify that all label bits come from the committed dataset.
 */
template BatchMerkleProof(N, DEPTH) {
    signal input values[N];
    signal input siblings[N][DEPTH];
    signal input pathIndices[N][DEPTH];
    signal input root;

    component proofs[N];

    for (var i = 0; i < N; i++) {
        proofs[i] = MerkleTreeInclusionProof(DEPTH);
        proofs[i].value <== values[i];
        proofs[i].root <== root;
        
        for (var j = 0; j < DEPTH; j++) {
            proofs[i].siblings[j] <== siblings[i][j];
            proofs[i].pathIndices[j] <== pathIndices[i][j];
        }
    }
}
