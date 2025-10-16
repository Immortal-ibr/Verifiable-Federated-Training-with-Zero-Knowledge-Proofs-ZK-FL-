pragma circom 2.0.0;

include "./merkle.circom";

/*
 * BalanceProof
 * 
 * Zero-knowledge proof that a committed dataset is balanced between two groups.
 * 
 * Parameters:
 *   N - Number of data items in the dataset
 *   DEPTH - Depth of the Merkle tree (must satisfy 2^DEPTH >= N)
 * 
 * Public Inputs:
 *   root - Merkle root commitment to the dataset
 *   N_public - Total number of items (should equal N parameter)
 *   c0 - Count of group 0 items
 *   c1 - Count of group 1 items
 * 
 * Private Witness:
 *   bits[N] - Binary labels for each item (0 or 1)
 *   siblings[N][DEPTH] - Merkle proof siblings for each item
 *   pathIndices[N][DEPTH] - Path directions for each item
 * 
 * Constraints:
 *   1. Each bit is boolean (0 or 1)
 *   2. Sum of bits equals c1
 *   3. c0 + c1 = N_public
 *   4. Each bit is verified against the Merkle root
 */
template BalanceProof(N, DEPTH) {
    // ============ PUBLIC INPUTS ============
    signal input root;           // Merkle root of dataset commitment
    signal input N_public;       // Total dataset size
    signal input c0;             // Count of group 0
    signal input c1;             // Count of group 1

    // ============ PRIVATE WITNESS ============
    signal input bits[N];                    // The secret binary labels
    signal input siblings[N][DEPTH];         // Merkle paths
    signal input pathIndices[N][DEPTH];      // Path directions

    // ============ CONSTRAINT 1: Booleanity ============
    // Ensure each bit is either 0 or 1
    // Algebraically: b * (b - 1) = 0 ⟺ b ∈ {0, 1}
    
    for (var i = 0; i < N; i++) {
        bits[i] * (bits[i] - 1) === 0;
    }

    // ============ CONSTRAINT 2: Count Verification ============
    // Compute sum of bits and verify it equals c1
    
    signal partialSums[N + 1];
    partialSums[0] <== 0;
    
    for (var i = 0; i < N; i++) {
        partialSums[i + 1] <== partialSums[i] + bits[i];
    }
    
    // Final sum must equal c1 (count of 1s)
    partialSums[N] === c1;

    // ============ CONSTRAINT 3: Total Count ============
    // Verify that c0 + c1 = N_public
    
    c0 + c1 === N_public;
    
    // Also verify N_public matches the circuit parameter
    N_public === N;

    // ============ CONSTRAINT 4: Merkle Membership ============
    // Prove each bit came from the committed dataset
    
    component merkleProofs = BatchMerkleProof(N, DEPTH);
    merkleProofs.root <== root;
    
    for (var i = 0; i < N; i++) {
        merkleProofs.values[i] <== bits[i];
        
        for (var j = 0; j < DEPTH; j++) {
            merkleProofs.siblings[i][j] <== siblings[i][j];
            merkleProofs.pathIndices[i][j] <== pathIndices[i][j];
        }
    }

    // ============ OUTPUT ============
    // The proof itself doesn't output anything beyond satisfying constraints
    // The verifier will check this proof against the public inputs
}

/*
 * Main component - instantiate with specific N and DEPTH
 * 
 * For a semester project, N=128 or N=256 is reasonable:
 *   N=128 requires DEPTH=7 (2^7 = 128)
 *   N=256 requires DEPTH=8 (2^8 = 256)
 * 
 * Example usage:
 *   component main {public [root, N_public, c0, c1]} = BalanceProof(128, 7);
 */

// Default: 128 items, depth 7
component main {public [root, N_public, c0, c1]} = BalanceProof(128, 7);
