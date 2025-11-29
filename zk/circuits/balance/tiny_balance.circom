pragma circom 2.0.0;

include "../lib/merkle.circom";

// TINY TEST VERSION: N=4, DEPTH=2 (only 4 items, much faster!)
template TinyBalanceProof(N, DEPTH) {
    signal input client_id;
    signal input root;
    signal input N_public;
    signal input c0;
    signal input c1;
    signal input bits[N];
    signal input siblings[N][DEPTH];
    signal input pathIndices[N][DEPTH];

    // Check bits are boolean
    for (var i = 0; i < N; i++) {
        bits[i] * (bits[i] - 1) === 0;
    }

    // Count the 1s
    signal partialSums[N + 1];
    partialSums[0] <== 0;
    for (var i = 0; i < N; i++) {
        partialSums[i + 1] <== partialSums[i] + bits[i];
    }
    partialSums[N] === c1;

    // Total consistency
    c0 + c1 === N_public;
    N_public === N;

    // Merkle proofs
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

component main {public [client_id, root, N_public, c0, c1]} = TinyBalanceProof(4, 2);
