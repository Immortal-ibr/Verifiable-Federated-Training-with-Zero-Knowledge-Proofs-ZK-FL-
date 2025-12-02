pragma circom 2.0.0;

include "./vector_hash.circom";
include "../lib/merkle.circom";
include "../../../node_modules/circomlib/circuits/comparators.circom";

/*
 * ═══════════════════════════════════════════════════════════════════════════
 * SGD Step with VERIFIED Gradient Correctness
 * ═══════════════════════════════════════════════════════════════════════════
 * 
 * This circuit extends the training proof to verify that the gradient is
 * ACTUALLY COMPUTED from the data, not just any arbitrary gradient.
 * 
 * Implements matrix operations inline (inspired by circomlib-ml) to avoid
 * include path conflicts.
 * 
 * Verifications:
 *   ✓ Batch membership via Merkle proofs
 *   ✓ Gradient clipping (norm bound)
 *   ✓ Gradient commitment (hash)
 *   ✓ **NEW: Gradient correctness** - gradient = f(features, labels, weights)
 * 
 * For linear regression with squared loss:
 *   prediction_i = weights · features_i
 *   error_i = label_i - prediction_i
 *   gradient_j = -sum_i(error_i * features_i[j]) / BATCH_SIZE
 * 
 * PRECISION: All values are scaled by PRECISION (e.g., 1000) for fixed-point.
 * 
 * ═══════════════════════════════════════════════════════════════════════════
 */

// ═══════════════════════════════════════════════════════════════════════════
// Matrix Operations (inline, inspired by circomlib-ml)
// ═══════════════════════════════════════════════════════════════════════════

// Dot product: sum of element-wise products
template DotProduct(DIM) {
    signal input a[DIM];
    signal input b[DIM];
    signal output out;
    
    // Element-wise multiply
    signal products[DIM];
    for (var j = 0; j < DIM; j++) {
        products[j] <== a[j] * b[j];
    }
    
    // Sum all products
    signal partialSum[DIM + 1];
    partialSum[0] <== 0;
    for (var j = 0; j < DIM; j++) {
        partialSum[j + 1] <== partialSum[j] + products[j];
    }
    
    out <== partialSum[DIM];
}

// Compute gradient for a single sample: grad = error * features
// Where error = (prediction - label) for squared loss derivative
template SampleGradient(DIM) {
    signal input features[DIM];
    signal input label;
    signal input prediction;
    signal output gradient[DIM];
    signal output error;
    
    // error = prediction - label (for d/dw of 0.5*(pred-label)^2)
    error <== prediction - label;
    
    // gradient[j] = error * features[j]
    for (var j = 0; j < DIM; j++) {
        gradient[j] <== error * features[j];
    }
}

// Verify that claimed gradient matches computed gradient from data
// Uses fixed-point arithmetic (scaled by PRECISION)
// 
// The prover must compute the gradient correctly off-chain using the same formula.
// We allow for a small remainder due to integer division.
template VerifyGradientCorrectness(BATCH_SIZE, DIM, PRECISION) {
    signal input features[BATCH_SIZE][DIM];
    signal input labels[BATCH_SIZE];
    signal input weights[DIM];
    signal input claimedGradient[DIM];  // Gradient claimed by prover
    signal input expectedSummedGrad[DIM];  // Prover provides the summed gradient
    signal input remainder[DIM];  // Remainder from division (for exact check)
    signal output valid;
    
    // Compute prediction for each sample: pred = weights · features
    component dotProducts[BATCH_SIZE];
    for (var i = 0; i < BATCH_SIZE; i++) {
        dotProducts[i] = DotProduct(DIM);
        for (var j = 0; j < DIM; j++) {
            dotProducts[i].a[j] <== features[i][j];
            dotProducts[i].b[j] <== weights[j];
        }
    }
    
    // Compute per-sample gradients: grad_i = (pred_i - label_i) * features_i
    component sampleGrads[BATCH_SIZE];
    for (var i = 0; i < BATCH_SIZE; i++) {
        sampleGrads[i] = SampleGradient(DIM);
        for (var j = 0; j < DIM; j++) {
            sampleGrads[i].features[j] <== features[i][j];
        }
        sampleGrads[i].label <== labels[i] * PRECISION;  // Scale label to match prediction
        sampleGrads[i].prediction <== dotProducts[i].out;
    }
    
    // Sum gradients across batch
    signal computedSum[DIM];
    signal partialSum[BATCH_SIZE + 1][DIM];
    
    for (var j = 0; j < DIM; j++) {
        partialSum[0][j] <== 0;
    }
    
    for (var i = 0; i < BATCH_SIZE; i++) {
        for (var j = 0; j < DIM; j++) {
            partialSum[i + 1][j] <== partialSum[i][j] + sampleGrads[i].gradient[j];
        }
    }
    
    for (var j = 0; j < DIM; j++) {
        computedSum[j] <== partialSum[BATCH_SIZE][j];
    }
    
    // EXACT MATCH: expectedSummedGrad must equal computedSum
    for (var j = 0; j < DIM; j++) {
        expectedSummedGrad[j] === computedSum[j];
    }
    
    // Verify claimedGradient with remainder:
    // expectedSummedGrad[j] = claimedGradient[j] * BATCH_SIZE * PRECISION + remainder[j]
    // where 0 <= remainder[j] < BATCH_SIZE * PRECISION
    var DIVISOR = BATCH_SIZE * PRECISION;
    
    component ltChecks[DIM];
    for (var j = 0; j < DIM; j++) {
        // Remainder must be non-negative and less than divisor
        ltChecks[j] = LessThan(64);
        ltChecks[j].in[0] <== remainder[j];
        ltChecks[j].in[1] <== DIVISOR;
        ltChecks[j].out === 1;
        
        // Verify the division: summed = claimed * divisor + remainder
        expectedSummedGrad[j] === claimedGradient[j] * DIVISOR + remainder[j];
    }
    
    valid <== 1;  // If we reach here, all checks passed
}

// Simple commitment to weights (different from vector_hash.circom version - no version input)
template WeightCommitmentSimple(DIM) {
    signal input weights[DIM];
    signal output commitment;
    
    component hasher = VectorHash(DIM);
    for (var j = 0; j < DIM; j++) {
        hasher.values[j] <== weights[j];
    }
    commitment <== hasher.hash;
}

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

/*
 * Main Training Step Template with Gradient Verification
 * 
 * PUBLIC INPUTS:
 *   - client_id: Unique client identifier
 *   - round: Training round number
 *   - root_D: Merkle root of dataset
 *   - root_G: Gradient commitment
 *   - root_W: Weight commitment (NEW - for gradient verification)
 *   - tauSquared: Clipping threshold
 * 
 * PRIVATE INPUTS:
 *   - weights: Current model weights (private to client)
 *   - expectedSummedGrad: Sum of per-sample gradients (computed off-chain)
 *   - remainder: Division remainder for gradient averaging
 *   - gradPos/gradNeg: Gradient in sign-magnitude form
 *   - features/labels: Batch data
 *   - siblings/pathIndices: Merkle proofs
 */
template TrainingStepVerified(BATCH_SIZE, MODEL_DIM, DEPTH, PRECISION) {
    // PUBLIC INPUTS
    signal input client_id;
    signal input round;
    signal input root_D;
    signal input root_G;
    signal input root_W;         // NEW: Commitment to weights
    signal input tauSquared;
    
    // PRIVATE INPUTS
    signal input weights[MODEL_DIM];           // NEW: Model weights
    signal input expectedSummedGrad[MODEL_DIM]; // NEW: Summed gradient (for verification)
    signal input remainder[MODEL_DIM];          // NEW: Remainder from division
    signal input gradPos[MODEL_DIM];
    signal input gradNeg[MODEL_DIM];
    signal input features[BATCH_SIZE][MODEL_DIM];
    signal input labels[BATCH_SIZE];
    signal input siblings[BATCH_SIZE][DEPTH];
    signal input pathIndices[BATCH_SIZE][DEPTH];
    
    // STEP 1: VERIFY WEIGHT COMMITMENT
    component weightCommit = WeightCommitmentSimple(MODEL_DIM);
    for (var j = 0; j < MODEL_DIM; j++) {
        weightCommit.weights[j] <== weights[j];
    }
    root_W === weightCommit.commitment;
    
    // STEP 2: VERIFY BATCH MEMBERSHIP
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
    
    // STEP 3: VERIFY GRADIENT CLIPPING
    component clipVerifier = VerifyClippingSound(MODEL_DIM);
    for (var j = 0; j < MODEL_DIM; j++) {
        clipVerifier.gradPos[j] <== gradPos[j];
        clipVerifier.gradNeg[j] <== gradNeg[j];
    }
    clipVerifier.tauSquared <== tauSquared;
    clipVerifier.valid === 1;
    
    // STEP 4: VERIFY GRADIENT CORRECTNESS (NEW!)
    component gradVerifier = VerifyGradientCorrectness(BATCH_SIZE, MODEL_DIM, PRECISION);
    for (var i = 0; i < BATCH_SIZE; i++) {
        for (var j = 0; j < MODEL_DIM; j++) {
            gradVerifier.features[i][j] <== features[i][j];
        }
        gradVerifier.labels[i] <== labels[i];
    }
    for (var j = 0; j < MODEL_DIM; j++) {
        gradVerifier.weights[j] <== weights[j];
        gradVerifier.claimedGradient[j] <== clipVerifier.gradient[j];
        gradVerifier.expectedSummedGrad[j] <== expectedSummedGrad[j];
        gradVerifier.remainder[j] <== remainder[j];
    }
    gradVerifier.valid === 1;
    
    // STEP 5: VERIFY GRADIENT COMMITMENT
    component gradCommit = GradientCommitment(MODEL_DIM);
    for (var j = 0; j < MODEL_DIM; j++) {
        gradCommit.gradient[j] <== clipVerifier.gradient[j];
    }
    gradCommit.client_id <== client_id;
    gradCommit.round <== round;
    root_G === gradCommit.commitment;
    
    // Prevent optimization
    signal clientCheck;
    clientCheck <== client_id * 0;
}

// Quick testing parameters: BATCH_SIZE=8, MODEL_DIM=4, DEPTH=3, PRECISION=1000
component main {public [client_id, round, root_D, root_G, root_W, tauSquared]} = TrainingStepVerified(8, 4, 3, 1000);
