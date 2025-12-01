pragma circom 2.0.0;

include "./fixedpoint.circom";
include "./vector_hash.circom";
include "../lib/merkle.circom";

/*
 * Component B: Training Integrity Proof
 * 
 * Proves that a client's model update is a valid clipped-SGD step:
 *   u = Clip(∇ℓ(w_t; batch), τ)
 *   w_{t+1} = w_t - α * u
 * 
 * Where:
 *   - w_t: current model weights (private)
 *   - batch: training batch from dataset with root R_D (private)
 *   - ∇ℓ: gradient of loss function (private)
 *   - τ: clipping threshold (public)
 *   - α: learning rate (public)
 *   - u: clipped gradient (private)
 *   - R_G: gradient commitment (public)
 * 
 * Security properties:
 *   1. Soundness: Cannot prove invalid SGD step
 *   2. Zero-knowledge: Reveals only R_D, R_G, α, τ
 *   3. Binding: Ties to dataset commitment from Component A
 * 
 * Authors: Tarek Salama, Zeyad Elshafey, Ahmed Elbehiry
 * Course: Applied Cryptography, Purdue University
 * Date: November 11, 2025
 */

/*
 * GradientNormSquared
 * 
 * Computes the squared L2 norm of a gradient vector:
 *   ‖g‖₂² = Σ g_i²
 * 
 * Used for clipping verification: if ‖g‖₂ > τ, then clip.
 * 
 * Parameters:
 *   DIM - Dimension of gradient vector
 *   PRECISION - Fixed-point precision multiplier
 * 
 * Inputs:
 *   gradient[DIM] - Gradient components (fixed-point)
 * 
 * Outputs:
 *   normSquared - ‖gradient‖₂² (fixed-point)
 */
template GradientNormSquared(DIM, PRECISION) {
    signal input gradient[DIM];
    signal output normSquared;
    
    // Component for fixed-point multiplication
    component mul[DIM];
    signal squares[DIM];
    
    // Compute each squared component: g_i²
    for (var i = 0; i < DIM; i++) {
        mul[i] = FixedPointMul(PRECISION);
        mul[i].a <== gradient[i];
        mul[i].b <== gradient[i];
        squares[i] <== mul[i].result;
    }
    
    // Sum all squared components
    signal partialSums[DIM];
    partialSums[0] <== squares[0];
    
    for (var i = 1; i < DIM; i++) {
        partialSums[i] <== partialSums[i-1] + squares[i];
    }
    
    normSquared <== partialSums[DIM-1];
}

/*
 * ClipGradient
 * 
 * Implements gradient clipping:
 *   If ‖g‖₂ > τ:
 *       g_clipped = (τ / ‖g‖₂) * g
 *   Else:
 *       g_clipped = g
 * 
 * This is a key defense against gradient-based attacks.
 * 
 * Parameters:
 *   DIM - Dimension of gradient vector
 *   PRECISION - Fixed-point precision
 * 
 * Inputs:
 *   gradient[DIM] - Raw gradient (fixed-point)
 *   normSquared - ‖gradient‖₂² (fixed-point)
 *   tauSquared - τ² (public clipping threshold squared)
 * 
 * Outputs:
 *   clipped[DIM] - Clipped gradient (fixed-point)
 *   wasClipped - 1 if clipped, 0 otherwise
 */
template ClipGradient(DIM, PRECISION) {
    signal input gradient[DIM];
    signal input normSquared;
    signal input tauSquared;
    signal output clipped[DIM];
    signal output wasClipped;
    
    // Check if clipping is needed: normSquared > tauSquared?
    component lt = LessThan(252); // Field elements fit in 252 bits
    lt.in[0] <== tauSquared;
    lt.in[1] <== normSquared;
    wasClipped <== lt.out; // 1 if need to clip, 0 otherwise
    
    // Compute scaling factor: scale = τ / ‖g‖₂
    // First compute ‖g‖₂ = sqrt(normSquared)
    component sqrt = FixedPointSqrt(PRECISION);
    sqrt.value <== normSquared;
    signal norm <== sqrt.result;
    
    // Then compute scale = tauSquared / norm (we use tau itself, stored as sqrt of tauSquared)
    component sqrtTau = FixedPointSqrt(PRECISION);
    sqrtTau.value <== tauSquared;
    signal tau <== sqrtTau.result;
    
    component div = FixedPointDiv(PRECISION);
    div.a <== tau;
    div.b <== norm;
    signal scale <== div.result;
    
    // Apply clipping: for each dimension
    component mul[DIM];
    signal scaled[DIM];
    
    for (var i = 0; i < DIM; i++) {
        mul[i] = FixedPointMul(PRECISION);
        mul[i].a <== gradient[i];
        mul[i].b <== scale;
        scaled[i] <== mul[i].result;
        
        // Use wasClipped to select: clipped = wasClipped ? scaled : gradient
        clipped[i] <== wasClipped * (scaled[i] - gradient[i]) + gradient[i];
    }
}

/*
 * WeightUpdate
 * 
 * Performs the SGD weight update:
 *   w_{t+1} = w_t - α * g_clipped
 * 
 * This is the core of the training step.
 * 
 * Parameters:
 *   DIM - Model dimension
 *   PRECISION - Fixed-point precision
 * 
 * Inputs:
 *   weights_old[DIM] - Current weights w_t (fixed-point)
 *   gradient[DIM] - Clipped gradient (fixed-point)
 *   alpha - Learning rate α (public, fixed-point)
 * 
 * Outputs:
 *   weights_new[DIM] - Updated weights w_{t+1} (fixed-point)
 */
template WeightUpdate(DIM, PRECISION) {
    signal input weights_old[DIM];
    signal input gradient[DIM];
    signal input alpha;
    signal output weights_new[DIM];
    
    // For each dimension: w_{t+1}[i] = w_t[i] - α * g[i]
    component mul[DIM];
    signal alphaG[DIM];
    
    for (var i = 0; i < DIM; i++) {
        // Compute α * g[i]
        mul[i] = FixedPointMul(PRECISION);
        mul[i].a <== alpha;
        mul[i].b <== gradient[i];
        alphaG[i] <== mul[i].result;
        
        // Update: w_new = w_old - α*g
        weights_new[i] <== weights_old[i] - alphaG[i];
    }
}

/*
 * SimpleLoss
 * 
 * Computes a simplified loss function for demonstration:
 *   ℓ(w; x, y) = (y - w·x)² / 2
 * 
 * This is squared error loss. In production, you'd use more complex losses
 * (cross-entropy, etc.), but this demonstrates the concept.
 * 
 * Parameters:
 *   DIM - Feature dimension
 *   PRECISION - Fixed-point precision
 * 
 * Inputs:
 *   weights[DIM] - Model weights (fixed-point)
 *   features[DIM] - Input features x (fixed-point)
 *   label - True label y (fixed-point)
 * 
 * Outputs:
 *   loss - Loss value ℓ(w; x, y) (fixed-point)
 *   gradient[DIM] - ∇ℓ with respect to w (fixed-point)
 */
template SimpleLoss(DIM, PRECISION) {
    signal input weights[DIM];
    signal input features[DIM];
    signal input label;
    signal output loss;
    signal output gradient[DIM];
    
    // Compute prediction: y_pred = w · x
    component mul[DIM];
    signal products[DIM];
    
    for (var i = 0; i < DIM; i++) {
        mul[i] = FixedPointMul(PRECISION);
        mul[i].a <== weights[i];
        mul[i].b <== features[i];
        products[i] <== mul[i].result;
    }
    
    // Sum products to get dot product
    signal partialSums[DIM];
    partialSums[0] <== products[0];
    for (var i = 1; i < DIM; i++) {
        partialSums[i] <== partialSums[i-1] + products[i];
    }
    signal prediction <== partialSums[DIM-1];
    
    // Compute error: e = y - y_pred
    signal error <== label - prediction;
    
    // Loss: ℓ = e² / 2
    component errMul = FixedPointMul(PRECISION);
    errMul.a <== error;
    errMul.b <== error;
    signal errorSquared <== errMul.result;
    
    component div = FixedPointDiv(PRECISION);
    div.a <== errorSquared;
    div.b <== 2 * PRECISION; // Divide by 2
    loss <== div.result;
    
    // Gradient: ∇ℓ[i] = -e * x[i]
    component gradMul[DIM];
    signal negError <== -error;
    
    for (var i = 0; i < DIM; i++) {
        gradMul[i] = FixedPointMul(PRECISION);
        gradMul[i].a <== negError;
        gradMul[i].b <== features[i];
        gradient[i] <== gradMul[i].result;
    }
}

/*
 * BatchGradient
 * 
 * Computes average gradient over a batch:
 *   ∇ℓ = (1/n) Σ ∇ℓ(w; x_i, y_i)
 * 
 * This is the standard minibatch gradient computation.
 * 
 * Parameters:
 *   BATCH_SIZE - Number of samples in batch
 *   DIM - Model dimension
 *   PRECISION - Fixed-point precision
 * 
 * Inputs:
 *   weights[DIM] - Model weights (fixed-point)
 *   features[BATCH_SIZE][DIM] - Batch of features (fixed-point)
 *   labels[BATCH_SIZE] - Batch of labels (fixed-point)
 * 
 * Outputs:
 *   gradient[DIM] - Average gradient (fixed-point)
 */
template BatchGradient(BATCH_SIZE, DIM, PRECISION) {
    signal input weights[DIM];
    signal input features[BATCH_SIZE][DIM];
    signal input labels[BATCH_SIZE];
    signal output gradient[DIM];
    
    // Compute gradient for each sample
    component sampleLoss[BATCH_SIZE];
    signal sampleGradients[BATCH_SIZE][DIM];
    
    for (var i = 0; i < BATCH_SIZE; i++) {
        sampleLoss[i] = SimpleLoss(DIM, PRECISION);
        sampleLoss[i].weights <== weights;
        for (var j = 0; j < DIM; j++) {
            sampleLoss[i].features[j] <== features[i][j];
        }
        sampleLoss[i].label <== labels[i];
        
        for (var j = 0; j < DIM; j++) {
            sampleGradients[i][j] <== sampleLoss[i].gradient[j];
        }
    }
    
    // Average gradients across batch
    signal gradientSums[DIM];
    signal partialSums[DIM][BATCH_SIZE];
    for (var j = 0; j < DIM; j++) {
        partialSums[j][0] <== sampleGradients[0][j];
        
        for (var i = 1; i < BATCH_SIZE; i++) {
            partialSums[j][i] <== partialSums[j][i-1] + sampleGradients[i][j];
        }
        gradientSums[j] <== partialSums[j][BATCH_SIZE-1];
    }
    
    // Divide by batch size
    component div[DIM];
    for (var j = 0; j < DIM; j++) {
        div[j] = FixedPointDiv(PRECISION);
        div[j].a <== gradientSums[j];
        div[j].b <== BATCH_SIZE * PRECISION;
        gradient[j] <== div[j].result;
    }
}

/*
 * TrainingStep
 * 
 * Main circuit: Proves a valid clipped-SGD training step.
 * 
 * This combines all the pieces:
 *   1. Verify batch comes from dataset (Merkle proofs to R_D)
 *   2. Compute gradient on batch
 *   3. Clip gradient if necessary
 *   4. Update weights
 *   5. Commit clipped gradient to R_G
 * 
 * Parameters:
 *   BATCH_SIZE - Batch size (e.g., 8)
 *   MODEL_DIM - Model dimension (e.g., 32)
 *   DEPTH - Merkle tree depth for dataset
 *   PRECISION - Fixed-point precision (e.g., 1000)
 * 
 * Public inputs:
 *   client_id - Client identifier
 *   root_D - Dataset commitment (from Component A)
 *   root_G - Gradient commitment (for Component C)
 *   alpha - Learning rate (fixed-point)
 *   tau - Clipping threshold (fixed-point)
 * 
 * Private inputs:
 *   weights_old[MODEL_DIM] - Current weights
 *   features[BATCH_SIZE][MODEL_DIM] - Batch features
 *   labels[BATCH_SIZE] - Batch labels
 *   siblings[BATCH_SIZE][DEPTH] - Merkle proofs for batch
 *   pathIndices[BATCH_SIZE][DEPTH] - Merkle path directions
 */
template TrainingStep(BATCH_SIZE, MODEL_DIM, DEPTH, PRECISION) {
    // =============== PUBLIC INPUTS ===============
    signal input client_id;      // Client identifier
    signal input root_D;          // Dataset Merkle root (from Component A)
    signal input root_G;          // Gradient commitment (for Component C)
    signal input alpha;           // Learning rate (fixed-point)
    signal input tau;             // Clipping threshold (fixed-point)
    
    // =============== PRIVATE INPUTS ===============
    signal input weights_old[MODEL_DIM];                    // Current weights
    signal input features[BATCH_SIZE][MODEL_DIM];           // Batch features
    signal input labels[BATCH_SIZE];                        // Batch labels
    signal input siblings[BATCH_SIZE][DEPTH];               // Merkle proofs
    signal input pathIndices[BATCH_SIZE][DEPTH];            // Merkle directions
    
    // =============== STEP 1: VERIFY BATCH MEMBERSHIP ===============
    // Prove that all samples in the batch come from the committed dataset
    
    component batchVerifier = BatchMerkleProofPreHashed(BATCH_SIZE, DEPTH);
    batchVerifier.root <== root_D;
    
    // Hash each (feature, label) pair to get leaf
    component leafHash[BATCH_SIZE];
    for (var i = 0; i < BATCH_SIZE; i++) {
        leafHash[i] = VectorHash(MODEL_DIM + 1); // +1 for label
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
    
    // =============== STEP 2: COMPUTE GRADIENT ===============
    // Compute average gradient over the batch
    
    component batchGrad = BatchGradient(BATCH_SIZE, MODEL_DIM, PRECISION);
    for (var j = 0; j < MODEL_DIM; j++) {
        batchGrad.weights[j] <== weights_old[j];
    }
    for (var i = 0; i < BATCH_SIZE; i++) {
        for (var j = 0; j < MODEL_DIM; j++) {
            batchGrad.features[i][j] <== features[i][j];
        }
        batchGrad.labels[i] <== labels[i];
    }
    
    signal gradient[MODEL_DIM];
    for (var j = 0; j < MODEL_DIM; j++) {
        gradient[j] <== batchGrad.gradient[j];
    }
    
    // =============== STEP 3: CLIP GRADIENT ===============
    // Compute gradient norm and clip if necessary
    
    component normCalc = GradientNormSquared(MODEL_DIM, PRECISION);
    for (var j = 0; j < MODEL_DIM; j++) {
        normCalc.gradient[j] <== gradient[j];
    }
    signal normSquared <== normCalc.normSquared;
    
    // Compute tau squared for comparison
    component tauMul = FixedPointMul(PRECISION);
    tauMul.a <== tau;
    tauMul.b <== tau;
    signal tauSquared <== tauMul.result;
    
    // Clip the gradient
    component clipper = ClipGradient(MODEL_DIM, PRECISION);
    for (var j = 0; j < MODEL_DIM; j++) {
        clipper.gradient[j] <== gradient[j];
    }
    clipper.normSquared <== normSquared;
    clipper.tauSquared <== tauSquared;
    
    signal clippedGradient[MODEL_DIM];
    for (var j = 0; j < MODEL_DIM; j++) {
        clippedGradient[j] <== clipper.clipped[j];
    }
    
    // =============== STEP 4: UPDATE WEIGHTS ===============
    // Apply SGD update: w_new = w_old - alpha * clipped_gradient
    
    component updater = WeightUpdate(MODEL_DIM, PRECISION);
    for (var j = 0; j < MODEL_DIM; j++) {
        updater.weights_old[j] <== weights_old[j];
        updater.gradient[j] <== clippedGradient[j];
    }
    updater.alpha <== alpha;
    
    signal weights_new[MODEL_DIM];
    for (var j = 0; j < MODEL_DIM; j++) {
        weights_new[j] <== updater.weights_new[j];
    }
    
    // =============== STEP 5: COMMIT GRADIENT ===============
    // Create commitment R_G for the clipped gradient (for Component C)
    
    component gradHash = VectorHash(MODEL_DIM);
    for (var j = 0; j < MODEL_DIM; j++) {
        gradHash.values[j] <== clippedGradient[j];
    }
    
    // Verify that the provided root_G matches our computed hash
    root_G === gradHash.hash;
    
    // All checks passed! The proof is valid.
}

// =============== MAIN COMPONENT ===============
// Instantiate with specific parameters
// Adjust these for your use case:
//   - BATCH_SIZE: number of samples per batch (e.g., 8)
//   - MODEL_DIM: model dimension (e.g., 32)
//   - DEPTH: Merkle tree depth (e.g., 7 for up to 128 samples)
//   - PRECISION: fixed-point multiplier (e.g., 1000 for 3 decimals)

component main {public [client_id, root_D, root_G, alpha, tau]} = TrainingStep(8, 16, 7, 1000);
