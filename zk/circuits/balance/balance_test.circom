pragma circom 2.0.0;

include "../lib/merkle.circom";

/*
 * Simple Test Version of BalanceProof
 * Using N=8, DEPTH=3 for quick testing
 */
template BalanceProofTest(N, DEPTH) {
    // PUBLIC INPUTS
    signal input client_id;  // Added for consistency
    signal input root;
    signal input N_public;
    signal input c0;
    signal input c1;

    // PRIVATE WITNESS
    signal input bits[N];
    signal input siblings[N][DEPTH];
    signal input pathIndices[N][DEPTH];

    // CONSTRAINT 1: Boolean check
    for (var i = 0; i < N; i++) {
        bits[i] * (bits[i] - 1) === 0;
    }

    // CONSTRAINT 2: Count verification
    signal partialSums[N + 1];
    partialSums[0] <== 0;
    
    for (var i = 0; i < N; i++) {
        partialSums[i + 1] <== partialSums[i] + bits[i];
    }
    
    partialSums[N] === c1;

    // CONSTRAINT 3: Total count
    c0 + c1 === N_public;
    N_public === N;

    // CONSTRAINT 4: Merkle membership
    component merkleProofs = BatchMerkleProof(N, DEPTH);
    merkleProofs.root <== root;
    
    for (var i = 0; i < N; i++) {
        merkleProofs.values[i] <== bits[i];
        
        for (var j = 0; j < DEPTH; j++) {
            merkleProofs.siblings[i][j] <== siblings[i][j];
            merkleProofs.pathIndices[i][j] <== pathIndices[i][j];
        }
    }
}

// Small test circuit for faster compilation/testing
// Uses 8 items with depth 3 (2^3 = 8)
component main {public [client_id, root, N_public, c0, c1]} = BalanceProofTest(8, 3);

