# Verifiable Training with Zero-Knowledge Proofs

<p align="center">
  <img src="https://img.shields.io/badge/Circom-2.0.0-blue" alt="Circom">
  <img src="https://img.shields.io/badge/snarkjs-Groth16-green" alt="snarkjs">
  <img src="https://img.shields.io/badge/Curve-BN254-orange" alt="BN254">
  <img src="https://img.shields.io/badge/License-MIT-yellow" alt="License">
</p>

A cryptographic framework for **privacy-preserving federated learning** using Zero-Knowledge Proofs. This system allows multiple parties (e.g., hospitals, banks) to collaboratively train a machine learning model **without revealing their private data** while providing **mathematical guarantees** that training was performed correctly.

## 🎯 The Problem We Solve

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                    THE FEDERATED LEARNING DILEMMA                           │
├─────────────────────────────────────────────────────────────────────────────┤
│                                                                             │
│   Hospital A        Hospital B        Hospital C                            │
│   ┌─────────┐       ┌─────────┐       ┌─────────┐                          │
│   │ Patient │       │ Patient │       │ Patient │                          │
│   │  Data   │       │  Data   │       │  Data   │                          │
│   │ (500)   │       │ (300)   │       │ (200)   │                          │
│   └────┬────┘       └────┬────┘       └────┬────┘                          │
│        │                 │                 │                                │
│        │    Cannot share due to HIPAA/GDPR │                                │
│        │                 │                 │                                │
│        └────────────────┼─────────────────┘                                │
│                         │                                                   │
│                         ▼                                                   │
│              ┌─────────────────────┐                                        │
│              │   Want to train a   │                                        │
│              │   joint AI model    │                                        │
│              │   (1000 patients)   │                                        │
│              └─────────────────────┘                                        │
│                                                                             │
│   CHALLENGES:                                                               │
│   ❌ Cannot share raw data (privacy regulations)                           │
│   ❌ Server might be malicious (inspect individual gradients)              │
│   ❌ Clients might be malicious (send poisoned updates)                    │
│   ❌ No way to verify training was done correctly                          │
│                                                                             │
└─────────────────────────────────────────────────────────────────────────────┘
```

## 💡 Our Solution: ZK-Verified Federated Learning

We use **Zero-Knowledge Proofs** to create a system where:

1. **Clients prove** their training is correct without revealing data
2. **Server verifies** proofs without learning private information
3. **Everyone trusts** the final model was trained honestly

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                         OUR ZK-FL SYSTEM                                    │
├─────────────────────────────────────────────────────────────────────────────┤
│                                                                             │
│   Hospital A                                                                │
│   ┌──────────────────────────────────────────────────┐                     │
│   │ 1. Commit dataset      → root_D (public hash)    │                     │
│   │ 2. Prove balance       → "60 healthy, 40 sick"   │                     │
│   │ 3. Train locally       → gradient (private)      │                     │
│   │ 4. Generate ZK proof   → "training was correct"  │                     │
│   │ 5. Send: proof + encrypted_gradient              │                     │
│   └──────────────────────────────────────────────────┘                     │
│                              │                                              │
│                              ▼                                              │
│   ┌──────────────────────────────────────────────────┐                     │
│   │              AGGREGATION SERVER                  │                     │
│   │                                                  │                     │
│   │  ✓ Verify all ZK proofs (no invalid training)   │                     │
│   │  ✓ Aggregate encrypted gradients                 │                     │
│   │  ✓ Decrypt only the SUM (not individual)        │                     │
│   │  ✓ Update global model                          │                     │
│   │                                                  │                     │
│   │  Server learns: Σ gradients (aggregate only)    │                     │
│   │  Server NEVER learns: individual gradients      │                     │
│   └──────────────────────────────────────────────────┘                     │
│                                                                             │
└─────────────────────────────────────────────────────────────────────────────┘
```

## 🏗️ System Architecture

Our system consists of three cryptographic circuits:

| Component | Purpose | Proves |
|-----------|---------|--------|
| **Component A** (Balance) | Dataset property verification | "My dataset has X samples of class 0 and Y samples of class 1" |
| **Component B** (Training) | Training integrity | "I trained on committed data with properly clipped gradients" |
| **Component C** (SecureAgg) | Secure aggregation | "My masked gradient is well-formed for aggregation" |

### Component Binding

```
                    ┌─────────────────┐
                    │   Component A   │
                    │    (Balance)    │
                    │                 │
                    │  Outputs: root_D│──────────┐
                    └─────────────────┘          │
                                                 │ SAME root_D
                    ┌─────────────────┐          │
                    │   Component B   │◄─────────┘
                    │   (Training)    │
                    │                 │
                    │  Outputs: root_G│──────────┐
                    └─────────────────┘          │
                                                 │ SAME root_G
                    ┌─────────────────┐          │
                    │   Component C   │◄─────────┘
                    │  (SecureAgg)    │
                    └─────────────────┘
```

**Key Insight:** All components use the **same cryptographic commitments**, preventing a malicious client from proving balance on one dataset while training on another.

## 🔐 What is a Zero-Knowledge Proof?

A Zero-Knowledge Proof (ZKP) allows you to prove a statement is true **without revealing WHY it's true**.

**Analogy:** Proving you know a password without typing it.

```
┌────────────────────────────────────────────────────────────────┐
│                    ZK PROOF PROPERTIES                         │
├────────────────────────────────────────────────────────────────┤
│                                                                │
│  1. COMPLETENESS                                               │
│     If the statement is TRUE, an honest prover                 │
│     can always convince the verifier.                          │
│                                                                │
│  2. SOUNDNESS                                                  │
│     If the statement is FALSE, a cheating prover               │
│     cannot convince the verifier (except with tiny prob).      │
│                                                                │
│  3. ZERO-KNOWLEDGE                                             │
│     The verifier learns NOTHING beyond the statement's truth.  │
│     No information about the secret witness leaks.             │
│                                                                │
└────────────────────────────────────────────────────────────────┘
```

**In Our System:**
- **Statement:** "I trained correctly on a balanced dataset with clipped gradients"
- **Witness (secret):** The actual training data and gradient values
- **Proof:** A short cryptographic object (~200 bytes) that convinces the verifier

## 📁 Project Structure

```
Verifiable-Training-with-Zero-Knowledge-Proofs/
├── README.md                    # This file
├── REPORT.md                    # Detailed technical report
├── package.json                 # Node.js dependencies
│
└── zk/circuits/
    ├── balance/                 # Component A: Dataset Balance Proof
    │   ├── balance_unified.circom
    │   ├── generate_test_data.mjs
    │   └── ...
    │
    ├── training/                # Component B: Training Integrity Proof
    │   ├── sgd_step_v5.circom   # Main training circuit (latest)
    │   ├── vector_hash.circom   # Vector hashing utilities
    │   ├── generate_test_data_v5.mjs
    │   └── ...
    │
    ├── secureagg/               # Component C: Secure Aggregation
    │   ├── secure_agg_client.circom
    │   └── ...
    │
    └── lib/                     # Shared cryptographic primitives
        ├── merkle.circom        # Merkle tree verification
        └── poseidon.circom      # Poseidon hash function
```

## 🚀 Quick Start

### Prerequisites

```bash
# Install Node.js (v18+)
# Install Circom compiler
npm install -g circom

# Clone and setup
git clone https://github.com/YOUR_USERNAME/Verifiable-Training-with-Zero-Knowledge-Proofs.git
cd Verifiable-Training-with-Zero-Knowledge-Proofs
npm install
```

### Run Component B (Training Proof)

```bash
cd zk/circuits/training

# 1. Compile the circuit
circom sgd_step_v5.circom --r1cs --wasm --sym -o .

# 2. Generate test data
node generate_test_data_v5.mjs

# 3. Trusted setup (one-time)
npx snarkjs groth16 setup sgd_step_v5.r1cs pot17_final.ptau sgd_step_v5_0000.zkey
npx snarkjs zkey contribute sgd_step_v5_0000.zkey sgd_step_v5_final.zkey --name="dev"
npx snarkjs zkey export verificationkey sgd_step_v5_final.zkey verification_key.json

# 4. Generate witness
node sgd_step_v5_js/generate_witness.cjs sgd_step_v5_js/sgd_step_v5.wasm test_input_v5.json witness.wtns

# 5. Generate proof
  npx snarkjs groth16 prove sgd_step_v5_final.zkey witness.wtns proof.json public.json

  # 6. Verify proof
  npx snarkjs groth16 verify verification_key.json public.json proof.json
  # Output: [INFO] snarkJS: OK!

  # Public inputs (v5)
  # client_id, round, root_D, root_G, tauSquared
```

## 🔑 Key Concepts

### Merkle Trees
A data structure that creates a single hash ("root") representing an entire dataset. Used to prove membership without revealing the dataset.

### Poseidon Hash
A hash function optimized for ZK circuits. Much more efficient than SHA-256 inside arithmetic circuits.

### Groth16
The proof system we use. Produces constant-size proofs (~200 bytes) with fast verification (~10ms).

### Gradient Clipping
A technique to bound gradient magnitudes, preventing model poisoning attacks.

## 👥 Authors

- **Tarek Salama** - Purdue University
- **Zeyad Elshafey** - Purdue University  
- **Ahmed Elbehiry** - Purdue University

## 📚 Course

**Applied Cryptography** - Purdue University, Fall 2025

## 📄 License

MIT License - see [LICENSE](LICENSE) for details.

## 📖 Learn More

For a comprehensive technical deep-dive, see [REPORT.md](REPORT.md).
