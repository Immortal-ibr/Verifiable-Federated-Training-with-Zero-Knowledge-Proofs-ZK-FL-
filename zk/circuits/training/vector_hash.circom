pragma circom 2.0.0;

include "../balance/poseidon.circom";

/*
 * Vector Hashing Library
 * 
 * Provides functions for hashing vectors and batches of vectors.
 * Used for:
 *   - Committing gradients (Component B → Component C)
 *   - Hashing data samples for Merkle trees
 *   - Creating compact representations of high-dimensional data
 * 
 * All hashing uses Poseidon, a ZK-friendly hash function.
 * 
 * Authors: Tarek Salama, Zeyad Elshafey, Ahmed Elbehiry
 * Date: November 11, 2025
 */

/*
 * VectorHash
 * 
 * Hashes a vector of values into a single field element.
 * 
 * This is used to create commitments for vectors like gradients.
 * The hash is binding: you can't find two different vectors with the same hash
 * (except with negligible probability).
 * 
 * Strategy for hashing long vectors:
 *   - Divide vector into chunks of size CHUNK_SIZE
 *   - Hash each chunk with PoseidonHashN
 *   - Hash all chunk hashes together
 * 
 * This is more efficient than hashing all elements at once,
 * since Poseidon has a maximum input size.
 * 
 * Parameters:
 *   DIM - Dimension of vector to hash
 * 
 * Inputs:
 *   values[DIM] - Vector values to hash
 * 
 * Outputs:
 *   hash - Poseidon hash of vector (single field element)
 */
template VectorHash(DIM) {
    signal input values[DIM];
    signal output hash;
    
    // Poseidon can hash up to 16 inputs efficiently
    // For larger vectors, we hash in chunks
    var CHUNK_SIZE = 16;
    var NUM_CHUNKS = (DIM + CHUNK_SIZE - 1) \ CHUNK_SIZE; // Ceiling division
    
    if (DIM <= CHUNK_SIZE) {
        // Small vector: hash directly
        component hasher = PoseidonHashN(DIM);
        for (var i = 0; i < DIM; i++) {
            hasher.inputs[i] <== values[i];
        }
        hash <== hasher.out;
    } else {
        // Large vector: hash in chunks, then hash the chunk hashes
        signal chunkHashes[NUM_CHUNKS];
        component chunkHasher[NUM_CHUNKS];
        
        for (var c = 0; c < NUM_CHUNKS; c++) {
            var startIdx = c * CHUNK_SIZE;
            var endIdx = startIdx + CHUNK_SIZE;
            if (endIdx > DIM) {
                endIdx = DIM;
            }
            var chunkLen = endIdx - startIdx;
            
            chunkHasher[c] = PoseidonHashN(chunkLen);
            for (var i = 0; i < chunkLen; i++) {
                chunkHasher[c].inputs[i] <== values[startIdx + i];
            }
            chunkHashes[c] <== chunkHasher[c].out;
        }
        
        // Hash all chunk hashes together
        component finalHasher = PoseidonHashN(NUM_CHUNKS);
        for (var c = 0; c < NUM_CHUNKS; c++) {
            finalHasher.inputs[c] <== chunkHashes[c];
        }
        hash <== finalHasher.out;
    }
}

/*
 * BatchHash
 * 
 * Hashes a batch of vectors (e.g., training batch).
 * 
 * This creates a commitment for an entire batch of data.
 * Each vector is hashed individually, then all hashes are combined.
 * 
 * Use cases:
 *   - Committing training batches
 *   - Creating Merkle leaves for data samples
 *   - Verifying batch integrity
 * 
 * Parameters:
 *   N - Number of vectors in batch
 *   DIM - Dimension of each vector
 * 
 * Inputs:
 *   vectors[N][DIM] - Batch of N vectors, each of dimension DIM
 * 
 * Outputs:
 *   hash - Poseidon hash of entire batch
 */
template BatchHash(N, DIM) {
    signal input vectors[N][DIM];
    signal output hash;
    
    // Hash each vector individually
    signal vectorHashes[N];
    component vectorHasher[N];
    
    for (var i = 0; i < N; i++) {
        vectorHasher[i] = VectorHash(DIM);
        for (var j = 0; j < DIM; j++) {
            vectorHasher[i].values[j] <== vectors[i][j];
        }
        vectorHashes[i] <== vectorHasher[i].hash;
    }
    
    // Hash all vector hashes together
    component batchHasher = PoseidonHashN(N);
    for (var i = 0; i < N; i++) {
        batchHasher.inputs[i] <== vectorHashes[i];
    }
    hash <== batchHasher.out;
}

/*
 * SampleHash
 * 
 * Hashes a single data sample (features + label).
 * 
 * This is used to create Merkle leaves for the dataset.
 * Each sample becomes one leaf in the Merkle tree.
 * 
 * Parameters:
 *   DIM - Number of features
 * 
 * Inputs:
 *   features[DIM] - Feature vector
 *   label - Target label
 * 
 * Outputs:
 *   hash - Poseidon hash of (features, label)
 */
template SampleHash(DIM) {
    signal input features[DIM];
    signal input label;
    signal output hash;
    
    // Concatenate features and label, then hash
    component hasher = PoseidonHashN(DIM + 1);
    for (var i = 0; i < DIM; i++) {
        hasher.inputs[i] <== features[i];
    }
    hasher.inputs[DIM] <== label;
    
    hash <== hasher.out;
}

/*
 * GradientCommitment
 * 
 * Creates a commitment for a gradient vector.
 * 
 * This is the R_G commitment that links Component B to Component C.
 * The commitment binds the prover to a specific gradient, which will
 * later be used in secure aggregation.
 * 
 * The commitment includes:
 *   - The gradient vector itself
 *   - Optionally: client_id, round_number for binding
 * 
 * Parameters:
 *   DIM - Gradient dimension
 * 
 * Inputs:
 *   gradient[DIM] - Gradient vector to commit
 *   client_id - Client identifier (for binding)
 *   round - Round number (for binding)
 * 
 * Outputs:
 *   commitment - R_G commitment (single field element)
 */
template GradientCommitment(DIM) {
    signal input gradient[DIM];
    signal input client_id;
    signal input round;
    signal output commitment;
    
    // Hash gradient vector
    component gradHash = VectorHash(DIM);
    for (var i = 0; i < DIM; i++) {
        gradHash.values[i] <== gradient[i];
    }
    
    // Combine gradient hash with metadata
    component finalHash = PoseidonHash2();
    finalHash.in1 <== gradHash.hash;
    
    // Combine client_id and round into one value
    component metaHash = PoseidonHash2();
    metaHash.in1 <== client_id;
    metaHash.in2 <== round;
    
    finalHash.in2 <== metaHash.out;
    commitment <== finalHash.out;
}

/*
 * WeightCommitment
 * 
 * Creates a commitment for model weights.
 * 
 * Similar to gradient commitment, but for the model parameters.
 * This can be used to prove that weight updates are applied correctly.
 * 
 * Parameters:
 *   DIM - Model dimension
 * 
 * Inputs:
 *   weights[DIM] - Weight vector
 *   version - Version number (for tracking)
 * 
 * Outputs:
 *   commitment - Weight commitment (single field element)
 */
template WeightCommitment(DIM) {
    signal input weights[DIM];
    signal input version;
    signal output commitment;
    
    // Hash weights
    component weightHash = VectorHash(DIM);
    for (var i = 0; i < DIM; i++) {
        weightHash.values[i] <== weights[i];
    }
    
    // Combine with version
    component finalHash = PoseidonHash2();
    finalHash.in1 <== weightHash.hash;
    finalHash.in2 <== version;
    
    commitment <== finalHash.out;
}
