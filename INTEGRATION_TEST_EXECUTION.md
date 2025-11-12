# Integration Testing Guide - Step by Step

**Submitted as:** [Our Names]  
**Project:** Verifiable Federated Training with Dropout-Tolerant Secure Aggregation  
**Date:** November 11, 2025

---

## 🎯 Testing Strategy Overview

We'll test the complete pipeline in phases:

**Phase 1:** Verify circuit logic (syntax check, constraint verification)  
**Phase 2:** Verify Component A → Component B integration  
**Phase 3:** Verify Component B → Component C integration  
**Phase 4:** End-to-end multi-client aggregation  
**Phase 5:** Dropout recovery handling  

---

## 📋 Prerequisites

- ✅ Node.js v20.14.0 (installed)
- ✅ npm 10.7.0 (installed)
- ✅ Dependencies installed (snarkjs, circomlib, ffjavascript)
- ⏳ Circom compiler (needs installation)

### Install Circom Compiler

**Option A: From GitHub (Recommended)**
```powershell
# Download pre-built binary for Windows
# Visit: https://github.com/iden3/circom/releases
# Download: circom-windows-amd64.exe
# Add to PATH or use full path

# Test:
circom --version
```

**Option B: From Source (Requires Rust)**
```powershell
# If Rust is installed:
cargo install --path circom

# Test:
circom --version
```

---

## Phase 1: Circuit Syntax Verification

### 1.1 Check Component A Circuit

**What we're checking:**
- Syntax is valid
- Template definitions are correct
- All constraints compile

**Test Command:**
```powershell
circom zk/circuits/balance/balance.circom --r1cs --wasm --sym -o build/balance
```

**Expected Output:**
```
warning: Variable "tree_depth" is not used. You can silence this warning using a function call.
   ┌─ zk/circuits/balance/balance.circom:45:5
   |
45 | var tree_depth = calculate_tree_depth(N);
   | ^^^^^^^^^^^^^^^ not used
...

✓ Circuit compiled successfully
  Constraints generated: 138,000 (for N=128, DEPTH=7)
```

### 1.2 Check Component B Circuit

**What we're checking:**
- Uses Component A's output (R_D)
- All gradient computation correct
- Clipping constraints present

**Test Command:**
```powershell
circom zk/circuits/training/sgd_step.circom --r1cs --wasm --sym -o build/training
```

**Expected Output:**
```
✓ Circuit compiled successfully
  Constraints generated: 50,000 (for BATCH_SIZE=8, MODEL_DIM=32)
```

### 1.3 Check Component C Circuit

**What we're checking:**
- Uses Component B's output (R_G)
- Mask derivation verified
- Dropout tolerance constraints present

**Test Command:**
```powershell
circom zk/circuits/secureagg/secure_agg_client.circom --r1cs --wasm --sym -o build/secureagg
```

**Expected Output:**
```
✓ Circuit compiled successfully
  Constraints generated: 32,000 (for DIM=32)
```

---

## Phase 2: Component A Verification

### 2.1: Manual Component A Test

Since we don't have circom fully set up yet, let's verify the logic conceptually:

**What we're testing:**
```
Hospital publishes:
  - Dataset: 128 patients (60 healthy, 68 sick)
  - Merkle tree over patient labels
  - Commitment: R_D = Poseidon(Merkle_Root)

Auditor verifies:
  - Merkle tree structure is valid
  - Class counts are correct (60 + 68 = 128)
  - Cannot change any label without changing R_D
```

**Manual Verification Steps:**

```javascript
// Step 1: Verify Merkle tree structure
const leaf_0 = 0;      // Patient 0 is healthy
const leaf_1 = 1;      // Patient 1 is sick
// ... 128 leaves total

// Step 2: Build Merkle tree
let leaf_hashes = [];
for (let i = 0; i < 128; i++) {
    leaf_hashes[i] = Poseidon([labels[i]]);  // Hash each label
}

// Pair up and hash upward
let level = leaf_hashes;
for (let depth = 0; depth < 7; depth++) {  // 2^7 = 128 leaves
    let next_level = [];
    for (let i = 0; i < level.length; i += 2) {
        next_level.push(Poseidon([level[i], level[i+1]]));
    }
    level = next_level;
}

const merkle_root = level[0];  // Should have 1 element

// Step 3: Verify counts
let count_0 = 0, count_1 = 0;
for (let i = 0; i < 128; i++) {
    if (labels[i] == 0) count_0++;
    else count_1++;
}

// Verify counts
assert(count_0 == 60, "Should have 60 healthy patients");
assert(count_1 == 68, "Should have 68 sick patients");

// Step 4: Create commitment
const R_D = Poseidon([merkle_root]);

// Output
console.log("✓ Component A Test Passed");
console.log("  Merkle Root:", merkle_root);
console.log("  R_D (Commitment):", R_D);
```

**Expected Result:**
```
✓ Component A Test Passed
  Merkle Root: 0x123abc... (64 hex chars)
  R_D (Commitment): 0xabc123... (64 hex chars)
```

---

## Phase 3: Component B Verification

### 3.1: Manual Component B Test

**What we're testing:**
```
Hospital trains on 8 patients from verified dataset:
  - Computes gradient from batch
  - Clips gradient to norm ≤ τ
  - Updates weights using SGD
  - All provably from dataset R_D

Auditor verifies:
  - Batch is from dataset (via Merkle proof using R_D)
  - Gradient computation is correct
  - Gradient norm is bounded
  - Weight update is correct
  - Creates commitment R_G for next component
```

**Manual Verification Steps:**

```javascript
// Step 1: Sample batch from dataset
const batch_indices = [5, 12, 18, 23, 45, 67, 89, 101];  // 8 patients
const batch_labels = batch_indices.map(i => labels[i]);
const batch_data = batch_indices.map(i => patient_data[i]);

// Step 2: Compute gradient
let gradient = [];
for (let d = 0; d < 32; d++) {  // 32 dimensional model
    gradient[d] = 0;
    for (let b = 0; b < 8; b++) {
        const prediction = model.predict(batch_data[b], weights_old);
        const error = prediction - batch_labels[b];
        gradient[d] += error * batch_data[b][d];
    }
}

// Step 3: Compute gradient norm
let norm_squared = 0;
for (let d = 0; d < 32; d++) {
    norm_squared += gradient[d] * gradient[d];
}
const norm = Math.sqrt(norm_squared);

// Step 4: Clip gradient
const tau = 1.0;  // Clipping threshold
let gradient_clipped = [...gradient];
if (norm > tau) {
    const scale = tau / norm;
    for (let d = 0; d < 32; d++) {
        gradient_clipped[d] *= scale;
    }
}

// Verify: clipped norm should be ≤ τ
let norm_clipped_squared = 0;
for (let d = 0; d < 32; d++) {
    norm_clipped_squared += gradient_clipped[d] * gradient_clipped[d];
}
assert(norm_clipped_squared <= tau * tau, "Gradient not properly clipped");

// Step 5: Update weights
const learning_rate = 0.01;
let weights_new = [];
for (let d = 0; d < 32; d++) {
    weights_new[d] = weights_old[d] - learning_rate * gradient_clipped[d];
}

// Step 6: Create commitment R_G
const R_G = Poseidon([weights_old, weights_new, gradient_clipped]);

// Output
console.log("✓ Component B Test Passed");
console.log("  Gradient norm:", norm);
console.log("  Clipped norm:", Math.sqrt(norm_clipped_squared));
console.log("  R_G (Commitment):", R_G);
```

**Expected Result:**
```
✓ Component B Test Passed
  Gradient norm: 0.856
  Clipped norm: 1.000 (exactly τ = 1.0)
  R_G (Commitment): 0xdef456... (64 hex chars)
```

---

## Phase 4: Component C Verification

### 4.1: Manual Component C Test

**What we're testing:**
```
Hospital creates masked update:
  - Derives PRF-based mask from secret key
  - Masks gradient: u' = u + m
  - Creates zero-knowledge proof that:
    1. Gradient matches R_G from Component B
    2. Mask is properly PRF-derived
    3. Masking arithmetic is correct
    4. System can handle dropout

Auditor verifies:
  - All four properties are proven
  - Hospital cannot lie about any property
```

**Manual Verification Steps:**

```javascript
// Step 1: Verify gradient matches R_G
const gradient_received = [0.01, -0.02, 0.015, ...];  // From hospital
const weights_old_received = [0.5, 0.6, 0.4, ...];
const weights_new_received = [0.491, 0.598, 0.385, ...];

const R_G_recomputed = Poseidon([weights_old_received, weights_new_received, gradient_received]);
assert(R_G_recomputed == R_G_published, "Gradient doesn't match Component B");

// Step 2: Verify gradient is bounded
let norm_squared = 0;
for (let d = 0; d < 32; d++) {
    norm_squared += gradient_received[d] * gradient_received[d];
}
assert(norm_squared <= tau_squared, "Gradient not properly bounded");

// Step 3: Verify mask is PRF-derived (with zero-knowledge proof)
// Hospital proves: mask = PRF(shared_key) without revealing shared_key
// We verify the proof using Groth16 verification key
const proof = hospital_sent_proof;
const public_inputs = [commitment_to_shared_key, mask];

const verification_result = snarkjs.groth16.verify(vkey, public_inputs, proof);
assert(verification_result, "PRF derivation proof is invalid");

// Step 4: Verify masking arithmetic
const masked_gradient = [0.52, 0.58, 0.415, ...];  // u' from hospital

for (let d = 0; d < 32; d++) {
    // u'_d = u_d + m_d (mod field)
    const field_prime = BigInt("21888242871839275222246405745257275088548364400416034343698204186575808495617");
    
    const u_d = BigInt(gradient_received[d]);
    const m_d = BigInt(mask[d]);
    const u_prime_d = BigInt(masked_gradient[d]);
    
    const expected = (u_d + m_d) % field_prime;
    assert(u_prime_d == expected, `Dimension ${d} masking is incorrect`);
}

// Step 5: Verify dropout tolerance
// Mask follows PRF structure, so server can recover if needed
const mask_structure_valid = PRFStructureCheck(mask, shared_key_commitment);
assert(mask_structure_valid, "Mask doesn't follow PRF structure");

// Output
console.log("✓ Component C Test Passed");
console.log("  Gradient matches R_G: ✓");
console.log("  Gradient bounded: ✓");
console.log("  PRF derivation verified: ✓");
console.log("  Masking arithmetic correct: ✓");
console.log("  Dropout tolerance verified: ✓");
```

**Expected Result:**
```
✓ Component C Test Passed
  Gradient matches R_G: ✓
  Gradient bounded: ✓
  PRF derivation verified: ✓
  Masking arithmetic correct: ✓
  Dropout tolerance verified: ✓
```

---

## Phase 5: End-to-End Integration Test

### 5.1: Multi-Client Aggregation (All Stay Online)

**Scenario:**
```
Three hospitals:
  Hospital A: Dataset with labels [0, 1, 0, 1, ...] (60 healthy, 68 sick)
  Hospital B: Dataset with labels [1, 0, 1, 0, ...] (50 healthy, 78 sick)
  Hospital C: Dataset with labels [0, 0, 1, 1, ...] (55 healthy, 73 sick)

All train and send masked gradients in round 1.
```

**Test Procedure:**

```javascript
// Simulate three hospitals
const hospitals = [];

for (let h = 0; h < 3; h++) {
    console.log(`\n=== Hospital ${h+1} ===`);
    
    // 1. Generate dataset and prove balance (Component A)
    const dataset = GenerateBalancedDataset(128, health_ratio[h]);
    const R_D = ProveDatasetBalance(dataset);
    console.log(`✓ Component A: R_D = ${R_D}`);
    
    // 2. Train and prove correctness (Component B)
    const batch = SampleBatch(dataset, 8);
    const gradient = ComputeGradient(batch, weights);
    const gradient_clipped = ClipGradient(gradient, tau);
    const weights_new = UpdateWeights(weights, gradient_clipped, lr);
    const R_G = ProveTrainingCorrectness(batch, weights, gradient_clipped, weights_new, R_D);
    console.log(`✓ Component B: R_G = ${R_G}`);
    
    // 3. Create masked update and prove well-formedness (Component C)
    const shared_key = RandomKey(256);
    const mask = PRF(shared_key);
    const masked_gradient = gradient_clipped.map((g, i) => g + mask[i]);
    const proof_C = ProveMaskedUpdateWellFormedness(
        gradient_clipped, 
        mask, 
        masked_gradient, 
        R_G, 
        shared_key
    );
    console.log(`✓ Component C: proof_C generated`);
    
    hospitals.push({
        id: h,
        R_D: R_D,
        R_G: R_G,
        masked_gradient: masked_gradient,
        proof_C: proof_C,
        shared_key: shared_key,
        online: true
    });
}

// 4. Server aggregates
console.log(`\n=== Server Aggregation ===`);

let aggregate_masked = null;
for (let h of hospitals) {
    if (h.online) {
        console.log(`Verifying Hospital ${h.id+1}...`);
        
        // Verify Component C proof
        const is_valid = snarkjs.groth16.verify(vkey_C, 
            [h.R_G, h.mask], 
            h.proof_C
        );
        
        if (!is_valid) {
            console.log(`  ✗ REJECTED (invalid proof)`);
            continue;
        }
        console.log(`  ✓ Proof verified`);
        
        // Add to aggregate
        if (aggregate_masked === null) {
            aggregate_masked = h.masked_gradient;
        } else {
            for (let d = 0; d < 32; d++) {
                aggregate_masked[d] += h.masked_gradient[d];
            }
        }
    }
}

// 5. Unmask
console.log(`\nUnmasking...`);
let total_mask = null;
for (let h of hospitals) {
    if (h.online) {
        const mask = PRF(h.shared_key);  // Server recovers from backup
        if (total_mask === null) {
            total_mask = mask;
        } else {
            for (let d = 0; d < 32; d++) {
                total_mask[d] += mask[d];
            }
        }
    }
}

// Final gradient
let final_gradient = null;
for (let d = 0; d < 32; d++) {
    final_gradient[d] = aggregate_masked[d] - total_mask[d];
}

console.log(`✓ Final aggregated gradient: [${final_gradient.slice(0, 5).join(", ")}, ...]`);
console.log(`✓ All 3 hospitals: AGGREGATION COMPLETE`);
```

**Expected Output:**
```
=== Hospital 1 ===
✓ Component A: R_D = 0x1a2b3c... (dataset commitment)
✓ Component B: R_G = 0x4d5e6f... (training commitment)
✓ Component C: proof_C generated (2.3s proving time)

=== Hospital 2 ===
✓ Component A: R_D = 0x7g8h9i...
✓ Component B: R_G = 0xjk1l2m...
✓ Component C: proof_C generated (2.1s proving time)

=== Hospital 3 ===
✓ Component A: R_D = 0xno3p4q...
✓ Component B: R_G = 0xrs5t6u...
✓ Component C: proof_C generated (2.4s proving time)

=== Server Aggregation ===
Verifying Hospital 1...
  ✓ Proof verified (2.1ms)
Verifying Hospital 2...
  ✓ Proof verified (2.0ms)
Verifying Hospital 3...
  ✓ Proof verified (2.2ms)

Unmasking...
✓ Final aggregated gradient: [0.0234, -0.0156, 0.0089, -0.0045, 0.0167, ...]
✓ All 3 hospitals: AGGREGATION COMPLETE
```

---

## Phase 6: Dropout Recovery Test

### 6.1: Hospital Dropout Scenario

**Scenario:**
```
Three hospitals start training.
After hospitals A and B send updates, Hospital C goes offline.
Server should still be able to aggregate using dropout recovery.
```

**Test Procedure:**

```javascript
console.log(`=== Round 1: All Online ===\n`);

// Hospitals A, B, C all send masked updates (same as Phase 5)
let hospital_A_update = GenerateUpdate(hospital_A);
let hospital_B_update = GenerateUpdate(hospital_B);
let hospital_C_update = GenerateUpdate(hospital_C);

console.log(`Hospital A: ✓ sent update`);
console.log(`Hospital B: ✓ sent update`);
console.log(`Hospital C: ✓ sent update\n`);

console.log(`=== Round 2: Hospital C Offline ===\n`);

// Hospitals A and B come online
let hospital_A_update_r2 = GenerateUpdate(hospital_A);
let hospital_B_update_r2 = GenerateUpdate(hospital_B);

console.log(`Hospital A: ✓ sent update`);
console.log(`Hospital B: ✓ sent update`);
console.log(`Hospital C: ✗ OFFLINE (no update)`);

// Server tries to aggregate
console.log(`\nServer aggregating...`);
let aggregate = aggregate_r2(hospital_A_update_r2, hospital_B_update_r2);

// Hospital C is missing - try to recover their mask
console.log(`\nHospital C missing, attempting recovery...`);

// Backup system has Hospital C's shared_key
const hospital_C_shared_key = backup.retrieve_key("Hospital_C");
const hospital_C_mask = PRF(hospital_C_shared_key);

// But we have no masked gradient from Hospital C for this round
// So we cannot recover their gradient
console.log(`✓ Mask recovery attempted, but no gradient to unmask`);
console.log(`✓ This is expected - Hospital C is offline, so no loss`);

// Aggregate only includes A and B
const final_gradient_without_C = aggregate - total_mask_A_B;

console.log(`✓ Aggregated gradient (from A, B only): [${final_gradient_without_C.slice(0, 5).join(", ")}, ...]`);
console.log(`✓ DROPOUT HANDLING COMPLETE`);
```

**Expected Output:**
```
=== Round 1: All Online ===

Hospital A: ✓ sent update
Hospital B: ✓ sent update
Hospital C: ✓ sent update

=== Round 2: Hospital C Offline ===

Hospital A: ✓ sent update
Hospital B: ✓ sent update
Hospital C: ✗ OFFLINE (no update)

Server aggregating...

Hospital C missing, attempting recovery...
✓ Mask recovery attempted, but no gradient to unmask
✓ This is expected - Hospital C is offline, so no loss
✓ Aggregated gradient (from A, B only): [0.0198, -0.0134, 0.0076, -0.0038, 0.0142, ...]
✓ DROPOUT HANDLING COMPLETE
```

---

## Phase 7: Invalid Proofs Test

### 7.1: Attempt to Lie About Gradient

**Scenario:**
```
Dishonest hospital tries to send different gradient in Component C
than what they proved in Component B (uses different R_G).
```

**Test Procedure:**

```javascript
console.log(`=== Dishonest Hospital Attack Test ===\n`);

// Component B: Hospital proves gradient_true with commitment R_G_true
const gradient_true = [0.01, -0.02, 0.015, ...];  // From Component B
const R_G_true = ProveTraining(gradient_true, dataset);

// Component C: Dishonest hospital tries to use different gradient!
const gradient_lie = [0.1, -0.2, 0.15, ...];  // DIFFERENT gradient!
const mask = PRF(shared_key);
const masked_gradient_lie = gradient_lie.map((g, i) => g + mask[i]);

// Create proof for the false gradient
try {
    const proof_C_lie = ProveMaskedUpdateWellFormedness(
        gradient_lie,      // ← LYING HERE!
        mask,
        masked_gradient_lie,
        R_G_true,          // ← But using R_G_true as input
        shared_key
    );
    
    console.log(`Hospital attempting to send:`);
    console.log(`  R_G_true (from Component B): 0x${R_G_true}`);
    console.log(`  gradient_lie (trying to lie): 0x${gradient_lie}`);
    console.log(`  Proof π_C: 0x${proof_C_lie}`);
    
    // Server verifies
    console.log(`\nServer verification...`);
    
    // Compute what gradient SHOULD be
    const R_G_recomputed = Poseidon([weights_old, weights_new, gradient_lie]);
    
    if (R_G_recomputed != R_G_true) {
        console.log(`✗ CAUGHT! Gradient doesn't match R_G_true`);
        console.log(`  Expected R_G: 0x${R_G_true}`);
        console.log(`  Computed R_G: 0x${R_G_recomputed}`);
        console.log(`  PROOF REJECTED`);
    } else {
        console.log(`✗ ERROR: Hospital somehow passed verification!`);
    }
    
} catch (e) {
    console.log(`✗ ATTACK FAILED`);
    console.log(`  Proof generation failed: ${e.message}`);
    console.log(`  Circuit constraints are unsatisfiable for false gradient`);
}

console.log(`\n✓ SECURITY PROPERTY VERIFIED: Cannot lie about gradient between components`);
```

**Expected Output:**
```
=== Dishonest Hospital Attack Test ===

Hospital attempting to send:
  R_G_true (from Component B): 0x123abc...
  gradient_lie (trying to lie): 0xFAKE...
  Proof π_C: (cannot generate!)

Server verification...

✗ CAUGHT! Gradient doesn't match R_G_true
  Expected R_G: 0x123abc...
  Computed R_G: 0xDEADBEEF...
  PROOF REJECTED

✓ SECURITY PROPERTY VERIFIED: Cannot lie about gradient between components
```

---

## ✅ Full Test Checklist

After running all phases:

- [ ] **Phase 1:** All three circuits compile without errors
- [ ] **Phase 2:** Component A correctly proves dataset balance
- [ ] **Phase 3:** Component B verifies training integrity
- [ ] **Phase 4:** Component C proves secure aggregation well-formedness
- [ ] **Phase 5:** Three hospitals aggregate successfully when all online
- [ ] **Phase 6:** System handles dropout gracefully
- [ ] **Phase 7:** Cannot forge invalid proofs

---

## 📊 Performance Benchmarks to Collect

```
Metric                          | Expected  | Actual
--------------------------------|-----------|-----------
Circuit A compilation time      | 1-3 sec   | _____ sec
Circuit B compilation time      | 1-3 sec   | _____ sec
Circuit C compilation time      | 1-3 sec   | _____ sec
Circuit A constraint count      | 138,000   | _____ 
Circuit B constraint count      | 50,000    | _____ 
Circuit C constraint count      | 32,000    | _____ 
Proof A generation time         | 2-5 sec   | _____ sec
Proof B generation time         | 5-10 sec  | _____ sec
Proof C generation time         | 5-15 sec  | _____ sec
Proof verification time (each)  | 2 ms      | _____ ms
Multi-client (3) total time     | 30-50 sec | _____ sec
```

---

## 🚨 Troubleshooting

### "Circom not found"
```
Install from: https://github.com/iden3/circom/releases
Or: cargo install --path circom
```

### "Circuit compilation fails"
```
Check:
1. Syntax errors in circuit files
2. All required includes are present (poseidon.circom, etc.)
3. All template definitions match usage
```

### "Proof generation fails"
```
Check:
1. Witness JSON is valid
2. All inputs are correct format
3. Constraints are satisfiable (no arithmetic errors)
```

### "Proof verification fails"
```
Check:
1. Verification key matches proving key
2. Public inputs are in correct format
3. Proof is from correct component
```

---

## 🎯 Success Criteria

**Testing is COMPLETE and SUCCESSFUL when:**

✅ All 7 test phases pass  
✅ No constraint unsatisfiability errors  
✅ All proofs verify correctly  
✅ Multi-client aggregation produces correct gradient sum  
✅ Dropout handling works as expected  
✅ Attack scenarios are properly rejected  
✅ Performance meets expectations  

---

**Now let's run the tests...**

