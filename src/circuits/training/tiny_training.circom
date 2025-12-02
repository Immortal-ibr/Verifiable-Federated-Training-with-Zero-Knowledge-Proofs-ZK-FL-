pragma circom 2.0.0;

include "./fixedpoint.circom";
include "./vector_hash.circom";
include "../lib/merkle.circom";

// TINY VERSION for fast testing:
// BATCH_SIZE=2, MODEL_DIM=4, DEPTH=2 (only 4 samples)
// This should have ~5-10k constraints instead of 122k

template TinyTrainingStep(BATCH_SIZE, MODEL_DIM, DEPTH, PRECISION) {
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
    component batchVerifier = BatchMerkleProofPreHashed(BATCH_SIZE, DEPTH);
    batchVerifier.root <== root_D;
    
    component leafHash[BATCH_SIZE];
    for (var i = 0; i < BATCH_SIZE; i++) {
        leafHash[i] = VectorHash(MODEL_DIM + 1);
        for (var j = 0; j < MODEL_DIM; j++) {
            leafHash[i].values[j] <== features[i][j];
        }
        leafHash[i].values[MODEL_DIM] <== labels[i];
        
        batchVerifier.leafHashes[i] <== leafHash[i].hash;  // Pre-hashed!
        for (var j = 0; j < DEPTH; j++) {
            batchVerifier.siblings[i][j] <== siblings[i][j];
            batchVerifier.pathIndices[i][j] <== pathIndices[i][j];
        }
    }
    
    // Compute simple gradient (just average of features for demo)
    signal gradient[MODEL_DIM];
    signal sums[MODEL_DIM];
    
    for (var j = 0; j < MODEL_DIM; j++) {
        sums[j] <== features[0][j] + features[1][j];
        gradient[j] <== sums[j];  // Simplified - no actual gradient computation
    }
    
    // Commit gradient
    component gradHash = VectorHash(MODEL_DIM);
    for (var j = 0; j < MODEL_DIM; j++) {
        gradHash.values[j] <== gradient[j];
    }
    root_G === gradHash.hash;
}

component main {public [client_id, root_D, root_G, alpha, tau]} = TinyTrainingStep(2, 4, 2, 1000);
