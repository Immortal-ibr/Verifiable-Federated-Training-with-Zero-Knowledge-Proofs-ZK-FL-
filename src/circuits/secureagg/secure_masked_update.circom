pragma circom 2.0.0;

include "../lib/poseidon.circom";
include "../training/vector_hash.circom";
include "../../../node_modules/circomlib/circuits/comparators.circom";

/*
 * ═══════════════════════════════════════════════════════════════════════════
 * SECURE MASKED UPDATE CIRCUIT (Component C)
 * ═══════════════════════════════════════════════════════════════════════════
 * 
 * Purpose: Prove that a client's masked message m_i is correctly formed from:
 *   - A committed gradient (root_G from Component B)
 *   - Pairwise PRF-derived masks that cancel upon aggregation
 *   - Bounded gradient norm (prevents malicious inflation)
 * 
 * Protocol: Implements Google's SecAgg pairwise masking where:
 *   m_i = g_i + Σ_{j≠i} σ_ij * r_ij
 * 
 * The masks cancel when aggregated:
 *   Σ_i m_i = Σ_i g_i + Σ_i Σ_{j≠i} σ_ij * r_ij = Σ_i g_i
 * 
 * Because each r_ij appears once with σ_ij = +1 (when i < j) and once with
 * σ_ij = -1 (when i > j), they cancel out.
 * 
 * Security guarantees:
 *   1. Gradient comes from verified training (via root_G binding)
 *   2. Masks are correctly derived from shared keys
 *   3. Gradient norm is bounded (prevents aggregation attacks)
 *   4. Dataset binding (via root_D) ensures consistency with balance proof
 *   5. Weight binding (via root_W) ensures correct model was used
 * 
 * ═══════════════════════════════════════════════════════════════════════════
 */

// ═══════════════════════════════════════════════════════════════════════════
// HELPER TEMPLATES
// ═══════════════════════════════════════════════════════════════════════════

/*
 * PairwiseMaskDerivation
 * 
 * Derives a pairwise mask vector r_ij from a shared key K_ij.
 * Uses domain-separated PRF calls with CANONICAL ordering:
 *   r_ij[k] = Poseidon(K_ij, round, min(i,j), max(i,j), k)
 * 
 * Using canonical ordering ensures r_ij = r_ji, which is required
 * for mask cancellation during aggregation.
 * 
 * This ensures:
 *   - Different rounds produce different masks
 *   - Different pairs produce different masks (but r_ij = r_ji)
 *   - Different vector components are independent
 */
template PairwiseMaskDerivation(DIM) {
    signal input shared_key;      // K_ij shared between clients i and j
    signal input round;           // Round identifier
    signal input client_id;       // Client i
    signal input peer_id;         // Client j
    signal output mask[DIM];      // Output mask vector r_ij
    
    // Compute canonical ordering: min and max of client_id and peer_id
    component lt = LessThan(64);
    lt.in[0] <== client_id;
    lt.in[1] <== peer_id;
    
    // min_id = lt.out ? client_id : peer_id
    // max_id = lt.out ? peer_id : client_id
    // Using intermediate signals to avoid non-quadratic constraints
    signal ltTimesClient;
    signal ltTimesPeer;
    signal oneMinusLt;
    signal oneMinusLtTimesClient;
    signal oneMinusLtTimesPeer;
    
    ltTimesClient <== lt.out * client_id;
    ltTimesPeer <== lt.out * peer_id;
    oneMinusLt <== 1 - lt.out;
    oneMinusLtTimesClient <== oneMinusLt * client_id;
    oneMinusLtTimesPeer <== oneMinusLt * peer_id;
    
    signal min_id;
    signal max_id;
    min_id <== ltTimesClient + oneMinusLtTimesPeer;
    max_id <== ltTimesPeer + oneMinusLtTimesClient;
    
    component prf[DIM];
    for (var k = 0; k < DIM; k++) {
        // Domain separation: hash(K_ij, round, min_id, max_id, k)
        prf[k] = PoseidonHashN(5);
        prf[k].inputs[0] <== shared_key;
        prf[k].inputs[1] <== round;
        prf[k].inputs[2] <== min_id;
        prf[k].inputs[3] <== max_id;
        prf[k].inputs[4] <== k;
        mask[k] <== prf[k].hash;
    }
}

/*
 * SignDetermination
 * 
 * Determines the sign σ_ij based on client ordering:
 *   σ_ij = +1 if i < j
 *   σ_ij = -1 if i > j
 * 
 * Returns: 1 if i < j, 0 otherwise
 */
template SignDetermination() {
    signal input client_id;
    signal input peer_id;
    signal output isPositive;  // 1 if client_id < peer_id, 0 otherwise
    
    component lt = LessThan(64);  // Assuming client IDs fit in 64 bits
    lt.in[0] <== client_id;
    lt.in[1] <== peer_id;
    isPositive <== lt.out;
}

/*
 * ApplySignedMask
 * 
 * Computes: result = base + sign * mask
 * Where sign is +1 (isPositive=1) or -1 (isPositive=0)
 * 
 * Formula: result = base + isPositive * mask - (1 - isPositive) * mask
 *                 = base + (2 * isPositive - 1) * mask
 */
template ApplySignedMask(DIM) {
    signal input base[DIM];
    signal input mask[DIM];
    signal input isPositive;  // 1 for +, 0 for -
    signal output result[DIM];
    
    // Compute sign multiplier: +1 if isPositive, -1 otherwise
    // signMultiplier = 2 * isPositive - 1
    signal signMultiplier;
    signMultiplier <== 2 * isPositive - 1;
    
    // Apply: result[k] = base[k] + signMultiplier * mask[k]
    signal signedMask[DIM];
    for (var k = 0; k < DIM; k++) {
        signedMask[k] <== signMultiplier * mask[k];
        result[k] <== base[k] + signedMask[k];
    }
}

/*
 * GradientNormBound
 * 
 * Verifies that the gradient norm squared is bounded:
 *   Σ_k gradient[k]² ≤ tauSquared
 * 
 * Prevents malicious clients from submitting unbounded gradients.
 */
template GradientNormBound(DIM) {
    signal input gradient[DIM];
    signal input tauSquared;
    
    // Compute norm squared
    signal squares[DIM];
    signal partialSums[DIM];
    
    squares[0] <== gradient[0] * gradient[0];
    partialSums[0] <== squares[0];
    
    for (var k = 1; k < DIM; k++) {
        squares[k] <== gradient[k] * gradient[k];
        partialSums[k] <== partialSums[k-1] + squares[k];
    }
    
    signal normSquared;
    normSquared <== partialSums[DIM-1];
    
    // Verify norm is bounded
    component leq = LessEqThan(128);  // 128-bit comparison for large norms
    leq.in[0] <== normSquared;
    leq.in[1] <== tauSquared;
    leq.out === 1;
}

/*
 * KeyMaterialCommitment
 * 
 * Commits to all key material for a client:
 *   root_K = VectorHash([master_key, shared_key_1, shared_key_2, ...])
 */
template KeyMaterialCommitment(NUM_PEERS) {
    signal input master_key;
    signal input shared_keys[NUM_PEERS];
    signal output commitment;
    
    // Hash all keys together
    component hasher = PoseidonHashN(NUM_PEERS + 1);
    hasher.inputs[0] <== master_key;
    for (var j = 0; j < NUM_PEERS; j++) {
        hasher.inputs[j + 1] <== shared_keys[j];
    }
    commitment <== hasher.hash;
}

// ═══════════════════════════════════════════════════════════════════════════
// MAIN CIRCUIT
// ═══════════════════════════════════════════════════════════════════════════

/*
 * SecureMaskedUpdate
 * 
 * Main circuit for Component C: Secure Aggregation Well-Formedness
 * 
 * Parameters:
 *   DIM - Gradient dimension (e.g., 4)
 *   NUM_PEERS - Number of other clients (n-1 for n total clients)
 * 
 * Public Inputs:
 *   - client_id: This client's identifier
 *   - round: Current FL round number
 *   - root_D: Dataset commitment (links to balance proof)
 *   - root_G: Gradient commitment (links to training proof)
 *   - root_W: Weight commitment (links to training proof)
 *   - root_K: Key material commitment
 *   - tauSquared: Gradient norm bound
 *   - masked_update[DIM]: The masked gradient m_i (sent to server)
 *   - peer_ids[NUM_PEERS]: IDs of peer clients (for mask derivation)
 * 
 * Private Inputs:
 *   - gradient[DIM]: Actual gradient values
 *   - master_key: Client's master key seed
 *   - shared_keys[NUM_PEERS]: Pairwise shared keys K_ij
 */
template SecureMaskedUpdate(DIM, NUM_PEERS) {
    // ─────────────────────────────────────────────────────────────────────
    // PUBLIC INPUTS
    // ─────────────────────────────────────────────────────────────────────
    signal input client_id;
    signal input round;
    signal input root_D;              // Dataset commitment (binding to balance)
    signal input root_G;              // Gradient commitment (binding to training)
    signal input root_W;              // Weight commitment (binding to training)
    signal input root_K;              // Key material commitment
    signal input tauSquared;
    signal input masked_update[DIM];  // Public masked gradient
    signal input peer_ids[NUM_PEERS]; // IDs of peer clients
    
    // ─────────────────────────────────────────────────────────────────────
    // PRIVATE INPUTS
    // ─────────────────────────────────────────────────────────────────────
    signal input gradient[DIM];           // Actual gradient
    signal input master_key;              // Client's key seed
    signal input shared_keys[NUM_PEERS];  // Pairwise shared keys K_ij
    
    // ═════════════════════════════════════════════════════════════════════
    // STEP 1: VERIFY GRADIENT COMMITMENT
    // ═════════════════════════════════════════════════════════════════════
    // Ensures gradient matches root_G from training proof
    component gradCommit = GradientCommitment(DIM);
    for (var k = 0; k < DIM; k++) {
        gradCommit.gradient[k] <== gradient[k];
    }
    gradCommit.client_id <== client_id;
    gradCommit.round <== round;
    root_G === gradCommit.commitment;
    
    // ═════════════════════════════════════════════════════════════════════
    // STEP 2: VERIFY KEY MATERIAL COMMITMENT
    // ═════════════════════════════════════════════════════════════════════
    component keyCommit = KeyMaterialCommitment(NUM_PEERS);
    keyCommit.master_key <== master_key;
    for (var j = 0; j < NUM_PEERS; j++) {
        keyCommit.shared_keys[j] <== shared_keys[j];
    }
    root_K === keyCommit.commitment;
    
    // ═════════════════════════════════════════════════════════════════════
    // STEP 3: VERIFY GRADIENT NORM BOUND
    // ═════════════════════════════════════════════════════════════════════
    component normCheck = GradientNormBound(DIM);
    for (var k = 0; k < DIM; k++) {
        normCheck.gradient[k] <== gradient[k];
    }
    normCheck.tauSquared <== tauSquared;
    
    // ═════════════════════════════════════════════════════════════════════
    // STEP 4: DERIVE PAIRWISE MASKS AND COMPUTE MASKED UPDATE
    // ═════════════════════════════════════════════════════════════════════
    
    // Derive masks for each peer
    component maskDerive[NUM_PEERS];
    component signCheck[NUM_PEERS];
    
    for (var j = 0; j < NUM_PEERS; j++) {
        // Derive mask r_ij from shared key
        maskDerive[j] = PairwiseMaskDerivation(DIM);
        maskDerive[j].shared_key <== shared_keys[j];
        maskDerive[j].round <== round;
        maskDerive[j].client_id <== client_id;
        maskDerive[j].peer_id <== peer_ids[j];
        
        // Determine sign based on client ordering
        signCheck[j] = SignDetermination();
        signCheck[j].client_id <== client_id;
        signCheck[j].peer_id <== peer_ids[j];
    }
    
    // Accumulate: start with gradient, add signed masks one by one
    signal accumulated[NUM_PEERS + 1][DIM];
    
    // Initialize with gradient
    for (var k = 0; k < DIM; k++) {
        accumulated[0][k] <== gradient[k];
    }
    
    // Add each signed mask
    component applyMask[NUM_PEERS];
    for (var j = 0; j < NUM_PEERS; j++) {
        applyMask[j] = ApplySignedMask(DIM);
        for (var k = 0; k < DIM; k++) {
            applyMask[j].base[k] <== accumulated[j][k];
            applyMask[j].mask[k] <== maskDerive[j].mask[k];
        }
        applyMask[j].isPositive <== signCheck[j].isPositive;
        
        for (var k = 0; k < DIM; k++) {
            accumulated[j + 1][k] <== applyMask[j].result[k];
        }
    }
    
    // ═════════════════════════════════════════════════════════════════════
    // STEP 5: VERIFY MASKED UPDATE MATCHES COMPUTED VALUE
    // ═════════════════════════════════════════════════════════════════════
    for (var k = 0; k < DIM; k++) {
        masked_update[k] === accumulated[NUM_PEERS][k];
    }
    
    // ═════════════════════════════════════════════════════════════════════
    // STEP 6: BINDING CHECKS (root_D and root_W are just included as public)
    // ═════════════════════════════════════════════════════════════════════
    // root_D and root_W are public inputs that the server verifies externally
    // match the values from balance and training proofs.
    // We include them in the circuit to ensure they're part of the proof.
    signal bindingCheck;
    bindingCheck <== root_D * 0 + root_W * 0;  // Prevent optimization
}

// ═══════════════════════════════════════════════════════════════════════════
// MAIN COMPONENT INSTANTIATION
// ═══════════════════════════════════════════════════════════════════════════

// Parameters: DIM=4 (gradient dimension), NUM_PEERS=2 (for 3 total clients)
component main { public [
    client_id,
    round,
    root_D,
    root_G,
    root_W,
    root_K,
    tauSquared,
    masked_update,
    peer_ids
] } = SecureMaskedUpdate(4, 2);
