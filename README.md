# Verifiable Federated Training with Zero-Knowledge (ZK-FL)
Members :
Tarek Ibrahim |
Zeyad ElShafey |
Ahmed ELbehiry

**Goal.** Train one model across organizations **A/B/C** without sharing raw data, while publishing **zero-knowledge proofs** that:
- datasets satisfy agreed **distribution** constraints (class balance, per-group support),
- each client’s update is a **clipped-SGD** step on a **committed** batch,
- the final model’s **fairness metrics** (DP/EO gaps) are within thresholds on a **committed** eval set.

**Security properties:** privacy (no raw data/gradients), integrity (proof-checked updates), and auditability (anyone can verify proofs offline).

---

## ✨ Features
- **Secure Aggregation** (additive masks with dropout handling): server learns only the sum of updates.
- **ZK Circuits (Halo2/Plonkish via `ezkl`)**
  - **C1 — Distribution:** class ratio bounds & min support per sensitive group.
  - **C2 — Training Integrity:** `u = Clip(∇ℓ(w_t; batch))` and `‖u‖₂ ≤ τ` on Merkle-committed model & batch.
  - **C3 — Fairness:** Demographic Parity / Equalized Odds gaps ≤ configured thresholds on a committed eval set.
- **Commitments & Signatures:** Merkle roots for data/batches/models; Ed25519 over all messages & proofs.
- **Reproducible Benchmarks:** timing, proof sizes, slowdown factors, poisoning robustness.

---

## 📦 Quickstart

> Requirements: Python ≥3.10, Rust toolchain (for `ezkl`), make, git. Linux/macOS preferred.

```bash
git clone https://github.com/<org>/ppml-zk && cd ppml-zk
./scripts/dev_setup.sh           # creates .venv, installs deps, builds/installs ezkl if needed
source .venv/bin/activate

# 1) Prepare datasets (Adult/COMPAS) and deterministic splits
python -m data.loaders --prepare --dataset adult --out data/processed/adult/

# 2) Create commitments (dataset roots & per-round batch index trees)
python -m fl.commits --dataset adult --out data/commits/adult/

# 3) Run a local 3-party demo (A, B, C) with secure aggregation
./scripts/run_demo_three_parties.sh

# 4) Generate ZK proofs
#   C1: dataset property proofs
python zk/runners/prove_c1.py --config config/ezkl/c1_distribution.json --out proofs/dataset_properties/
#   C2: per-round training proofs (called from the FL loop; can also be run offline)
python zk/runners/prove_c2.py --round 3 --out proofs/rounds/
#   C3: final fairness proof
python zk/runners/prove_c3.py --config config/ezkl/c3_fairness.json --out proofs/fairness/

# 5) Verify all proofs
./scripts/verify_all.sh
