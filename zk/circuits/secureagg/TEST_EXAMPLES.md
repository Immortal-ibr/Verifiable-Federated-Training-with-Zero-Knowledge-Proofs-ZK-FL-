# Component C: Testing & Examples

**Date:** November 11, 2025  
**Purpose:** Concrete examples and test cases for the secure aggregation circuit

---

## Example 1: Valid Honest Client

### Scenario
Client 1 submits a well-formed masked update for aggregation.

**Parameters:**
- Model dimension: 32
- Gradient l2-norm: 0.5 (well below τ=1.0)
- Clipping threshold: τ = 1.0

**Input JSON** (`example1_valid.json`):

```json
{
  "client_id": "1",
  "shared_key_hash": "12345678901234567890123456789012",
  "root_G": "98765432109876543210987654321098",
  "tau_squared": "1000000",
  
  "masked_update": [
    "600",    "100",   "-150",   "200",   "-50",    "75",
    "120",   "-80",    "160",   "-90",    "110",   "70",
    "-140",   "85",    "-70",    "130",  "-110",   "95",
    "150",   "-120",   "100",   "-60",    "140",   "80",
    "-170",   "125",   "-100",   "90",    "-130",  "110",
    "160",   "-140",   "120",   "-95"
  ],
  
  "gradient": [
    "100",    "-50",   "-200",   "50",    "-150",   "25",
    "120",   "-80",    "160",   "-90",    "110",    "70",
    "-140",   "85",    "-70",    "130",   "-110",   "95",
    "150",   "-120",   "100",   "-60",    "140",    "80",
    "-170",   "125",   "-100",   "90",    "-130",   "110",
    "160",   "-140",   "120",   "-95"
  ],
  
  "mask": [
    "500",    "150",    "50",    "150",   "100",    "50",
    "0",      "0",      "0",     "0",     "0",      "0",
    "0",      "0",      "0",     "0",     "0",      "0",
    "0",      "0",      "0",     "0",     "0",      "0",
    "0",      "0",      "0",     "0",     "0",      "0",
    "0",      "0",      "0",     "0"
  ],
  
  "prf_seed": "87654321098765432109876543210987"
}
```

**Expected Result:** ✅ PASS

**Why:**
- Gradient norm: √(100² + 50² + 200² + ...) ≈ 500 < 1000 (τ² threshold) ✓
- Masking correct: 600 = 100 + 500, 100 = -50 + 150, etc. ✓
- All values reasonable ✓

---

## Example 2: Unbounded Gradient (Should FAIL)

### Scenario
Client 2 tries to send an unbounded gradient (exceeds clipping threshold).

**Input JSON** (`example2_unbounded.json`):

```json
{
  "client_id": "2",
  "shared_key_hash": "11111111111111111111111111111111",
  "root_G": "22222222222222222222222222222222",
  "tau_squared": "1000000",
  
  "masked_update": [
    "5000", "3000", "-4000", "2000", "-3000", "1000",
    ...  // Large values
  ],
  
  "gradient": [
    "4000", "2500", "-3500", "1500", "-2500", "500",
    ...  // Large gradient: ‖g‖ >> 1000
  ],
  
  "mask": [
    "1000", "500", "-500", "500", "-500", "500",
    ...
  ],
  
  "prf_seed": "33333333333333333333333333333333"
}
```

**Expected Result:** ❌ FAIL

**Why:** Gradient norm exceeds τ² threshold

**Circuit Check:** Line in `secure_agg_client.circom`:
```circom
// CONSTRAINT 1: GRADIENT BOUNDEDNESS
component boundCheck = GradientBoundednessProof(DIM, PRECISION);
boundCheck.tau_squared <== tau_squared;  // Must pass: ‖g‖² ≤ τ²
```

---

## Example 3: Incorrect Masking (Should FAIL)

### Scenario
Client 3 tries to cheat by not properly masking the update.

**Input JSON** (`example3_bad_masking.json`):

```json
{
  "client_id": "3",
  "shared_key_hash": "33333333333333333333333333333333",
  "root_G": "44444444444444444444444444444444",
  "tau_squared": "1000000",
  
  "masked_update": [
    "600",    "100",   "-150",   "200",   "-50",    "75",  // These are correct
    "120",   "-80",    "160",   "-90",    "110",    "70",
    ...
  ],
  
  "gradient": [
    "100",    "-50",   "-200",   "50",    "-150",   "25",
    "120",   "-80",    "160",   "-90",    "110",    "70",
    ...
  ],
  
  "mask": [
    "600",    "200",    "100",   "200",   "100",    "100",  // WRONG MASK!
    // Should be: masked_update[i] = gradient[i] + mask[i]
    // Check: 600 = 100 + mask[0] → mask[0] should be 500, not 600!
    ...
  ],
  
  "prf_seed": "55555555555555555555555555555555"
}
```

**Expected Result:** ❌ FAIL

**Why:** Masking constraint violated: masked_update[0] ≠ gradient[0] + mask[0]

**Circuit Check:** Line in `secure_agg_client.circom`:
```circom
// CONSTRAINT 3: MASKING CORRECTNESS
for (var i = 0; i < DIM; i++) {
    masked_update[i] === gradient[i] + mask[i];  // This constraint fails!
}
```

---

## Example 4: Dropout Scenario (Multiple Clients)

### Scenario
10 clients submit, but client #5 disconnects. Server should still aggregate correctly.

**Submissions:**
```
Client 1: ✓ Submit proof & masked_update
Client 2: ✓ Submit proof & masked_update
Client 3: ✓ Submit proof & masked_update
Client 4: ✓ Submit proof & masked_update
Client 5: ✗ DROPPED OUT (no submission)
Client 6: ✓ Submit proof & masked_update
Client 7: ✓ Submit proof & masked_update
Client 8: ✓ Submit proof & masked_update
Client 9: ✓ Submit proof & masked_update
Client 10: ✓ Submit proof & masked_update
```

**Server-side aggregation:**

```javascript
// 1. Verify proofs
const submissions = await collectFromClients();
const verifiedSubmissions = [];

for (const submission of submissions) {
  const isValid = await verifyProof(submission);
  if (isValid) {
    verifiedSubmissions.push(submission);
    console.log(`✓ Client ${submission.clientId}`);
  }
}

// Result: 9 verified clients (not client 5)
console.log("Active clients: 1,2,3,4,6,7,8,9,10");

// 2. Aggregate masked updates
let aggregate = vectorZeros(32);
for (const submission of verifiedSubmissions) {
  aggregate = vectorAdd(aggregate, submission.maskedUpdate);
}
// aggregate = u'_1 + u'_2 + ... + u'_4 + u'_6 + ... + u'_10
// (missing u'_5)

// 3. Remove masks from active clients
for (const submission of verifiedSubmissions) {
  const mask = recoverMaskFromSharedKey(submission.clientId);
  aggregate = vectorSubtract(aggregate, mask);
}
// aggregate = (u'_1 + ... + u'_4) - (m_1 + ... + m_4)
//           + (u'_6 + ... + u'_10) - (m_6 + ... + m_10)
//           = (u_1 + m_1 - m_1) + ... + (u_4 + m_4 - m_4)
//             + (u_6 + m_6 - m_6) + ... + (u_10 + m_10 - m_10)
//           = u_1 + u_2 + u_3 + u_4 + u_6 + u_7 + u_8 + u_9 + u_10

// 4. Handle dropped client (optional)
// Option A: Just use what we have (simpler)
// Option B: Add back mask of dropped client
const client5Mask = recoverMaskFromSharedKey(5);
// aggregate now includes term for client 5's mask
// This is fine - it's just noise that cancels with client 5's masked update
// if they were online

console.log("Final clean aggregate = sum of active clients' gradients");
```

**Expected Result:** ✅ Server successfully aggregates without client 5

**Why:** Each client's mask is deterministically derived from shared key

---

## Example 5: Dropout with Server Recovery

### Detailed Recovery Scenario

**Setup:**
- 10 clients total
- Each client i has shared_key_i (derived from DH protocol)
- Server stored all 10 shared_keys in secure backup

**Round t execution:**
```
Clients 1,2,3,4: ✓ Online (submit u'_i, π_i)
Clients 5,6,7,8,9,10: ✗ Disconnected (no submission)
```

**Server Recovery:**
```python
# Received submissions
active_clients = {1, 2, 3, 4}
dropped_clients = {5, 6, 7, 8, 9, 10}

# Step 1: Aggregate from active clients
aggregate_masked = sum(u'_i for i in active_clients)
# = u'_1 + u'_2 + u'_3 + u'_4
# = (u_1 + m_1) + (u_2 + m_2) + (u_3 + m_3) + (u_4 + m_4)

# Step 2: Recover masks of active clients (from backup)
masks_active = {}
for i in active_clients:
    masks_active[i] = PRF(shared_key_i)  # Server knows shared_key_i

# Step 3: Remove masks of active clients
aggregate_clean = aggregate_masked
for i in active_clients:
    aggregate_clean -= masks_active[i]
# = (u_1 + m_1) + (u_2 + m_2) + (u_3 + m_3) + (u_4 + m_4)
#   - m_1 - m_2 - m_3 - m_4
# = u_1 + u_2 + u_3 + u_4

# Step 4: Optional - add masks of dropped clients
# (to keep aggregate consistent, though this is debatable)
for i in dropped_clients:
    mask_i = PRF(shared_key_i)  # Server recovers from backup
    aggregate_clean += mask_i
# This adds "noise" from dropped clients, which some systems prefer

# Final result: aggregate = u_1 + u_2 + u_3 + u_4 + (noise from 5-10)
# OR: aggregate = u_1 + u_2 + u_3 + u_4 (if we don't add back dropped masks)
```

**Result:** Server successfully computed aggregate without all clients!

---

## Testing Strategy

### Phase 1: Unit Tests (One Component)

```bash
# Test just the gradient boundedness
circom test_boundedness.circom

# Test just the masking correctness
circom test_masking.circom

# Test just the mask derivation
circom test_prf.circom
```

### Phase 2: Integration Tests (Whole Circuit)

```bash
# Test 1: Valid input should pass
node test_valid_input.js
# Expected: Proof verified ✓

# Test 2: Invalid input should fail
node test_invalid_input.js
# Expected: Proof verification failed ✗

# Test 3: Multiple clients
node test_multi_client.js
# Expected: All 10 clients' proofs verified

# Test 4: Dropout scenario
node test_dropout.js
# Expected: 9 clients verified, server aggregates correctly
```

### Phase 3: End-to-End Tests (All Components)

```bash
# Component A: Proves dataset is balanced
node test_component_a.js

# Component B: Proves training step is correct
node test_component_b.js

# Component C: Proves masked update is well-formed
node test_component_c.js

# Full pipeline: A → B → C
node test_pipeline_full.js
```

---

## Running Tests Manually

### Step 1: Create Test Input

Save `test_honest_client.json`:
```json
{
  "client_id": "1",
  "shared_key_hash": "12345678901234567890123456789012",
  "root_G": "98765432109876543210987654321098",
  "tau_squared": "1000000",
  "masked_update": [...],  // See Example 1 above
  "gradient": [...],
  "mask": [...],
  "prf_seed": "..."
}
```

### Step 2: Compile & Setup

```bash
# Compile circuit
circom zk/circuits/secureagg/secure_agg_client.circom \
  --r1cs --wasm --sym -o build/secureagg

# Run trusted setup
snarkjs groth16 setup \
  build/secureagg/secure_agg_client.r1cs \
  powersOfTau28_hez_final_16.ptau \
  build/secureagg/secure_agg_0000.zkey

snarkjs zkey contribute \
  build/secureagg/secure_agg_0000.zkey \
  build/secureagg/secure_agg_final.zkey

snarkjs zkey export verificationkey \
  build/secureagg/secure_agg_final.zkey \
  build/secureagg/vkey.json
```

### Step 3: Generate Proof

```bash
# Generate witness
node build/secureagg/secure_agg_client_js/generate_witness.js \
  build/secureagg/secure_agg_client_js/secure_agg_client.wasm \
  test_honest_client.json \
  witness.wtns

# Generate proof
snarkjs groth16 prove \
  build/secureagg/secure_agg_client_final.zkey \
  witness.wtns \
  proof.json \
  public.json

# Verify proof
snarkjs groth16 verify \
  build/secureagg/vkey.json \
  public.json \
  proof.json
```

**Expected output:**
```
[INFO]  snarkJS: OK!
```

### Step 4: Check Public Signals

```bash
cat public.json

# Expected:
[
  "1",  // client_id
  "12345678901234567890123456789012",  // shared_key_hash
  "98765432109876543210987654321098",  // root_G
  "[600, 100, -150, ...]",  // masked_update (DIM values)
  "1000000"  // tau_squared
]
```

---

## Troubleshooting Test Failures

### "Proof verification failed"

**Checklist:**
1. ✓ Witness generation succeeded (no errors)?
2. ✓ Public signals match expected values?
3. ✓ Verification key is correct?
4. ✓ Proof file not corrupted?

**Debug:**
```bash
# Check witness
snarkjs wtns debug witness.wtns build/secureagg/secure_agg_client.r1cs

# Check constraints
snarkjs r1cs info build/secureagg/secure_agg_client.r1cs

# Test with simpler input first
# (all zeros, except client_id=1)
```

### "Constraint check failed"

**Likely causes:**
1. **Gradient too large:** ‖g‖₂² > τ²
   - Fix: Use smaller gradient values or larger τ

2. **Masking incorrect:** u'_i ≠ u_i + m_i
   - Fix: Ensure all three values satisfy: masked_update[i] = gradient[i] + mask[i]

3. **Mask doesn't match PRF:** m_i ≠ PRF(shared_key)
   - Fix: Ensure prf_seed is correctly derived from shared_key_hash

### "Field arithmetic error"

**Likely causes:**
1. Values too large (overflow)
2. Negative numbers causing underflow
3. Fixed-point precision issues

**Fix:**
```json
// Use smaller values
"gradient": ["100", "-50", ...]  // Not ["10000000", "-5000000", ...]
```

---

## Summary

**Test cases provided:**
- ✅ Example 1: Valid honest client (should pass)
- ❌ Example 2: Unbounded gradient (should fail)
- ❌ Example 3: Incorrect masking (should fail)
- ✅ Example 4: Multi-client aggregation (should pass)
- ✅ Example 5: Dropout recovery (should pass)

**Testing workflow:**
1. Create test JSON input
2. Compile circuit
3. Run trusted setup
4. Generate witness
5. Generate proof
6. Verify proof

**Success criterion:** All valid inputs pass, all invalid inputs fail.

---

**Next:** Try running these tests! Start with Example 1 (valid client), then proceed to others.

