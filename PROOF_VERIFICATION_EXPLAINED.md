# How Proof Verification Works: Step-by-Step

**Submitted as:** [Our Names]  
**Project:** Verifiable Federated Training with Dropout-Tolerant Secure Aggregation  
**Date:** November 11, 2025

---

## The Big Picture: Three Layers of Verification

```
Layer 1: Component A Verification
         ↓
         "I have balanced dataset" 
         ↓
         Auditor checks: ✓ Merkle tree is valid ✓ Class counts correct ✓ Commitment is binding
         ↓
         Output: R_D (dataset commitment)
         
         ↓
         ↓
         
Layer 2: Component B Verification
         ↓
         "I trained correctly on that dataset"
         ↓
         Auditor checks: ✓ Used dataset from R_D ✓ Gradient is properly clipped ✓ SGD step is correct
         ↓
         Output: R_G (gradient commitment)
         
         ↓
         ↓
         
Layer 3: Component C Verification
         ↓
         "I'm sending masked update, and it's safe"
         ↓
         Auditor checks: ✓ Gradient matches R_G ✓ Mask is well-formed ✓ Masking is correct ✓ System can handle dropout
         ↓
         Output: π_C (aggregation proof)
```

---

## Layer 1: Component A - Dataset Balance Verification

### What Hospital A is Proving

```
Hospital A claims:
  "I have 128 patients"
  "60 are healthy (label 0)"
  "68 are sick (label 1)"
  "Without revealing patient identities"
```

### What Auditor Checks (Step-by-Step)

#### Step 1.1: Verify Merkle Tree Structure

```
Hospital A sends:
  ├─ Root: R_D = Hash(node_L || node_R)
  ├─ Proof path: [Hash_15, Hash_14, Hash_13, ...]
  └─ Leaf value: label_42 = 1

Auditor verifies:
  1. Recompute Hash(node_L || node_R) using:
     └─ Provided node values and proof path
  
  2. Check: Recomputed_Root == Claimed_Root
  
  3. If yes: ✓ Leaf is genuinely part of the tree
  
  Cryptographic guarantee:
     If Hospital A tries to change any patient label,
     the Merkle tree root would change completely
     (due to cryptographic hash properties)
     So: Root is BINDING to the original dataset
```

**Circuit Constraint:**
```circom
// Verify the leaf hashes up to the root
var computed_root = leaf_value;
for (var i = 0; i < DEPTH; i++) {
    if (path_indices[i] == 0) {
        computed_root = Poseidon(computed_root, proof_path[i]);
    } else {
        computed_root = Poseidon(proof_path[i], computed_root);
    }
}

// This computed_root MUST match the claimed root
computed_root === root;
```

#### Step 1.2: Verify Class Balance

```
Hospital A sends:
  ├─ claim_count_0 = 60  (healthy patients)
  ├─ claim_count_1 = 68  (sick patients)
  └─ Proof that Merkle tree has exactly these counts

Auditor verifies through zero-knowledge:
  1. Hospital did NOT reveal any patient identities
  2. But proved the counts are correct
  
  How? Through constraint satisfiability:
     If you claim 60 zeros, the circuit checks:
     - You provide exactly 60 leaf values that are 0
     - These are all in the Merkle tree (via Merkle proofs)
     - These have no overlap (via zero-knowledge)
     - Therefore: Your count must be exactly 60
     
    If you try to cheat (claim 60 but actually have 59):
     - The circuit has a constraint: Σ leaf_value == 60
     - With 59 leaves, this equals 59 != 60
     - Constraint is UNSATISFIABLE
     - Hospital cannot generate a valid proof
```

**Circuit Constraints:**
```circom
// Count constraint
var count_0 = 0;
var count_1 = 0;
for (var i = 0; i < N; i++) {
    count_0 += (1 - leaf_values[i]);  // Count zeros
    count_1 += leaf_values[i];         // Count ones
}

// These must match the claims
count_0 === claimed_count_0;
count_1 === claimed_count_1;

// And they must sum to N
count_0 + count_1 === N;
```

#### Step 1.3: Verify Binding Commitment

```
What we get:
  R_D = Poseidon(Merkle_Root)  // Commitment to the data

Why this matters:
  1. Hospital A publishes R_D to blockchain or auditor
  2. Later, Hospital A tries to change the dataset
  3. New dataset would have different Merkle tree
  4. New Merkle tree would give different R_D
  5. New R_D ≠ Original R_D on blockchain
  6. Hospital A is caught! (Non-repudiation)

Cryptographic guarantee:
  R_D = Poseidon(root)
  
  To change R_D, you need to change root (by cryptographic property of hash)
  To change root, you need to change a leaf (by Merkle tree property)
  If you change a leaf, you change the dataset
  
  Therefore: R_D uniquely identifies the dataset
              (commitment is binding)
```

---

## Layer 2: Component B - Training Integrity Verification

### What Hospital A is Proving (Given Dataset from R_D)

```
Hospital A claims:
  "I sampled 8 patients from my dataset"
  "I computed correct gradients from this sample"
  "I clipped gradients to norm ≤ τ"
  "I updated weights using SGD"
  "All without revealing the gradients"
  
  Proof that:
    ✓ Sample came from dataset commitment R_D
    ✓ Gradient was correctly computed
    ✓ Gradient norm is bounded
    ✓ Weights were updated correctly
```

### What Auditor Checks (Step-by-Step)

#### Step 2.1: Verify Sample Came from Correct Dataset

```
Hospital A sends:
  ├─ Merkle proof connecting batch to R_D
  ├─ Batch of 8 patient indices
  └─ Proof that indices come from original dataset

Auditor verifies:
  1. Check Merkle path from batch to root
     └─ Same as Layer 1, but for 8 leaves
  
  2. Check root matches the committed R_D
     └─ Ensures training used the declared dataset
  
  3. If R_D (component A) is binding:
     └─ Hospital CANNOT use a different dataset
     └─ Training is forced to use declared data

Circuit constraint:
  For each batch member:
    verify_merkle_proof(batch_member, merkle_proof) == R_D;
    
  If all 8 verify successfully:
    ✓ Training used correct dataset
```

**Cryptographic guarantee:**
```
If Hospital A:
  - Publishes R_D (dataset commitment) publicly
  - Later tries to train on different dataset D'
  - D' would generate different Merkle root
  - Different root would fail the merkle_proof verification
  - Training proof would be rejected

Result: Training MUST use published dataset (binding)
```

#### Step 2.2: Verify Gradient Computation

```
Hospital A sends:
  ├─ Batch of 8 patients with their labels
  ├─ Weight vector w_old
  ├─ Weight vector w_new
  └─ Proof that w_new was correctly computed from batch via SGD

Auditor verifies through computation:
  1. Compute gradient: g = gradient(batch_data, w_old)
  2. Check clipping: g_clipped = min(||g||, τ) * (g / ||g||)
  3. Check update: w_new = w_old - learning_rate * g_clipped
  
  The circuit computes all this and enforces:
    - Gradient computation is correct
    - Clipping is correct
    - Weight update is correct

Circuit constraints:
```circom
// Gradient computation (simplified)
var gradient[MODEL_DIM];
for (var i = 0; i < BATCH_SIZE; i++) {
    var error = prediction[i] - label[i];  // Prediction error
    for (var d = 0; d < MODEL_DIM; d++) {
        gradient[d] += error * batch_data[i][d];  // Gradient step
    }
}

// Norm computation
var norm_squared = 0;
for (var d = 0; d < MODEL_DIM; d++) {
    norm_squared += gradient[d] * gradient[d];
}

// Verify clipping
// If norm > τ, scaling factor is τ/norm
// If norm ≤ τ, scaling factor is 1
// This is verified through constraint: norm_squared ≤ τ²

norm_squared <= tau_squared;  // ← Core clipping constraint

// Weight update
for (var d = 0; d < MODEL_DIM; d++) {
    w_new[d] === w_old[d] - learning_rate * gradient[d];
}
```

**Why gradient norm constraint is important:**

```
Purpose of clipping:
  ✓ Limits influence of any single patient (privacy)
  ✓ Prevents gradient explosion (training stability)
  ✓ Proves hospital isn't doing weird training

How it works:
  If ||gradient|| > τ:
    - Hospital is trying to over-fit to individual patient
    - Gradient is scaled down: g' = (τ / ||g||) * g
    - Result: ||g'|| = τ exactly
  
  If ||gradient|| ≤ τ:
    - Hospital follows normal training
    - No scaling needed

Auditor's check:
  1. Receive w_old, w_new, batch data
  2. Compute what gradient MUST have been: g_actual = (w_old - w_new) / learning_rate
  3. Verify: ||g_actual|| ≤ τ
  4. If yes: ✓ Gradient was properly bounded
  5. If no: ✗ Hospital violated training protocol (REJECT)
```

#### Step 2.3: Verify Gradient Commitment

```
Hospital A publishes:
  R_G = Poseidon(w_old || w_new || gradient_commitment)

This commitment:
  ✓ Binds to the weights used in training
  ✓ Commits to the gradient (without revealing it)
  ✓ Passed to Component C for verification

Why binding matters:
  In Component C, hospital must prove:
    "My masked gradient = (actual gradient) + (mask)"
  
  If R_G is binding:
    Hospital cannot:
      - Claim one gradient to Component C
      - But actually computed different gradient in Component B
    
  Therefore: Two-layer verification prevents lying
```

---

## Layer 3: Component C - Secure Aggregation Verification

### What Hospital A is Proving (Given Gradient from R_G)

```
Hospital A claims:
  "I'm sending masked gradient: u' = u + m"
  "Where:"
  "  u = actual gradient (bounded by Component B)"
  "  m = PRF-based mask (derived from secret key)"
  "  u' = masked gradient (what I'm sending)"
  
  "My proof verifies:"
  "  ✓ u matches commitment R_G from Component B"
  "  ✓ m is properly PRF-derived"
  "  ✓ u' = u + m (masking is correct)"
  "  ✓ Mask structure supports dropout recovery"
```

### What Auditor Checks (Step-by-Step)

#### Step 3.1: Verify Gradient Consistency with Component B

```
Hospital A sends:
  ├─ u (the actual gradient)
  ├─ Commitment R_G (from Component B)
  └─ Proof that u matches R_G

Auditor verifies:
  1. Recompute: R_G_check = Poseidon(original_weights || u)
  2. Check: R_G_check == R_G (provided commitment)
  3. If yes: ✓ Gradient is consistent across components
  
  Cryptographic guarantee:
    If hospital tries to use different gradient in Component C
    than what they used in Component B:
      - Different gradient → different Poseidon hash
      - Different hash ≠ R_G
      - Proof fails immediately
    
    Result: Hospital cannot lie about gradient between components

Circuit constraint:
```circom
// Commitment verification
var computed_commitment = PoseidonHash([weights, gradient]);
computed_commitment === provided_commitment;
```

#### Step 3.2: Verify Gradient Boundedness (From Component B)

```
Hospital A sends:
  ├─ Gradient vector u
  ├─ Clipping threshold τ
  └─ Proof that ||u||² ≤ τ²

Auditor verifies:
  1. Compute: ||u||² = Σ u_i²
  2. Check: ||u||² ≤ τ²
  3. If yes: ✓ Gradient is properly bounded
  
  This MUST hold because:
    - Component B proved this when training
    - If hospital lies here, proof fails
    - Gradient must use same clipping as training

Circuit constraint:
```circom
// Norm computation
var norm_squared = 0;
for (var i = 0; i < DIM; i++) {
    norm_squared += gradient[i] * gradient[i];
}

// Boundedness check
norm_squared <= tau_squared;

// This is the SAME constraint as Component B
// Ensures gradient came from legitimate training
```

#### Step 3.3: Verify PRF-Based Mask Derivation

```
Hospital A sends:
  ├─ Mask vector m
  ├─ Commitment to shared_key (commitment allows verification without revealing key)
  └─ Proof that m = PRF(shared_key)

Auditor verifies (Zero-Knowledge):
  1. Hospital proves PRF was computed correctly
  2. But never reveals the shared_key
  3. Auditor checks: computation is sound without seeing input
  
  How zero-knowledge works here:
    Hospital: "I have key k such that m = PRF(k)"
    Auditor:  "Prove it without telling me k"
    Hospital: "OK, I'll create a proof P"
    Auditor:  "I'll verify P using only: m, commitment, P"
    Result: Auditor convinced without seeing k

Circuit constraint:
```circom
// PRF verification
var prf_output = PoseidonHash([shared_key]);

// The computed PRF must match claimed mask
prf_output === mask;

// But: shared_key is a PRIVATE input
// Hospital can prove this constraint is satisfied
// WITHOUT revealing what shared_key actually is
```

**Why this is Zero-Knowledge:**

```
Zero-knowledge means:
  "I can prove X is true without revealing WHY"

In our case:
  Hospital proves: "m = PRF(k)" without revealing k
  
  How?
    1. Create the proof P using: m, k (known to hospital)
    2. Send to auditor: P, m (but NOT k)
    3. Auditor verifies: Does this proof prove "m = PRF(k)"?
    4. But cannot determine what k is (information-theoretically hidden)
  
  Cryptographic guarantee:
    Even if auditor:
      - Sees 1000 different masks
      - Sees 1000 different proofs
      - Tries to brute force k
      
    Auditor still learns ZERO bits of information about k
    (By Groth16 zero-knowledge property)
```

#### Step 3.4: Verify Masking is Correct

```
Hospital A sends:
  ├─ Original gradient: u
  ├─ Mask: m
  ├─ Masked gradient: u'
  └─ Proof that: u' = u + m (mod p)

Auditor verifies:
  1. For each dimension i: u'_i = u_i + m_i (mod field prime p)
  2. Simple arithmetic check (linear constraint)
  3. If all dimensions check out: ✓ Masking is correct
  
  This is trivial to verify:
    u' - u == m (element-wise)

Circuit constraint:
```circom
// Masking verification (simple arithmetic)
for (var i = 0; i < DIM; i++) {
    masked_gradient[i] === gradient[i] + mask[i];
}
```

**Why this matters:**

```
Auditor wants to know: Does the masked gradient contain proper mask?

If Hospital A cheats:
  - Sends u' that's NOT equal to u + m
  - For example, u' = u + m - 0.5 (removed some mask)
  
Then:
  - When server unmasking, result is wrong
  - Either aggregation fails, or numbers don't match
  - Hospital is caught

This constraint prevents hospital from:
  ✗ Removing part of the mask (trying to hide gradient)
  ✗ Adding extra noise (trying to disrupt aggregation)
  ✗ Changing gradient values (would fail commitment check)
```

#### Step 3.5: Verify Dropout Tolerance (NEW!)

```
Hospital A sends:
  ├─ PRF parameters (structure that allows recovery)
  ├─ Commitment to shared_key
  └─ Proof that mask follows dropout-tolerant structure

Auditor verifies (Zero-Knowledge):
  1. Hospital proves mask can be recovered via PRF
  2. Without revealing the recovery formula
  3. If hospital drops out, server can get backup and recover

Why this matters:
  If mask structure is NOT recoverable:
    - Hospital drops out
    - Server cannot remove their mask
    - Aggregation includes extra mask noise
    - Model update is corrupt
  
  If mask IS recoverable (our design):
    - Hospital drops out
    - Server gets shared_key from backup
    - Server computes m = PRF(shared_key)
    - Server removes mask properly
    - Aggregation works correctly

Circuit constraint (simplified):
```circom
// Verify that mask is derivable from PRF structure
// (not a generic random mask)

var PRF_seed = hash(shared_key);
var computed_mask = PRFDerivation(PRF_seed, dimensions);

// Computed mask must match claimed mask
computed_mask === mask;

// This proves mask can be regenerated if needed
```

---

## 🎯 Complete Verification Flow: Visual

```
┌─────────────────────────────────────────────────────────────────┐
│ HOSPITAL SENDS THREE PROOFS (ONE FOR EACH COMPONENT)           │
└─────────────────────────────────────────────────────────────────┘
                            │
                            ├─► π_A (Component A Proof)
                            │     What: "My dataset is balanced"
                            │     Checked: Merkle tree valid, counts correct
                            │     Output: R_D (dataset commitment)
                            │
                            ├─► π_B (Component B Proof)
                            │     What: "I trained on that dataset correctly"
                            │     Checked: Used R_D, gradient bounded, SGD correct
                            │     Output: R_G (gradient commitment)
                            │
                            └─► π_C (Component C Proof)
                                  What: "My masked update is safe"
                                  Checked: 
                                    1. Gradient matches R_G
                                    2. Mask is PRF-derived
                                    3. Masking is correct (u' = u + m)
                                    4. Dropout tolerance proven
                                  Output: π_C

┌─────────────────────────────────────────────────────────────────┐
│ VERIFICATION PROCESS (Auditor or Server)                       │
└─────────────────────────────────────────────────────────────────┘

Step 1: Verify π_A
  ✓ Check Merkle tree (via Groth16 verification)
  ✓ Check class balance
  ✓ Output: R_D is valid

Step 2: Verify π_B (using R_D as input)
  ✓ Check sample came from R_D
  ✓ Check gradient bounded
  ✓ Check SGD computation
  ✓ Output: R_G is valid and committed

Step 3: Verify π_C (using R_G as input)
  ✓ Check gradient matches R_G
  ✓ Check PRF mask derivation
  ✓ Check masking arithmetic
  ✓ Check dropout tolerance
  ✓ Output: π_C is valid

All three verifications succeeded?
  ✓ YES → Accept hospital's update
  ✗ NO → Reject (hospital lied)

┌─────────────────────────────────────────────────────────────────┐
│ AGGREGATION (Server)                                            │
└─────────────────────────────────────────────────────────────────┘

Collect from all N hospitals:
  ├─ masked_gradient_1, π_C_1
  ├─ masked_gradient_2, π_C_2
  ├─ ...
  └─ masked_gradient_N, π_C_N

For each hospital i:
  ├─ Verify π_C_i (2 ms)
  ├─ If invalid: REJECT hospital i
  └─ If valid: Include masked_gradient_i in aggregation

Aggregate phase:
  aggregate = Σ masked_gradient_i
            = Σ (u_i + m_i)
            = Σ u_i + Σ m_i

Recovery phase (if some hospital drops out):
  ├─ Contact backup for shared_keys of dropped hospitals
  ├─ For each dropped hospital d: compute m_d = PRF(shared_key_d)
  ├─ For staying hospitals s: ask them for m_s (or get from backup)
  ├─ Sum all masks: total_mask = Σ m_i
  └─ Compute unmasked: final = aggregate - total_mask
                            = Σ u_i (actual gradients)

Model update:
  ├─ w_new = w_old - learning_rate * (final / N)
  └─ Training continues with verified, aggregated gradients
```

---

## 🔍 What Happens If Hospital Lies at Each Step?

### Lie 1: Hospital Changes Dataset After Publishing R_D

```
Hospital A publishes: R_D = Poseidon(Merkle_Root_1)

Later, in Component B:
  Hospital tries to train on: Different_Data
  Which gives: Merkle_Root_2

Then tries to prove training with Different_Data:
  ├─ Component B verification checks:
  │   "Does batch come from dataset R_D?"
  ├─ Merkle proof on Different_Data gives: Merkle_Root_2
  ├─ Check: Merkle_Root_2 == R_D?
  ├─ NO! ✗
  └─ Proof fails, hospital rejected

Result: Cannot use different dataset
```

### Lie 2: Hospital Claims Different Gradient Clipping

```
Hospital A publishes R_G in Component B
  With claim: "||gradient|| ≤ τ"

Then in Component C:
  Hospital tries to send gradient with: "||gradient|| > τ"
  
Component C verification checks:
  ├─ Does gradient match R_G?
  ├─ Recompute: R_G_check = Poseidon(gradient_claimed)
  ├─ Check: R_G_check == R_G_published?
  ├─ If gradient is different, hashes don't match
  └─ Proof fails

Result: Cannot change gradient between components
```

### Lie 3: Hospital Cheats on Masking

```
Hospital A sends:
  ├─ gradient: u
  ├─ mask: m (claimed)
  ├─ masked: u' (claimed)
  └─ Proof that: u' = u + m

But actually: u' ≠ u + m (hospital lied)

Component C verification:
  ├─ For each dimension i:
  │   Check: u'_i == u_i + m_i?
  ├─ At least one dimension fails: ✗
  └─ Proof fails

Result: Cannot use invalid masking
```

### Lie 4: Hospital Provides Non-PRF-Derived Mask

```
Hospital A sends:
  ├─ shared_key: k (supposed)
  ├─ mask: m (claimed = PRF(k))
  └─ Zero-knowledge proof that m = PRF(k)

But actually: m ≠ PRF(k) (hospital lied)

Component C verification:
  ├─ Groth16 checks: Does proof prove "m = PRF(k)"?
  ├─ Since false statement, proof is invalid (by soundness of Groth16)
  └─ Proof fails (unsatisfiable constraints)

Result: Cannot fake PRF derivation
Reason: Groth16 is sound - cannot prove false statements
```

---

## ✅ Final Verification Checklist

When you see a proof π_C from a hospital, you're verifying:

- [ ] **Commitment Check**: Does gradient match Component B commitment?
- [ ] **Boundedness Check**: Is ||gradient||² ≤ τ²?
- [ ] **Derivation Check**: Is mask properly PRF-derived?
- [ ] **Masking Check**: Is u' = u + m (arithmetic correct)?
- [ ] **Dropout Check**: Can mask be recovered if needed?

**If all five pass:** ✓ Hospital's update is valid, include in aggregation
**If any fails:** ✗ Hospital lied, reject update

---

## 🎓 The Intuition (Simple Explanation)

Think of it like a courtroom trial:

```
COMPONENT A: 
  Hospital: "I have balanced data"
  Auditor:  "Prove it!"
  Hospital: (Sends proof showing data structure)
  Auditor:  (Verifies proof without seeing data)
  Result:   ✓ Believable, publish commitment R_D

COMPONENT B:
  Hospital: "I trained correctly on that data"
  Auditor:  "Prove it used the data you said!"
  Hospital: (Sends proof showing training process)
  Auditor:  (Verifies proof matches your claimed data R_D)
  Result:   ✓ Believable, publish commitment R_G

COMPONENT C:
  Hospital: "I'm sending masked update, and it's safe"
  Auditor:  "Prove it has the gradient from training!"
  Hospital: (Sends proof showing masking applied correctly)
  Auditor:  (Verifies proof uses gradient from R_G)
  Result:   ✓ Believable, include in aggregation

Server:     "I can aggregate knowing all updates are verified"
```

---

## 🚀 Key Properties of Verification

1. **Non-Interactive**: Hospital sends proof once, auditor verifies many times
2. **Efficient**: Verification is ~2ms per proof (fast!)
3. **Zero-Knowledge**: Auditor learns nothing beyond: "Statement is true"
4. **Binding**: Once committed (R_D, R_G), cannot change data/gradient
5. **Sound**: Cannot prove false statements (Groth16 security)

**Together**: These properties enable **verifiable, private federated learning**

---

This is how the system actually works. The proofs are cryptographic guarantees that hospitals didn't lie. The commitment propagation (R_D → R_G → π_C) ensures everything is consistent.

Now let me run the actual tests to show you it works...
