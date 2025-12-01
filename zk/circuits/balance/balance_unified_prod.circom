pragma circom 2.0.0;

include "../lib/merkle.circom";
include "../training/vector_hash.circom";

/*
 * ═══════════════════════════════════════════════════════════════════════════
 * BalanceProofUnified - Zero-Knowledge Dataset Property Proof (Component A)
 * 
 * PRODUCTION VERSION: Matches Training v4 parameters (MODEL_DIM=16)
 * ═══════════════════════════════════════════════════════════════════════════
 * 
 * This circuit proves dataset balance using the SAME leaf structure as
 * Component B (Training): VectorHash(features || label)
 * 
 * Security guarantee:
 *   If balance_proof.root === training_proof.root_D
 *   THEN the trained data IS the balanced data! ✓
 * 
 * ═══════════════════════════════════════════════════════════════════════════
 */

template BalanceProofUnified(N, DEPTH, MODEL_DIM) {
    // ═══════════════════════════════════════════════════════════════════════
    // INPUTS
    // ═══════════════════════════════════════════════════════════════════════
    
    // ────────── PUBLIC INPUTS ──────────
    signal input client_id;      // Client identifier
    signal input root;           // Merkle root = root_D in training
    signal input N_public;       // Total sample count
    signal input c0;             // Class-0 count
    signal input c1;             // Class-1 count

    // ────────── PRIVATE WITNESS ──────────
    signal input features[N][MODEL_DIM];     // Feature vectors
    signal input labels[N];                  // Binary labels
    signal input siblings[N][DEPTH];         // Merkle proofs
    signal input pathIndices[N][DEPTH];      // Path directions

    // ═══════════════════════════════════════════════════════════════════════
    // CONSTRAINT 1: BOOLEANITY CHECK
    // ═══════════════════════════════════════════════════════════════════════
    
    for (var i = 0; i < N; i++) {
        labels[i] * (labels[i] - 1) === 0;
    }

    // ═══════════════════════════════════════════════════════════════════════
    // CONSTRAINT 2: COUNT VERIFICATION
    // ═══════════════════════════════════════════════════════════════════════
    
    signal partialSums[N + 1];
    partialSums[0] <== 0;
    
    for (var i = 0; i < N; i++) {
        partialSums[i + 1] <== partialSums[i] + labels[i];
    }
    
    partialSums[N] === c1;

    // ═══════════════════════════════════════════════════════════════════════
    // CONSTRAINT 3: TOTAL COUNT CONSISTENCY
    // ═══════════════════════════════════════════════════════════════════════
    
    c0 + c1 === N_public;
    N_public === N;

    // ═══════════════════════════════════════════════════════════════════════
    // CONSTRAINT 4: MERKLE MEMBERSHIP WITH UNIFIED HASH
    // ═══════════════════════════════════════════════════════════════════════
    
    component merkleProofs = BatchMerkleProofPreHashed(N, DEPTH);
    merkleProofs.root <== root;
    
    component leafHashers[N];
    
    for (var i = 0; i < N; i++) {
        leafHashers[i] = VectorHash(MODEL_DIM + 1);
        
        for (var j = 0; j < MODEL_DIM; j++) {
            leafHashers[i].values[j] <== features[i][j];
        }
        leafHashers[i].values[MODEL_DIM] <== labels[i];
        
        merkleProofs.leafHashes[i] <== leafHashers[i].hash;
        
        for (var j = 0; j < DEPTH; j++) {
            merkleProofs.siblings[i][j] <== siblings[i][j];
            merkleProofs.pathIndices[i][j] <== pathIndices[i][j];
        }
    }
}

// ═══════════════════════════════════════════════════════════════════════════
// MAIN COMPONENT - PRODUCTION CONFIGURATION
// ═══════════════════════════════════════════════════════════════════════════
// N=128 samples, DEPTH=7 (2^7=128), MODEL_DIM=16 features
// Matches Training v4: TrainingStepV4(8, 16, 7)

component main {public [client_id, root, N_public, c0, c1]} = BalanceProofUnified(128, 7, 16);
