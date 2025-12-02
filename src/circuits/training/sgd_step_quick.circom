pragma circom 2.0.0;

include "./vector_hash.circom";
include "../lib/merkle.circom";
include "../../../node_modules/circomlib/circuits/comparators.circom";

/*
 * ═══════════════════════════════════════════════════════════════════════════
 * Component B Quick: Training Integrity Proof (Small Parameters)
 * ═══════════════════════════════════════════════════════════════════════════
 * 
 * IDENTICAL STRUCTURE to sgd_step_v5, just with smaller parameters for testing:
 *   - BATCH_SIZE=8, MODEL_DIM=4, DEPTH=3 (vs 8, 16, 7 in production)
 * 
 * Features:
 *   ✓ Round input for multi-round training
 *   ✓ GradientCommitment binding (client_id, round, gradient)
 *   ✓ Sound gradient clipping verification
 *   ✓ Merkle batch membership proofs
 * 
 * ═══════════════════════════════════════════════════════════════════════════
 */

template VerifyClippingSound(DIM) {
    signal input gradPos[DIM];
    signal input gradNeg[DIM];
    signal input tauSquared;
    
    signal output gradient[DIM];
    signal output normSquared;
    signal output valid;
    
    // Verify at most one of (pos, neg) is non-zero
    for (var j = 0; j < DIM; j++) {
        gradPos[j] * gradNeg[j] === 0;
    }
    
    // Compute norm squared
    signal posSquared[DIM];
    signal negSquared[DIM];
    signal componentNormSq[DIM];
    signal partialNorm[DIM + 1];
    
    partialNorm[0] <== 0;
    
    for (var j = 0; j < DIM; j++) {
        posSquared[j] <== gradPos[j] * gradPos[j];
        negSquared[j] <== gradNeg[j] * gradNeg[j];
        componentNormSq[j] <== posSquared[j] + negSquared[j];
        partialNorm[j + 1] <== partialNorm[j] + componentNormSq[j];
    }
    
    normSquared <== partialNorm[DIM];
    
    // Verify clipping bound
    component lt = LessThan(64);
    lt.in[0] <== normSquared;
    lt.in[1] <== tauSquared + 1;
    valid <== lt.out;
    
    // Reconstruct gradient
    for (var j = 0; j < DIM; j++) {
        gradient[j] <== gradPos[j] - gradNeg[j];
    }
}

template TrainingStepQuick(BATCH_SIZE, MODEL_DIM, DEPTH) {
    // PUBLIC INPUTS (same order as sgd_step_v5)
    signal input client_id;
    signal input round;          // NEW: Round number for multi-round training
    signal input root_D;
    signal input root_G;
    signal input tauSquared;
    
    // PRIVATE INPUTS
    signal input gradPos[MODEL_DIM];
    signal input gradNeg[MODEL_DIM];
    signal input features[BATCH_SIZE][MODEL_DIM];
    signal input labels[BATCH_SIZE];
    signal input siblings[BATCH_SIZE][DEPTH];
    signal input pathIndices[BATCH_SIZE][DEPTH];
    
    // STEP 1: VERIFY BATCH MEMBERSHIP
    component batchVerifier = BatchMerkleProofPreHashed(BATCH_SIZE, DEPTH);
    batchVerifier.root <== root_D;
    
    component leafHash[BATCH_SIZE];
    for (var i = 0; i < BATCH_SIZE; i++) {
        leafHash[i] = VectorHash(MODEL_DIM + 1);
        for (var j = 0; j < MODEL_DIM; j++) {
            leafHash[i].values[j] <== features[i][j];
        }
        leafHash[i].values[MODEL_DIM] <== labels[i];
        
        batchVerifier.leafHashes[i] <== leafHash[i].hash;
        for (var j = 0; j < DEPTH; j++) {
            batchVerifier.siblings[i][j] <== siblings[i][j];
            batchVerifier.pathIndices[i][j] <== pathIndices[i][j];
        }
    }
    
    // STEP 2: VERIFY GRADIENT CLIPPING (SOUND!)
    component clipVerifier = VerifyClippingSound(MODEL_DIM);
    for (var j = 0; j < MODEL_DIM; j++) {
        clipVerifier.gradPos[j] <== gradPos[j];
        clipVerifier.gradNeg[j] <== gradNeg[j];
    }
    clipVerifier.tauSquared <== tauSquared;
    clipVerifier.valid === 1;
    
    // STEP 3: VERIFY GRADIENT COMMITMENT (with client_id and round binding)
    component gradCommit = GradientCommitment(MODEL_DIM);
    for (var j = 0; j < MODEL_DIM; j++) {
        gradCommit.gradient[j] <== clipVerifier.gradient[j];
    }
    gradCommit.client_id <== client_id;
    gradCommit.round <== round;
    root_G === gradCommit.commitment;
    
    // Use client_id (prevent optimization)
    signal clientCheck;
    clientCheck <== client_id * 0;
}

// Small parameters for quick testing: BATCH_SIZE=8, MODEL_DIM=4, DEPTH=3
component main {public [client_id, round, root_D, root_G, tauSquared]} = TrainingStepQuick(8, 4, 3);
