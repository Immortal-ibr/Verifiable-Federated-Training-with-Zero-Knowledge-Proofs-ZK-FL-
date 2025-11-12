# Component C: Quick Setup Guide

**Last Updated:** November 11, 2025

## What Is Component C?

Component C proves that a client's masked update is well-formed for federated learning aggregation, even if some clients drop out (disconnect).

**Three key parts:**
1. ✅ **Gradient Boundedness** - Proves gradient is clipped (≤ τ in L2 norm)
2. ✅ **Mask Derivation** - Proves mask is PRF-derived from shared key
3. ✅ **Masking Correctness** - Proves masked_update = gradient + mask

## Files

```
zk/circuits/secureagg/
├── secure_agg_client.circom        # Main circuit (600+ lines)
├── poseidon.circom                  # Hash functions
├── fixedpoint.circom                # Fixed-point arithmetic
├── merkle.circom                    # [From balance, referenced]
├── DOCUMENTATION.md                 # Full documentation (THIS FILE)
└── QUICK_SETUP.md                   # This file
```

## Installation

### 1. Install Prerequisites

```bash
# Install Rust and Circom (if not installed)
curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh
cargo install --path circom

# Install Node.js and npm
node --version   # Should be v14+
npm --version

# Navigate to project
cd "Verifiable-Federated-Training-with-Zero-Knowledge-Proofs-ZK-FL-"

# Install dependencies
npm install circomlib snarkjs
```

### 2. Compile Circuit

```bash
# Create build directory
mkdir -p build/secureagg

# Compile
circom zk/circuits/secureagg/secure_agg_client.circom \
  --r1cs --wasm --sym -o build/secureagg

# Check constraints
snarkjs r1cs info build/secureagg/secure_agg_client.r1cs
```

**Expected for DIM=32:**
- ~33,000 constraints
- ~32,000 private inputs
- 5 public inputs

### 3. Setup (Trusted Ceremony)

```bash
# Download powers of tau (one-time, ~1GB)
# For ~33k constraints, need 2^16 = 65,536 minimum
wget https://hermez.s3-eu-west-1.amazonaws.com/powersOfTau28_hez_final_16.ptau

# Generate initial key
snarkjs groth16 setup \
  build/secureagg/secure_agg_client.r1cs \
  powersOfTau28_hez_final_16.ptau \
  build/secureagg/secure_agg_0000.zkey

# Contribute (adds your randomness)
snarkjs zkey contribute \
  build/secureagg/secure_agg_0000.zkey \
  build/secureagg/secure_agg_final.zkey \
  --name="Your Name"

# Export verification key
snarkjs zkey export verificationkey \
  build/secureagg/secure_agg_final.zkey \
  build/secureagg/vkey_secureagg.json
```

## Testing

### Generate Test Input

Create `test_input.json`:

```json
{
  "client_id": "1",
  "shared_key_hash": "12345678901234567890",
  "root_G": "98765432109876543210",
  "tau_squared": "1000000",
  "masked_update": [
    "600", "100", "-150", ...  // 32 values
  ],
  "gradient": [
    "100", "-50", "-200", ...  // Same 32 values, private
  ],
  "mask": [
    "500", "150", "50", ...  // Additive mask, private
  ],
  "prf_seed": "87654321098765432109"
}
```

### Generate and Verify Proof

```bash
# Generate witness
node build/secureagg/secure_agg_client_js/generate_witness.js \
  build/secureagg/secure_agg_client_js/secure_agg_client.wasm \
  test_input.json \
  build/secureagg/witness.wtns

# Generate proof
snarkjs groth16 prove \
  build/secureagg/secure_agg_client_final.zkey \
  build/secureagg/witness.wtns \
  build/secureagg/proof.json \
  build/secureagg/public.json

# Verify proof
snarkjs groth16 verify \
  build/secureagg/vkey_secureagg.json \
  build/secureagg/public.json \
  build/secureagg/proof.json
```

**Expected output:**
```
[INFO]  snarkJS: OK!
```

## Key Features

### 1. Gradient Boundedness

Proves: ‖gradient‖₂² ≤ τ²

```circom
// In circuit:
// Computes sum of squares and verifies it's ≤ tau_squared
```

### 2. Mask Derivation

Proves: mask = PRF(shared_key_hash, client_id)

- Mask is unpredictable (PRF property)
- Server can recompute if client drops out
- Each client has unique mask

### 3. Masking Correctness

Proves: masked_update[i] = gradient[i] + mask[i]

- Simple addition constraints
- Ensures proper masking
- Enables correct aggregation

## Integration

### With Component B

Component C uses `root_G` (gradient commitment from Component B):

```
Component B Output:
  - gradient u_i
  - root_G = Hash(u_i)
  
Component C Input:
  - root_G (public)
  - gradient u_i (private)
  
Component C Verifies:
  - Hash(u_i) === root_G  ✓
```

### With Server

Server receives: `(masked_update, proof, public_signals)`

```javascript
// Server verifies proof
const valid = await snarkjs.groth16.verify(vkey, publicSignals, proof);

// If valid, add masked_update to aggregate
if (valid) {
  aggregate = vectorAdd(aggregate, maskedUpdate);
}

// After all clients:
// aggregate = Σ(u_i + m_i)
// Remove masks to get: Σ u_i
```

## Performance

### Proving Times (Estimated)

- Circuit Compile: 2-5 sec
- Witness Gen: 1-2 sec
- Proof Gen: 5-15 sec
- Total: ~25 sec per client

### Proof Size

- Proof: ~192 bytes
- Public signals: ~160 bytes
- Total: ~350 bytes

### Per-Client Cost

For 10 clients:
- Total proving time: ~4 minutes
- Total bandwidth: ~3.5 KB
- Very practical! ✓

## Troubleshooting

### "Constraint count too high"

If constraints exceed available in ptau file:
- Download larger ptau file (e.g., final_17)
- Reduce DIM or PRECISION parameters

### "Proof verification failed"

Check:
1. Witness generation succeeded
2. Public signals match what was expected
3. Verification key is correct

### "PRF mismatch"

Ensure:
1. `prf_seed` is derived correctly from `shared_key_hash`
2. Mask values match PRF output
3. `client_id` is incorporated into PRF

## Next Steps

1. ✅ **Test with simple inputs** (constant vectors)
2. ✅ **Test with real gradient data** (from Component B)
3. ✅ **Benchmark proving times**
4. ✅ **Test dropout handling** (some clients missing)
5. ✅ **Integrate with server aggregation**

## Questions?

See `DOCUMENTATION.md` for:
- Full circuit explanation
- Mathematical background
- Security properties
- Advanced usage

---

**Status:** 🚀 Ready to test!

