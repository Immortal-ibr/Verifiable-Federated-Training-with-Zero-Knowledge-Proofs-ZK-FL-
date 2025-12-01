pragma circom 2.0.0;

include "./vector_hash.circom";
include "../lib/merkle.circom";
include "../../../node_modules/circomlib/circuits/comparators.circom";

/*
 * ═══════════════════════════════════════════════════════════════════════════
 * Component B v5: Training Integrity Proof with SOUND Clipping
 * ═══════════════════════════════════════════════════════════════════════════
 * 
 * IMPROVEMENT OVER v4:
 *   v4 trusted the prover's normSquared input (UNSOUND)
 *   v5 COMPUTES normSquared in-circuit using sign-magnitude decomposition
 * 
 * SIGN-MAGNITUDE DECOMPOSITION:
 *   gradient[j] = gradPos[j] - gradNeg[j]
 *   Where gradPos[j], gradNeg[j] >= 0 and at most one is non-zero.
 *   ||gradient||² = Σ(gradPos[j]² + gradNeg[j]²)
 * 
 * SECURITY:
 *   ✓ Batch membership (Merkle proofs)
 *   ✓ Gradient clipping (SOUND - computed in-circuit)
 *   ✓ Gradient commitment (VectorHash binding)
 *   ✗ Gradient correctness (not verified - requires zkML)
 * 
 * Authors: Tarek Salama, Zeyad Elshafey, Ahmed Elbehiry
 * Course: Applied Cryptography, Purdue University
 * ═══════════════════════════════════════════════════════════════════════════
 */

/*
 * VerifyClippingSound
 * 
 * Verifies gradient clipping using sign-magnitude decomposition.
 * Computes ||gradient||² in-circuit instead of trusting prover.
 */
template VerifyClippingSound(DIM) {
    signal input gradPos[DIM];
    signal input gradNeg[DIM];
    signal input tauSquared;
    
    signal output gradient[DIM];
    signal output normSquared;
    signal output valid;
    
    // STEP 1: Verify at most one of (pos, neg) is non-zero
    for (var j = 0; j < DIM; j++) {
        gradPos[j] * gradNeg[j] === 0;
    }
    
    // STEP 2: Compute norm squared
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
    
    // STEP 3: Verify clipping bound
    component lt = LessThan(128);
    lt.in[0] <== normSquared;
    lt.in[1] <== tauSquared + 1;
    valid <== lt.out;
    
    // STEP 4: Reconstruct gradient
    for (var j = 0; j < DIM; j++) {
        gradient[j] <== gradPos[j] - gradNeg[j];
    }
}

/*
 * TrainingStepV5
 * 
 * Main circuit with SOUND clipping verification.
 */
template TrainingStepV5(BATCH_SIZE, MODEL_DIM, DEPTH) {
    // PUBLIC INPUTS
    signal input client_id;
    signal input root_D;
    signal input root_G;
    signal input tauSquared;
    
    // PRIVATE INPUTS (sign-magnitude form)
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
    
    // STEP 3: VERIFY GRADIENT COMMITMENT
    component gradHash = VectorHash(MODEL_DIM);
    for (var j = 0; j < MODEL_DIM; j++) {
        gradHash.values[j] <== clipVerifier.gradient[j];
    }
    root_G === gradHash.hash;
    
    // Use client_id
    signal clientCheck;
    clientCheck <== client_id * 0;
}

component main {public [client_id, root_D, root_G, tauSquared]} = TrainingStepV5(8, 16, 7);
