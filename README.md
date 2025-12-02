# Verifiable Training with Zero-Knowledge Proofs

<p align="center">
  <img src="https://img.shields.io/badge/Circom-2.0.0-blue" alt="Circom">
  <img src="https://img.shields.io/badge/snarkjs-Groth16-green" alt="snarkjs">
  <img src="https://img.shields.io/badge/Curve-BN254-orange" alt="BN254">
  <img src="https://img.shields.io/badge/Node.js-18%2B-brightgreen" alt="Node.js">
  <img src="https://img.shields.io/badge/License-MIT-yellow" alt="License">
</p>

A cryptographic framework for **privacy-preserving federated learning** using Zero-Knowledge Proofs. This system allows multiple parties (e.g., hospitals, banks) to collaboratively train a machine learning model **without revealing their private data** while providing **mathematical guarantees** that training was performed correctly.

---

## 📑 Table of Contents

- [The Problem We Solve](#-the-problem-we-solve)
- [Our Solution](#-our-solution-zk-verified-federated-learning)
- [System Architecture](#️-system-architecture)
- [Installation Guide](#-installation-guide)
  - [Windows](#windows)
  - [macOS](#macos)
  - [Linux (Ubuntu/Debian)](#linux-ubuntudebian)
- [Quick Start](#-quick-start)
- [Project Structure](#-project-structure)
- [Running Tests](#-running-tests)
- [How It Works](#-how-it-works)
- [Troubleshooting](#-troubleshooting)
- [Authors](#-authors)
- [License](#-license)

---

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
│   ┌──────────────────────────────────────────────────────────────┐         │
│   │ 1. Commit dataset      → root_D (public hash)                │         │
│   │ 2. Prove balance       → "I have 60 healthy, 40 sick"        │         │
│   │ 3. Train locally       → gradient (private)                  │         │
│   │ 4. Generate ZK proof   → "training was correct"              │         │
│   │ 5. Mask gradient       → hides individual contribution       │         │
│   │ 6. Send: proofs + masked_gradient                            │         │
│   └──────────────────────────────────────────────────────────────┘         │
│                              │                                              │
│                              ▼                                              │
│   ┌──────────────────────────────────────────────────────────────┐         │
│   │                   AGGREGATION SERVER                         │         │
│   │                                                              │         │
│   │  ✓ Verify balance proofs (dataset properties)               │         │
│   │  ✓ Verify training proofs (gradient correctness)            │         │
│   │  ✓ Verify secagg proofs (masking correctness)               │         │
│   │  ✓ Aggregate masked gradients (masks cancel out!)           │         │
│   │  ✓ Update global model                                      │         │
│   │                                                              │         │
│   │  Server learns: Σ gradients (aggregate only)                │         │
│   │  Server NEVER learns: individual gradients                  │         │
│   └──────────────────────────────────────────────────────────────┘         │
│                                                                             │
└─────────────────────────────────────────────────────────────────────────────┘
```

---

## 🏗️ System Architecture

Our system consists of three cryptographic circuits:

| Component | Circuit File | Purpose | What It Proves |
|-----------|--------------|---------|----------------|
| **Component A** | `balance_unified.circom` | Dataset property verification | "My dataset has X samples of class 0 and Y samples of class 1" |
| **Component B** | `sgd_verified.circom` | Training integrity | "I computed the gradient correctly from my committed data" |
| **Component C** | `secure_masked_update.circom` | Secure aggregation | "My masked gradient is correctly formed for aggregation" |

### Component Binding (Security Guarantee)

```
                    ┌─────────────────┐
                    │   Component A   │
                    │    (Balance)    │
                    │                 │
                    │  Outputs: root_D│──────────┐
                    └─────────────────┘          │
                                                 │ SAME root_D
                    ┌─────────────────┐          │ (cryptographic binding)
                    │   Component B   │◄─────────┘
                    │   (Training)    │
                    │                 │
                    │  Outputs: root_G│──────────┐
                    └─────────────────┘          │
                                                 │ SAME root_G
                    ┌─────────────────┐          │ (cryptographic binding)
                    │   Component C   │◄─────────┘
                    │  (SecureAgg)    │
                    └─────────────────┘
```

**Key Security Property:** All components share cryptographic commitments, preventing a malicious client from proving balance on one dataset while training on another.

---

## 📦 Installation Guide

### Prerequisites Overview

| Requirement | Version | Purpose |
|-------------|---------|---------|
| Node.js | v18 or higher | Runtime for JavaScript/snarkjs |
| Rust | Latest stable | Required to compile Circom |
| Circom | 2.0.0+ | ZK circuit compiler |
| Git | Any | Clone the repository |

---

### Windows

#### Step 1: Install Node.js

1. Download the **LTS version** from [https://nodejs.org/](https://nodejs.org/)
2. Run the installer (accept all defaults)
3. **Important:** Check the box for "Automatically install necessary tools" if prompted
4. Verify installation by opening **PowerShell**:
   ```powershell
   node --version   # Should show v18.x.x or higher
   npm --version    # Should show 9.x.x or higher
   ```

#### Step 2: Install Rust

1. Download and run the installer from [https://rustup.rs/](https://rustup.rs/)
   - Or run in PowerShell: `winget install Rustlang.Rustup`
2. In the terminal that opens, press `1` for default installation
3. **Close and reopen your terminal** (important!)
4. Verify installation:
   ```powershell
   rustc --version   # Should show rustc 1.xx.x
   cargo --version   # Should show cargo 1.xx.x
   ```

#### Step 3: Install Circom

```powershell
# Clone Circom repository
git clone https://github.com/iden3/circom.git
cd circom

# Build Circom (this takes a few minutes)
cargo build --release

# Add to PATH - Option A: Copy to Windows directory (requires Admin)
copy .\target\release\circom.exe C:\Windows\System32\

# Option B: Add to user PATH (no Admin needed)
# 1. Open Start Menu, search "Environment Variables"
# 2. Click "Edit the system environment variables"
# 3. Click "Environment Variables..."
# 4. Under "User variables", select "Path" and click "Edit"
# 5. Click "New" and add: C:\path\to\circom\target\release
# 6. Click OK on all dialogs

# Go back to home directory
cd ..

# Verify installation (open NEW terminal)
circom --version   # Should show circom compiler 2.x.x
```

#### Step 4: Clone and Setup Project

```powershell
# Clone the repository
git clone https://github.com/Immortal-ibr/Verifiable-Training-with-Zero-Knowledge-Proofs.git
cd Verifiable-Training-with-Zero-Knowledge-Proofs

# Install Node.js dependencies
npm install

# Create artifacts/keys directory if it doesn't exist
New-Item -ItemType Directory -Force -Path "artifacts\keys"

# Download Powers of Tau file (required for ZK proofs)
# This is a ~50MB file from the Hermez trusted setup ceremony
cd artifacts\keys
curl -O https://hermez.s3-eu-west-1.amazonaws.com/powersOfTau28_hez_final_17.ptau
Rename-Item powersOfTau28_hez_final_17.ptau pot17_final.ptau
cd ..\..
```

---

### macOS

#### Step 1: Install Homebrew (if not installed)

```bash
/bin/bash -c "$(curl -fsSL https://raw.githubusercontent.com/Homebrew/install/HEAD/install.sh)"
```

#### Step 2: Install Node.js

```bash
brew install node@18

# Verify
node --version   # Should show v18.x.x or higher
npm --version    # Should show 9.x.x or higher
```

#### Step 3: Install Rust

```bash
curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh
# Press 1 for default installation

# Load Rust into current shell
source $HOME/.cargo/env

# Verify
rustc --version
cargo --version
```

#### Step 4: Install Circom

```bash
git clone https://github.com/iden3/circom.git
cd circom
cargo build --release

# Install globally
sudo cp target/release/circom /usr/local/bin/

# Go back
cd ..

# Verify
circom --version
```

#### Step 5: Clone and Setup Project

```bash
# Clone the repository
git clone https://github.com/Immortal-ibr/Verifiable-Training-with-Zero-Knowledge-Proofs.git
cd Verifiable-Training-with-Zero-Knowledge-Proofs

# Install dependencies
npm install

# Download Powers of Tau
mkdir -p artifacts/keys
cd artifacts/keys
curl -O https://hermez.s3-eu-west-1.amazonaws.com/powersOfTau28_hez_final_17.ptau
mv powersOfTau28_hez_final_17.ptau pot17_final.ptau
cd ../..
```

---

### Linux (Ubuntu/Debian)

#### Step 1: Update System and Install Build Tools

```bash
sudo apt-get update
sudo apt-get install -y build-essential git curl
```

#### Step 2: Install Node.js

```bash
# Using NodeSource repository (recommended for latest LTS)
curl -fsSL https://deb.nodesource.com/setup_18.x | sudo -E bash -
sudo apt-get install -y nodejs

# Verify
node --version   # Should show v18.x.x
npm --version    # Should show 9.x.x
```

#### Step 3: Install Rust

```bash
curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh
# Press 1 for default installation

# Load Rust into current shell
source $HOME/.cargo/env

# Verify
rustc --version
cargo --version
```

#### Step 4: Install Circom

```bash
git clone https://github.com/iden3/circom.git
cd circom
cargo build --release

# Install globally
sudo cp target/release/circom /usr/local/bin/

# Go back
cd ..

# Verify
circom --version
```

#### Step 5: Clone and Setup Project

```bash
# Clone the repository
git clone https://github.com/Immortal-ibr/Verifiable-Training-with-Zero-Knowledge-Proofs.git
cd Verifiable-Training-with-Zero-Knowledge-Proofs

# Install dependencies
npm install

# Download Powers of Tau
mkdir -p artifacts/keys
cd artifacts/keys
wget https://hermez.s3-eu-west-1.amazonaws.com/powersOfTau28_hez_final_17.ptau
mv powersOfTau28_hez_final_17.ptau pot17_final.ptau
cd ../..
```

---

## 🚀 Quick Start

After completing the installation, run the full system simulation:

```bash
# From the project root directory
node tests/full_system_simulation.mjs
```

**What happens:**
1. 3 simulated clients each generate private datasets
2. Each client computes a cryptographic commitment to their data
3. Each client generates 3 ZK proofs (balance, training, secure aggregation)
4. The server verifies all 9 proofs
5. The server aggregates the masked gradients (individual gradients remain hidden)
6. Summary statistics are displayed

**Expected Output (abbreviated):**
```
══════════════════════════════════════════════════════════════════════
  ZK-FL FULL SYSTEM SIMULATION
══════════════════════════════════════════════════════════════════════

━━━ PHASE 0: SERVER SETUP ━━━
  [Server] Initializing global model...
    ✓ Model initialized (dim=4)

━━━ PHASE 1: CLIENT REGISTRATION ━━━
  [Client 1] Generating private dataset...
    ✓ Generated 8 samples (c0=4, c1=4)
  ...

━━━ PHASE 3: BALANCE PROOF ━━━
  [Client 1] Generating balance proof...
    ✓ Balance proof generated
  [Server] Verifying balance proof from client 1...
    ✓ Balance proof VERIFIED (c0=4, c1=4)
  ...

━━━ PHASE 4: TRAINING & VERIFICATION ━━━
  [Client 1] Training locally with VERIFIED gradient...
    ✓ Training proof VERIFIED (gradient correctness included)
  ...

━━━ PHASE 4.5: SECURE AGGREGATION ━━━
    ✓ Secure aggregation proof VERIFIED
  ...

━━━ PHASE 5: AGGREGATION ━━━
  [Server] Aggregating verified masked updates...
    ✓ Masked updates aggregated (masks cancelled!)

┌─────────────────────────────────────────────────────────────┐
│                    VERIFICATION SUMMARY                      │
├─────────────────────────────────────────────────────────────┤
│  Balance Proofs:    3/3 verified                             │
│  Training Proofs:   3/3 verified                             │
│  SecureAgg Proofs:  3/3 verified                             │
│  Binding Checks:    3/3 passed                               │
├─────────────────────────────────────────────────────────────┤
│  Clients Aggregated: 3/3                                     │
│  Duration:           ~45s                                    │
└─────────────────────────────────────────────────────────────┘

✓ ALL VERIFICATIONS PASSED - SYSTEM WORKING CORRECTLY
```

---

## 📁 Project Structure

```
Verifiable-Training-with-Zero-Knowledge-Proofs/
│
├── 📄 README.md                      # This file
├── 📄 package.json                   # Node.js dependencies
├── 📄 .gitignore                     # Git ignore rules
│
├── 📁 src/                           # SOURCE CODE
│   └── circuits/                     # Circom circuit definitions
│       ├── balance/                  # Component A: Dataset Balance
│       │   ├── balance_unified.circom
│       │   └── balance_unified_prod.circom
│       │
│       ├── training/                 # Component B: Training Integrity
│       │   ├── sgd_verified.circom   # Main circuit ⭐
│       │   ├── sgd_step_v5.circom    # Alternative circuit
│       │   ├── vector_hash.circom    # Vector hashing
│       │   └── fixedpoint.circom     # Fixed-point math
│       │
│       ├── secureagg/                # Component C: Secure Aggregation
│       │   ├── secure_masked_update.circom  # Main circuit ⭐
│       │   └── secure_agg_client.circom
│       │
│       └── lib/                      # Shared primitives
│           ├── merkle.circom         # Merkle tree
│           └── poseidon.circom       # Poseidon hash
│
├── 📁 tests/                         # TEST SUITE
│   ├── full_system_simulation.mjs    # Complete E2E test ⭐
│   ├── integration_test.mjs          # Component A+B test
│   ├── quick_integration_test.mjs    # Fast smoke test
│   ├── test_verified_gradient.mjs    # Gradient verification test
│   ├── test_secure_aggregation.mjs   # Component C test
│   └── run_all_tests.mjs             # Test runner
│
├── 📁 scripts/                       # UTILITIES
│   ├── generate_test_data.mjs
│   ├── generate_test_data_unified.mjs
│   └── generate_test_data_v5.mjs
│
├── 📁 artifacts/                     # COMPILED FILES (auto-generated)
│   ├── balance/                      # .r1cs, .zkey, .vkey, _js/
│   ├── training/                     # .r1cs, .zkey, .vkey, _js/
│   ├── secureagg/                    # .r1cs, .zkey, .vkey, _js/
│   └── keys/                         # Powers of Tau (.ptau)
│
├── 📁 data/                          # TEST DATA
│   └── *.json                        # Test input files
│
└── 📁 docs/                          # DOCUMENTATION
    ├── REPORT.md                     # Technical report
    └── REPORT.pdf                    # PDF version
```

---

## 🧪 Running Tests

### Full System Test (Recommended)

```bash
node tests/full_system_simulation.mjs
```

This runs a complete simulation with 3 clients and 1 server, generating and verifying all 9 proofs (~45 seconds).

### Quick Smoke Test

```bash
node tests/quick_integration_test.mjs
```

Faster test with smaller parameters for rapid validation (~30 seconds).

### Individual Component Tests

```bash
# Test gradient verification circuit
node tests/test_verified_gradient.mjs

# Test secure aggregation circuit
node tests/test_secure_aggregation.mjs

# Test balance + training binding
node tests/integration_test.mjs
```

### Run All Tests

```bash
node tests/run_all_tests.mjs
```

---

## 🔐 How It Works

### 1. Zero-Knowledge Proofs

A ZK proof allows proving a statement is true **without revealing why it's true**.

| Property | Meaning |
|----------|---------|
| **Completeness** | If true, an honest prover always convinces the verifier |
| **Soundness** | If false, a cheating prover cannot convince the verifier |
| **Zero-Knowledge** | Verifier learns nothing beyond the statement's truth |

### 2. Key Cryptographic Primitives

| Primitive | Purpose |
|-----------|---------|
| **Poseidon Hash** | ZK-friendly hash function (much faster than SHA-256 in circuits) |
| **Merkle Tree** | Creates a single hash ("root") representing an entire dataset |
| **Groth16** | Proof system producing ~200 byte proofs with ~10ms verification |
| **BN254 Curve** | Elliptic curve used for the pairing-based proofs |

### 3. Secure Aggregation

Uses pairwise masking where each client adds random masks to their gradient:

```
m_i = g_i + Σ_{j≠i} σ_ij * r_ij

where:
  m_i = masked gradient for client i
  g_i = actual gradient for client i  
  r_ij = random mask between clients i and j
  σ_ij = +1 if i < j, -1 if i > j
```

When summed across all clients, masks cancel out:
```
Σ m_i = Σ g_i + Σ_i Σ_{j≠i} σ_ij * r_ij = Σ g_i
```

The server learns only the aggregate `Σ g_i`, never individual gradients.

---

## ❓ Troubleshooting

### "circom: command not found"

**Cause:** Circom is not in your PATH.

**Solution:**
```bash
# Check if circom was built
ls ~/circom/target/release/circom  # Linux/macOS
dir C:\path\to\circom\target\release\circom.exe  # Windows

# Add to PATH (Linux/macOS)
export PATH=$PATH:~/circom/target/release
# Add to ~/.bashrc or ~/.zshrc to make permanent

# Or copy to system path
sudo cp ~/circom/target/release/circom /usr/local/bin/
```

### "Cannot find module 'circomlibjs'"

**Cause:** Node.js dependencies not installed.

**Solution:**
```bash
npm install
```

### "No ptau file found"

**Cause:** Powers of Tau file not downloaded.

**Solution:**
```bash
mkdir -p artifacts/keys
cd artifacts/keys

# Download from Hermez ceremony (~50MB)
curl -O https://hermez.s3-eu-west-1.amazonaws.com/powersOfTau28_hez_final_17.ptau
mv powersOfTau28_hez_final_17.ptau pot17_final.ptau
```

### "ENOENT: no such file or directory" for circuit files

**Cause:** Circuit hasn't been compiled yet.

**Solution:** The tests auto-compile circuits on first run. Ensure Circom is properly installed:
```bash
circom --version
```

### "Error: snarkjs groth16 verify failed"

**Cause:** Proof verification failed (invalid proof or mismatched inputs).

**Solution:** This usually means test data is incorrectly formatted. Re-run the test or check input JSON files.

### Windows: "Execution Policy" error

**Cause:** PowerShell script execution is restricted.

**Solution:** Run PowerShell as Administrator:
```powershell
Set-ExecutionPolicy -ExecutionPolicy RemoteSigned -Scope CurrentUser
```

### macOS: "xcrun: error: invalid active developer path"

**Cause:** Xcode Command Line Tools not installed.

**Solution:**
```bash
xcode-select --install
```

### Build is very slow

**Cause:** Circuit compilation and trusted setup are computationally intensive.

**Info:** First run takes longer (~2-3 minutes per circuit). Subsequent runs use cached artifacts and are much faster (~45 seconds).

---

## 👥 Authors

| Name | Institution |
|------|-------------|
| **Tarek Salama** | Purdue University |
| **Zeyad Elshafey** | Purdue University |
| **Ahmed Elbehiry** | Purdue University |

**Course:** Applied Cryptography, Purdue University, Fall 2025

---

## 📄 License

This project is licensed under the MIT License - see the [LICENSE](LICENSE) file for details.

---

## 📚 Learn More

- **Technical Report:** [docs/REPORT.md](docs/REPORT.md) - Detailed explanation of the cryptographic protocols
- **Circom Documentation:** [https://docs.circom.io/](https://docs.circom.io/)
- **snarkjs Documentation:** [https://github.com/iden3/snarkjs](https://github.com/iden3/snarkjs)
- **Poseidon Hash:** [https://www.poseidon-hash.info/](https://www.poseidon-hash.info/)

---

<p align="center">
  <b>Built with ❤️ for privacy-preserving machine learning</b>
</p>
