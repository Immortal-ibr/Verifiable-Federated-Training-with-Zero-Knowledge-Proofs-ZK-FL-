pragma circom 2.0.0;

include "../lib/merkle.circom";
include "../training/vector_hash.circom";

/*
 * ═══════════════════════════════════════════════════════════════════════════
 * BalanceProofUnified - Zero-Knowledge Dataset Property Proof (Component A)
 * 
 * UNIFIED VERSION: Uses VectorHash(features || label) for leaves
 * ═══════════════════════════════════════════════════════════════════════════
 * 
 * PURPOSE:
 * Proves that a committed dataset satisfies a balance property between two classes
 * WITHOUT revealing individual data points or their labels.
 * 
 * CRITICAL SECURITY IMPROVEMENT:
 * This unified version uses the SAME leaf structure as Component B (Training):
 *   leaf_hash = VectorHash(features[i] || labels[i])
 * 
 * This ensures:
 *   ✓ Same Merkle root root_D is used in both components
 *   ✓ Cannot prove balance on one dataset and train on another
 *   ✓ Cryptographic binding between balance proof and training proof
 * 
 * REAL-WORLD EXAMPLE:
 * A hospital has a medical dataset with 128 patient records, each with:
 *   - Features: 4 numerical attributes (age, blood_pressure, etc.)
 *   - Label: 0 = "healthy", 1 = "sick"
 * 
 * The hospital wants to prove to a research auditor:
 *   "My dataset contains 60 healthy and 68 sick patients"
 * 
 * WITHOUT revealing:
 *   ✗ Which specific patients are healthy/sick
 *   ✗ Any individual patient features
 *   ✗ The actual dataset contents
 * 
 * The proof binds to a Merkle commitment (root hash) that MUST match
 * the root used in training proofs, ensuring consistency.
 * 
 * ═══════════════════════════════════════════════════════════════════════════
 * TECHNICAL SPECIFICATION
 * ═══════════════════════════════════════════════════════════════════════════
 * 
 * Parameters (compile-time constants):
 *   N - Number of data items in the dataset (e.g., 128, 256)
 *   DEPTH - Depth of the Merkle tree (2^DEPTH >= N)
 *   MODEL_DIM - Dimension of feature vectors
 * 
 * Public Inputs (visible to verifier):
 *   client_id - Client identifier
 *   root      - Merkle root commitment (same as root_D in training!)
 *   N_public  - Total number of items (must equal parameter N)
 *   c0        - Count of class-0 items
 *   c1        - Count of class-1 items
 * 
 * Private Witness (known only to prover):
 *   features[N][MODEL_DIM] - Feature vectors for all samples
 *   labels[N]              - Binary labels for each item (0 or 1)
 *   siblings[N][DEPTH]     - Merkle proof siblings for each item
 *   pathIndices[N][DEPTH]  - Path directions for each item
 * 
 * Constraints Enforced:
 *   1. BOOLEANITY: Each label ∈ {0, 1}
 *   2. COUNT ACCURACY: Sum of labels exactly equals c1
 *   3. TOTAL CONSISTENCY: c0 + c1 = N_public = N
 *   4. MEMBERSHIP: Each (features, label) belongs to the Merkle tree
 *   5. UNIFIED HASH: leaf = VectorHash(features || label) (SAME AS TRAINING!)
 * 
 * ═══════════════════════════════════════════════════════════════════════════
 */

template BalanceProofUnified(N, DEPTH, MODEL_DIM) {
    // ═══════════════════════════════════════════════════════════════════════
    // INPUTS
    // ═══════════════════════════════════════════════════════════════════════
    
    // ────────── PUBLIC INPUTS (visible to everyone) ──────────
    signal input client_id;      // Client identifier
    signal input root;           // Merkle root: MUST MATCH root_D in training!
    signal input N_public;       // Total count
    signal input c0;             // Class-0 count
    signal input c1;             // Class-1 count

    // ────────── PRIVATE WITNESS (secret, known only to prover) ──────────
    signal input features[N][MODEL_DIM];     // Feature vectors for all samples
    signal input labels[N];                  // Secret labels: [0,1,1,0,1,...]
    signal input siblings[N][DEPTH];         // Merkle authentication paths
    signal input pathIndices[N][DEPTH];      // Path directions for each item

    // ═══════════════════════════════════════════════════════════════════════
    // CONSTRAINT 1: BOOLEANITY CHECK
    // ═══════════════════════════════════════════════════════════════════════
    // Ensure each label is either 0 or 1
    // Mathematical trick: b * (b - 1) = 0 ⟺ b ∈ {0, 1}
    
    for (var i = 0; i < N; i++) {
        labels[i] * (labels[i] - 1) === 0;
    }

    // ═══════════════════════════════════════════════════════════════════════
    // CONSTRAINT 2: COUNT VERIFICATION (Accurate Summation)
    // ═══════════════════════════════════════════════════════════════════════
    // Compute cumulative sum of labels and verify it equals the claimed c1
    
    signal partialSums[N + 1];
    partialSums[0] <== 0;
    
    for (var i = 0; i < N; i++) {
        partialSums[i + 1] <== partialSums[i] + labels[i];
    }
    
    // Final cumulative sum must equal the claimed count of 1s
    partialSums[N] === c1;

    // ═══════════════════════════════════════════════════════════════════════
    // CONSTRAINT 3: TOTAL COUNT CONSISTENCY
    // ═══════════════════════════════════════════════════════════════════════
    // Verify that the claimed counts add up to the total dataset size
    
    c0 + c1 === N_public;
    N_public === N;

    // ═══════════════════════════════════════════════════════════════════════
    // CONSTRAINT 4: MERKLE MEMBERSHIP WITH UNIFIED HASH
    // ═══════════════════════════════════════════════════════════════════════
    // Prove that EVERY (features, label) pair came from the committed dataset
    // using the SAME leaf hash as Component B: VectorHash(features || label)
    // 
    // This is the CRITICAL security feature that:
    //   ✓ Binds balance proof to training proof via shared root_D
    //   ✓ Prevents proving balance on one dataset, training on another
    //   ✓ Ensures "the trained data IS the balanced data"
    
    component merkleProofs = BatchMerkleProofPreHashed(N, DEPTH);
    merkleProofs.root <== root;
    
    // Compute leaf hashes using VectorHash(features || label)
    component leafHashers[N];
    
    for (var i = 0; i < N; i++) {
        // VectorHash expects (MODEL_DIM + 1) values: features[0..MODEL_DIM-1], label
        leafHashers[i] = VectorHash(MODEL_DIM + 1);
        
        // Copy features
        for (var j = 0; j < MODEL_DIM; j++) {
            leafHashers[i].values[j] <== features[i][j];
        }
        // Append label
        leafHashers[i].values[MODEL_DIM] <== labels[i];
        
        // Use computed hash as leaf
        merkleProofs.leafHashes[i] <== leafHashers[i].hash;
        
        // Copy Merkle path
        for (var j = 0; j < DEPTH; j++) {
            merkleProofs.siblings[i][j] <== siblings[i][j];
            merkleProofs.pathIndices[i][j] <== pathIndices[i][j];
        }
    }

    // ═══════════════════════════════════════════════════════════════════════
    // SECURITY ANALYSIS
    // ═══════════════════════════════════════════════════════════════════════
    // 
    // Binding to Training (Component B):
    //   Both circuits use: leaf = VectorHash(features || label)
    //   Both circuits verify against: root (= root_D)
    //   Therefore: root_D from balance proof == root_D from training proof
    //   
    // Attack Prevention:
    //   ✗ Cannot use balanced dataset for proof, train on unbalanced
    //   ✗ Cannot fabricate labels without matching features
    //   ✗ Cannot cherry-pick samples (all N must verify)
    //   
    // Verification:
    //   Auditor checks: balance_proof.root === training_proof.root_D
    //   If they match AND both proofs verify, the trained data IS balanced.
}

// ═══════════════════════════════════════════════════════════════════════════
// MAIN COMPONENT - TEST CONFIGURATION
// ═══════════════════════════════════════════════════════════════════════════
// For testing: 8 samples, depth 3, 4 features per sample
// Production: Adjust N, DEPTH, MODEL_DIM as needed

component main {public [client_id, root, N_public, c0, c1]} = BalanceProofUnified(8, 3, 4);
