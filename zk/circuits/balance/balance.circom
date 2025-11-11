pragma circom 2.0.0;

include "./merkle.circom";

/*
 * ═══════════════════════════════════════════════════════════════════════════
 * BalanceProof - Zero-Knowledge Dataset Property Proof (Component A)
 * ═══════════════════════════════════════════════════════════════════════════
 * 
 * PURPOSE:
 * Proves that a committed dataset satisfies a balance property between two classes
 * WITHOUT revealing individual data points or their labels.
 * 
 * REAL-WORLD EXAMPLE:
 * A hospital has a medical dataset with 128 patient records, each labeled:
 *   - 0 = "healthy" 
 *   - 1 = "sick"
 * 
 * The hospital wants to prove to a research auditor:
 *   "My dataset contains 60 healthy and 68 sick patients"
 * 
 * WITHOUT revealing:
 *   ✗ Which specific patients are healthy/sick
 *   ✗ Any individual patient record
 *   ✗ The actual dataset contents
 * 
 * The proof binds to a Merkle commitment (root hash) that was published earlier,
 * ensuring the hospital cannot cherry-pick or fabricate data after the fact.
 * 
 * ═══════════════════════════════════════════════════════════════════════════
 * TECHNICAL SPECIFICATION
 * ═══════════════════════════════════════════════════════════════════════════
 * 
 * Parameters (compile-time constants):
 *   N - Number of data items in the dataset (e.g., 128, 256)
 *   DEPTH - Depth of the Merkle tree
 *           Must satisfy: 2^DEPTH >= N
 *           Example: N=128 requires DEPTH=7 (2^7=128)
 *                   N=256 requires DEPTH=8 (2^8=256)
 * 
 * Public Inputs (visible to verifier):
 *   root     - Merkle root commitment to the dataset (published earlier)
 *   N_public - Total number of items (must equal parameter N)
 *   c0       - Count of class-0 items (e.g., "healthy" patients)
 *   c1       - Count of class-1 items (e.g., "sick" patients)
 * 
 * Private Witness (known only to prover):
 *   bits[N]              - Binary labels for each item (0 or 1)
 *   siblings[N][DEPTH]   - Merkle proof siblings for each item
 *   pathIndices[N][DEPTH] - Path directions (0=left, 1=right) for each item
 * 
 * Constraints Enforced:
 *   1. BOOLEANITY: Each bit ∈ {0, 1} (no cheating with other values)
 *   2. COUNT ACCURACY: Sum of bits exactly equals c1
 *   3. TOTAL CONSISTENCY: c0 + c1 = N_public = N
 *   4. MEMBERSHIP: Each bit is proven to belong to the Merkle tree with root
 *   5. NON-NEGATIVITY: Counts are non-negative (enforced via field arithmetic)
 * 
 * Security Properties:
 *   ✓ Soundness: Cannot prove false counts without breaking Poseidon
 *   ✓ Zero-knowledge: Proof reveals only (c0, c1, N), not individual labels
 *   ✓ Binding: Tied to committed root; cannot change dataset retroactively
 * 
 * Performance (approximate, for BN254 curve):
 *   - Constraints: ~(153*DEPTH + 2) * N + 5
 *   - For N=128, DEPTH=7: ~138,000 constraints
 *   - Proving time: 2-5 seconds on modern CPU
 *   - Proof size: ~192 bytes (Groth16)
 *   - Verification time: ~2 milliseconds
 * 
 * ═══════════════════════════════════════════════════════════════════════════
 */

template BalanceProof(N, DEPTH) {
    // ═══════════════════════════════════════════════════════════════════════
    // INPUTS
    // ═══════════════════════════════════════════════════════════════════════
    
    // ────────── PUBLIC INPUTS (visible to everyone) ──────────
    signal input client_id;      // Client identifier: which client is proving
    signal input root;           // Merkle root: e.g., 0x3a7f2d...
    signal input N_public;       // Total count: e.g., 128
    signal input c0;             // Class-0 count: e.g., 60
    signal input c1;             // Class-1 count: e.g., 68

    // ────────── PRIVATE WITNESS (secret, known only to prover) ──────────
    signal input bits[N];                    // Secret labels: [0,1,1,0,1,...]
    signal input siblings[N][DEPTH];         // Merkle authentication paths
    signal input pathIndices[N][DEPTH];      // Path directions for each bit

    // ═══════════════════════════════════════════════════════════════════════
    // CONSTRAINT 1: BOOLEANITY CHECK
    // ═══════════════════════════════════════════════════════════════════════
    // Ensure each bit is either 0 or 1 (no other field elements allowed)
    // 
    // Mathematical trick: b * (b - 1) = 0 ⟺ b ∈ {0, 1}
    // Proof:
    //   - If b = 0: 0 * (0-1) = 0 * (-1) = 0 ✓
    //   - If b = 1: 1 * (1-1) = 1 * 0 = 0 ✓
    //   - If b = 2: 2 * (2-1) = 2 * 1 = 2 ✗ (constraint fails!)
    //   - If b = k: k * (k-1) = k² - k ≠ 0 for k ∉ {0,1} ✗
    // 
    // This is MORE efficient than: (b === 0) OR (b === 1)
    // because it's a single quadratic constraint per bit.
    
    for (var i = 0; i < N; i++) {
        bits[i] * (bits[i] - 1) === 0;
    }

    // ═══════════════════════════════════════════════════════════════════════
    // CONSTRAINT 2: COUNT VERIFICATION (Accurate Summation)
    // ═══════════════════════════════════════════════════════════════════════
    // Compute cumulative sum of bits and verify it equals the claimed c1
    // 
    // We use partial sums to avoid a single large summation:
    //   partialSums[0] = 0
    //   partialSums[1] = bits[0]
    //   partialSums[2] = bits[0] + bits[1]
    //   ...
    //   partialSums[N] = bits[0] + ... + bits[N-1] = (count of 1s)
    // 
    // This incremental approach:
    //   ✓ Breaks down into simple addition constraints
    //   ✓ Easier for the constraint solver
    //   ✓ More readable intermediate signals for debugging
    
    signal partialSums[N + 1];
    partialSums[0] <== 0;
    
    for (var i = 0; i < N; i++) {
        partialSums[i + 1] <== partialSums[i] + bits[i];
    }
    
    // Final cumulative sum must equal the claimed count of 1s
    partialSums[N] === c1;
    
    // Implicit: Since bits are boolean and sum to c1,
    // the count of 0s is (N - c1), which should equal c0.
    // This is enforced by the next constraint.

    // ═══════════════════════════════════════════════════════════════════════
    // CONSTRAINT 3: TOTAL COUNT CONSISTENCY
    // ═══════════════════════════════════════════════════════════════════════
    // Verify that the claimed counts add up to the total dataset size
    // 
    // Three checks in one:
    //   1. c0 + c1 = N_public (claimed counts must sum to claimed total)
    //   2. N_public = N (claimed total must match circuit parameter)
    //   3. Implicitly: c0, c1 ≥ 0 (enforced by field arithmetic and previous constraints)
    
    c0 + c1 === N_public;
    N_public === N;
    
    // Note on non-negativity:
    // In the finite field, if c0 or c1 were negative (i.e., wrapped around),
    // they would be HUGE numbers (~2^254 for BN254), making c0 + c1 > N impossible.
    // Combined with partialSums[N] === c1, this effectively enforces c1 >= 0.
    // And since c0 = N - c1 and N > 0, we get c0 >= 0 as well.

    // ═══════════════════════════════════════════════════════════════════════
    // CONSTRAINT 4: MERKLE MEMBERSHIP (Dataset Authenticity)
    // ═══════════════════════════════════════════════════════════════════════
    // Prove that EVERY bit came from the committed dataset
    // 
    // This is the CRITICAL security feature that prevents:
    //   ✗ Fabricating labels that weren't in the original dataset
    //   ✗ Using labels from a different dataset
    //   ✗ Cherry-picking a subset and making up the rest
    // 
    // The BatchMerkleProof verifies ALL N labels against the public root.
    // If even ONE label is fake or tampered, the proof fails.
    
    component merkleProofs = BatchMerkleProof(N, DEPTH);
    merkleProofs.root <== root;
    
    for (var i = 0; i < N; i++) {
        merkleProofs.values[i] <== bits[i];
        
        for (var j = 0; j < DEPTH; j++) {
            merkleProofs.siblings[i][j] <== siblings[i][j];
            merkleProofs.pathIndices[i][j] <== pathIndices[i][j];
        }
    }

    // ═══════════════════════════════════════════════════════════════════════
    // OUTPUT & VERIFICATION
    // ═══════════════════════════════════════════════════════════════════════
    // The circuit itself doesn't output signals beyond the constraints.
    // 
    // When the prover generates a proof:
    //   Input: secret bits + Merkle paths
    //   Output: a succinct proof π (~192 bytes for Groth16)
    // 
    // The verifier checks:
    //   Verify(root, N, c0, c1, π) → accept/reject
    // 
    // If verification passes, the verifier is convinced:
    //   ✓ The prover knows N binary labels
    //   ✓ Exactly c1 of them are 1, and c0 of them are 0
    //   ✓ All labels belong to the dataset committed to by 'root'
    //   ✗ But the verifier learns NOTHING about which specific labels are 0 or 1!
}

/*
 * ═══════════════════════════════════════════════════════════════════════════
 * CONFIGURATION & INSTANTIATION
 * ═══════════════════════════════════════════════════════════════════════════
 * 
 * To compile this circuit for different dataset sizes, choose appropriate
 * values for N and DEPTH:
 * 
 * ┌─────────┬───────┬──────────────────┬─────────────────┐
 * │ Dataset │ DEPTH │ Max Capacity     │ Constraints     │
 * │ Size N  │       │ (2^DEPTH)        │ (approximate)   │
 * ├─────────┼───────┼──────────────────┼─────────────────┤
 * │ 32      │ 5     │ 32               │ ~35,000         │
 * │ 64      │ 6     │ 64               │ ~70,000         │
 * │ 128     │ 7     │ 128              │ ~138,000        │
 * │ 256     │ 8     │ 256              │ ~275,000        │
 * │ 512     │ 9     │ 512              │ ~550,000        │
 * └─────────┴───────┴──────────────────┴─────────────────┘
 * 
 * IMPORTANT: Always ensure 2^DEPTH >= N, otherwise Merkle proofs won't work!
 * 
 * To instantiate with different parameters, change the main component below.
 */

// ═══════════════════════════════════════════════════════════════════════════
// MAIN COMPONENT INSTANTIATION
// ═══════════════════════════════════════════════════════════════════════════

// Default configuration: 128 items, depth 7
// Change these values as needed for your dataset size
component main {public [client_id, root, N_public, c0, c1]} = BalanceProof(128, 7);

/*
 * ALTERNATIVE CONFIGURATIONS (uncomment as needed):
 * 
 * // Small dataset (32 items):
 * // component main {public [root, N_public, c0, c1]} = BalanceProof(32, 5);
 * 
 * // Medium dataset (64 items):
 * // component main {public [root, N_public, c0, c1]} = BalanceProof(64, 6);
 * 
 * // Large dataset (256 items):
 * // component main {public [root, N_public, c0, c1]} = BalanceProof(256, 8);
 * 
 * // Extra large dataset (512 items, may be slow to prove):
 * // component main {public [root, N_public, c0, c1]} = BalanceProof(512, 9);
 */

/*
 * ═══════════════════════════════════════════════════════════════════════════
 * USAGE EXAMPLE (TypeScript/JavaScript)
 * ═══════════════════════════════════════════════════════════════════════════
 * 
 * // 1. Setup (one-time, generates proving/verification keys)
 * await exec("circom balance.circom --r1cs --wasm --sym");
 * await exec("snarkjs groth16 setup balance.r1cs ptau.ptau balance_0000.zkey");
 * await exec("snarkjs zkey contribute balance_0000.zkey balance_final.zkey");
 * await exec("snarkjs zkey export verificationkey balance_final.zkey vkey.json");
 * 
 * // 2. Build Merkle tree from dataset (off-circuit)
 * const labels = [0, 1, 1, 0, 1, 0, ...]; // Your binary dataset
 * const tree = buildMerkleTree(labels);
 * const root = tree.root();
 * 
 * // 3. Compute counts
 * const c0 = labels.filter(x => x === 0).length;
 * const c1 = labels.filter(x => x === 1).length;
 * 
 * // 4. Generate Merkle proofs for each label
 * const proofs = labels.map((_, i) => tree.proof(i));
 * 
 * // 5. Prepare witness
 * const input = {
 *   root: root,
 *   N_public: labels.length,
 *   c0: c0,
 *   c1: c1,
 *   bits: labels,
 *   siblings: proofs.map(p => p.siblings),
 *   pathIndices: proofs.map(p => p.pathIndices)
 * };
 * 
 * // 6. Generate proof
 * const { proof, publicSignals } = await snarkjs.groth16.fullProve(
 *   input,
 *   "balance_js/balance.wasm",
 *   "balance_final.zkey"
 * );
 * 
 * // 7. Verify proof
 * const vKey = JSON.parse(fs.readFileSync("vkey.json"));
 * const verified = await snarkjs.groth16.verify(vKey, publicSignals, proof);
 * console.log("Proof valid:", verified); // true if all constraints satisfied
 * 
 * ═══════════════════════════════════════════════════════════════════════════
 * INTEGRATION WITH OTHER COMPONENTS
 * ═══════════════════════════════════════════════════════════════════════════
 * 
 * This balance proof (Component A) is the first part of the three-component pipeline:
 * 
 * [A] BalanceProof (this file)
 *     ↓ proves dataset has c0 zeros, c1 ones under root R_D
 *     ↓
 * [B] TrainingProof (sgd_step.circom)
 *     ↓ proves correct SGD step using data from R_D
 *     ↓ binds gradient to commitment R_G
 *     ↓
 * [C] SecureAggProof (secure_agg_client.circom)
 *     ↓ proves masked message is well-formed from R_G
 *     ↓
 *    Server learns only aggregate, not individual updates
 * 
 * The Merkle root R_D connects all three components, ensuring end-to-end
 * verifiability from data properties → training → aggregation.
 */
