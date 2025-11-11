pragma circom 2.0.0;

include "./poseidon.circom";

/*
 * MerkleProofVerifier
 * 
 * Verifies that a leaf belongs to a Merkle tree with a given root using Poseidon hash.
 * 
 * A Merkle tree commitment scheme allows proving membership of a single element
 * in a large dataset without revealing the entire dataset. The proof size is
 * logarithmic: O(log N) where N is the dataset size.
 * 
 * Parameters:
 *   DEPTH - Height of the Merkle tree
 *           Must satisfy: 2^DEPTH >= number of leaves
 *           Example: DEPTH=7 supports up to 128 leaves, DEPTH=8 supports up to 256
 * 
 * Inputs:
 *   leaf - The hash of the data item at the leaf position
 *   siblings[DEPTH] - Sibling hashes on the path from leaf to root
 *                     siblings[0] is the sibling at the leaf level
 *                     siblings[DEPTH-1] is the sibling just below the root
 *   pathIndices[DEPTH] - Direction bits for each level (0=left child, 1=right child)
 *                        Determines whether current node is left or right of its sibling
 *   root - The expected Merkle root (public commitment)
 * 
 * Security:
 *   - Soundness: Cannot prove false membership without breaking Poseidon collision-resistance
 *   - Zero-knowledge: The proof reveals only the leaf's membership, not its position or neighbors
 * 
 * Constraint count: ~153 * DEPTH (for Poseidon over BN254)
 */
template MerkleProofVerifier(DEPTH) {
    signal input leaf;
    signal input siblings[DEPTH];
    signal input pathIndices[DEPTH];
    signal input root;

    // Current hash as we move up the tree, level by level
    // hashes[0] = leaf hash
    // hashes[1] = hash of (leaf, sibling) at level 0
    // ...
    // hashes[DEPTH] = root hash
    signal hashes[DEPTH + 1];
    hashes[0] <== leaf;

    // Hash components for each level
    component hashers[DEPTH];

    // Walk up the tree from leaf to root
    for (var i = 0; i < DEPTH; i++) {
        hashers[i] = PoseidonHash2();

        // Ensure pathIndices[i] is binary (0 or 1)
        // This constraint forces: pathIndices[i] ∈ {0, 1}
        // Mathematical trick: b(1-b) = 0 ⟺ b ∈ {0,1}
        pathIndices[i] * (1 - pathIndices[i]) === 0;

        // Select hash input order based on path direction:
        // - If pathIndices[i] = 0: current node is LEFT child
        //   → hash(current, sibling)
        // - If pathIndices[i] = 1: current node is RIGHT child
        //   → hash(sibling, current)
        //
        // This is implemented using the selection formula:
        //   selected = a + bit * (b - a)
        // When bit=0: selected = a
        // When bit=1: selected = a + (b-a) = b
        
        hashers[i].left <== hashes[i] + pathIndices[i] * (siblings[i] - hashes[i]);
        hashers[i].right <== siblings[i] + pathIndices[i] * (hashes[i] - siblings[i]);
        
        hashes[i + 1] <== hashers[i].hash;
    }

    // Final hash at the top must equal the public root
    // This single constraint enforces the entire membership proof
    root === hashes[DEPTH];
}

/*
 * MerkleTreeInclusionProof
 * 
 * Proves that a raw value is included in a committed Merkle tree.
 * This is a two-step process:
 *   1. Hash the raw value to get the leaf hash
 *   2. Verify the Merkle path from leaf to root
 * 
 * Why hash the value first?
 *   - Separates leaf values from internal node values (domain separation)
 *   - Prevents attacks where an adversary uses an internal node hash as a "leaf"
 *   - Standard practice in Merkle tree constructions
 * 
 * Parameters:
 *   DEPTH - Height of the Merkle tree
 * 
 * Inputs:
 *   value - The actual raw data value (e.g., a label: 0 or 1)
 *   siblings[DEPTH] - Merkle proof siblings
 *   pathIndices[DEPTH] - Path directions
 *   root - Expected Merkle root
 * 
 * Example usage in balance proof:
 *   value = 1 (a binary label)
 *   → leafHash = Poseidon(1)
 *   → Verify path from leafHash to root
 */
template MerkleTreeInclusionProof(DEPTH) {
    signal input value;              // The actual data value
    signal input siblings[DEPTH];
    signal input pathIndices[DEPTH];
    signal input root;

    // Step 1: Hash the raw value to get the leaf hash
    component leafHasher = PoseidonHash1();
    leafHasher.value <== value;

    // Step 2: Verify the Merkle path from leaf to root
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
 * Proves that multiple values ALL belong to the same Merkle tree.
 * This is critical for the balance proof: we need to verify that every
 * counted label actually came from the committed dataset, not made up.
 * 
 * Parameters:
 *   N - Number of values to verify (must match dataset size)
 *   DEPTH - Height of the Merkle tree
 * 
 * Inputs:
 *   values[N] - Array of raw values (e.g., binary labels)
 *   siblings[N][DEPTH] - Merkle proof for each value
 *   pathIndices[N][DEPTH] - Path directions for each value
 *   root - Single Merkle root (all values must belong to this root)
 * 
 * Security guarantee:
 *   If this circuit is satisfied, then ALL N values are authentic members
 *   of the dataset committed to by 'root'. An adversary cannot:
 *   - Add fake values not in the original dataset
 *   - Use values from a different dataset
 *   - Reuse the same value multiple times (if pathIndices are unique)
 * 
 * Constraint count: ~(153 * DEPTH + 1) * N
 *   For N=128, DEPTH=7: ~138,000 constraints
 *   Still tractable for modern SNARK provers (1-5 seconds)
 */
template BatchMerkleProof(N, DEPTH) {
    signal input values[N];
    signal input siblings[N][DEPTH];
    signal input pathIndices[N][DEPTH];
    signal input root;

    // Create N independent inclusion proofs, all against the same root
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

/*
 * USAGE NOTES:
 * 
 * 1. Computing a Merkle root (off-circuit, in JavaScript/Python):
 *    - Hash each leaf: leafHashes[i] = Poseidon(values[i])
 *    - Build tree bottom-up: parent = Poseidon(leftChild, rightChild)
 *    - Top node is the root
 * 
 * 2. Computing a Merkle proof (off-circuit):
 *    - For leaf at index i, collect sibling hashes on path to root
 *    - Record direction at each level (left=0, right=1)
 * 
 * 3. Verification (in-circuit, this file):
 *    - Start with leaf hash
 *    - At each level, hash with sibling in correct order
 *    - Final result must match public root
 * 
 * See: /fl/utils.py for Python implementation of Merkle tree construction
 */
