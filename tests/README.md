# Tests Directory

This folder contains integration tests for the ZK-FL (Zero-Knowledge Federated Learning) system.

## Test Files

| File | Purpose | Parameters | Duration |
|------|---------|------------|----------|
| `quick_integration_test.mjs` | Fast validation test | N=8, DIM=4, DEPTH=3 | ~30s |
| `integration_test.mjs` | Full production test | N=128, DIM=16, DEPTH=7 | ~5-10min |

## Running Tests

### Quick Test (Recommended First)
```bash
cd Verifiable-Training-with-Zero-Knowledge-Proofs
node tests/quick_integration_test.mjs
```

### Full Integration Test
```bash
cd Verifiable-Training-with-Zero-Knowledge-Proofs
node tests/integration_test.mjs
```

## What the Tests Verify

### Component A (Balance)
- ✓ All labels are binary (0 or 1)
- ✓ Sum of labels equals claimed c1
- ✓ c0 + c1 = N
- ✓ All samples have valid Merkle proofs

### Component B (Training)
- ✓ Batch samples have valid Merkle proofs
- ✓ Gradient clipping is satisfied (||g||² ≤ τ²)
- ✓ Gradient commitment matches root_G

### Cryptographic Binding
- ✓ **root_D from Balance === root_D from Training**
- This ensures the trained data IS the balanced data

## Expected Output

```
═══════════════════════════════════════════════════════════════════════════
  ZK-FL INTEGRATION TEST: Balance + Training
═══════════════════════════════════════════════════════════════════════════

  ✅ Poseidon hash initialized

[STEP 1] Generating Dataset
  ✅ Generated 128 samples
  ℹ️  Class distribution: c0=64, c1=64

[STEP 2] Building Merkle Tree
  ✅ Built Merkle tree with depth 7

...

═══════════════════════════════════════════════════════════════════════════
  TEST RESULTS: ALL PASSED ✓
═══════════════════════════════════════════════════════════════════════════

  🎉 SUBMISSION READY: All integration tests passed!
```

## Prerequisites

Before running tests, ensure:

1. **Dependencies installed:**
   ```bash
   npm install
   ```

2. **Circom installed:**
   ```bash
   circom --version  # Should be 2.0.0+
   ```

3. **Powers of Tau file:**
   - `pot17_final.ptau` (for production circuits)
   - `pot14_final.ptau` (for quick test circuits)

## Troubleshooting

### "Cannot find module 'circomlibjs'"
```bash
npm install circomlibjs
```

### "Compilation failed"
Check that all `.circom` files are present in the `src/circuits/` directory.

### "No ptau file found"
Download the Powers of Tau file:
```bash
cd artifacts/keys
npx snarkjs powersoftau new bn128 17 pot17_0000.ptau
npx snarkjs powersoftau contribute pot17_0000.ptau pot17_final.ptau --name="contribution" -e="random"
```

## Authors

- Tarek Salama
- Zeyad Elshafey  
- Ahmed Elbehiry

Applied Cryptography, Purdue University
