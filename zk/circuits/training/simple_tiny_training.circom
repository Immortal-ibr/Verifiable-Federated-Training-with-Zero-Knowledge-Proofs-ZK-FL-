pragma circom 2.0.0;

include "../lib/poseidon.circom";
include "../lib/merkle.circom";

// ULTRA SIMPLE VERSION - Uses plain Poseidon hash instead of VectorHash
// This makes data generation trivial!

template SimpleTinyTraining(BATCH_SIZE, MODEL_DIM, DEPTH) {
    signal input client_id;
    signal input root_D;
    signal input root_G;
    signal input alpha;
    signal input tau;
    
    signal input weights_old[MODEL_DIM];
    signal input features[BATCH_SIZE][MODEL_DIM];
    signal input labels[BATCH_SIZE];
    signal input siblings[BATCH_SIZE][DEPTH];
    signal input pathIndices[BATCH_SIZE][DEPTH];
    
    // Verify batch from Merkle tree
    component batchVerifier = BatchMerkleProof(BATCH_SIZE, DEPTH);
    batchVerifier.root <== root_D;
    
    // Simple hash: just hash the label (ultra simple for testing!)
    component leafHash[BATCH_SIZE];
    for (var i = 0; i < BATCH_SIZE; i++) {
        leafHash[i] = PoseidonHash1();
        leafHash[i].value <== labels[i];
        
        batchVerifier.values[i] <== leafHash[i].hash;
        for (var j = 0; j < DEPTH; j++) {
            batchVerifier.siblings[i][j] <== siblings[i][j];
            batchVerifier.pathIndices[i][j] <== pathIndices[i][j];
        }
    }
    
    // Compute gradient (just sum features for demo)
    signal gradient[MODEL_DIM];
    signal sums[MODEL_DIM];
    
    for (var j = 0; j < MODEL_DIM; j++) {
        sums[j] <== features[0][j] + features[1][j];
        gradient[j] <== sums[j];
    }
    
    // Commit gradient using simple hash
    component gradHash = PoseidonHashN(MODEL_DIM);
    for (var j = 0; j < MODEL_DIM; j++) {
        gradHash.inputs[j] <== gradient[j];
    }
    root_G === gradHash.hash;
}

component main {public [client_id, root_D, root_G, alpha, tau]} = SimpleTinyTraining(2, 4, 2);
