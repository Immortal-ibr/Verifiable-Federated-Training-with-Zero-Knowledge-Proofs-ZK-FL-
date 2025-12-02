#!/usr/bin/env python3
"""
Test data generator for Component B - Training Integrity Proof

Generates valid test inputs for the training step circuit including:
- Model weights (current and expected new)
- Training batch (features + labels)
- Merkle proofs for batch membership
- Gradient computations
- All necessary commitments

Authors: Tarek Salama, Zeyad Elshafey, Ahmed Elbehiry
Course: Applied Cryptography, Purdue University
Date: November 11, 2025
"""

import json
import hashlib
import random
import argparse
from typing import List, Tuple, Dict


# Fixed-point precision (matches circuit)
PRECISION = 1000


def to_fixed(value: float) -> str:
    """Convert float to fixed-point integer string"""
    return str(int(value * PRECISION))


def from_fixed(value: int) -> float:
    """Convert fixed-point integer to float"""
    return value / PRECISION


def poseidon_hash(*inputs):
    """
    Simplified Poseidon hash for testing.
    In production, use actual Poseidon implementation.
    For testing, we use SHA-256 as placeholder.
    """
    h = hashlib.sha256()
    for inp in inputs:
        h.update(str(inp).encode())
    # Return a large integer (field element)
    return int(h.hexdigest(), 16) % (2**251)  # Keep it within BN254 field


def build_merkle_tree(leaves: List[int]) -> Tuple[int, List[List[int]], List[List[int]]]:
    """
    Build Merkle tree and return root + proofs for each leaf.
    
    Returns:
        root: Merkle root hash
        siblings: List of sibling hashes for each leaf
        pathIndices: List of path directions for each leaf
    """
    n = len(leaves)
    # Pad to power of 2
    depth = 0
    size = 1
    while size < n:
        size *= 2
        depth += 1
    
    # Pad leaves with zeros
    padded_leaves = leaves + [0] * (size - n)
    
    # Build tree level by level
    tree = [padded_leaves]
    current_level = padded_leaves
    
    while len(current_level) > 1:
        next_level = []
        for i in range(0, len(current_level), 2):
            left = current_level[i]
            right = current_level[i + 1] if i + 1 < len(current_level) else 0
            parent = poseidon_hash(left, right)
            next_level.append(parent)
        tree.append(next_level)
        current_level = next_level
    
    root = tree[-1][0]
    
    # Generate proofs for each original leaf
    siblings_list = []
    indices_list = []
    
    for leaf_idx in range(n):
        siblings = []
        indices = []
        current_idx = leaf_idx
        
        for level in range(depth):
            sibling_idx = current_idx ^ 1  # Flip last bit to get sibling
            if sibling_idx < len(tree[level]):
                sibling = tree[level][sibling_idx]
            else:
                sibling = 0
            siblings.append(sibling)
            
            # Path index: 0 if we're on left, 1 if on right
            indices.append(current_idx % 2)
            
            current_idx //= 2
        
        siblings_list.append(siblings)
        indices_list.append(indices)
    
    return root, siblings_list, indices_list


def generate_dataset(num_samples: int, dim: int) -> Tuple[List[List[float]], List[int]]:
    """
    Generate a simple synthetic dataset.
    
    Returns:
        features: List of feature vectors
        labels: List of binary labels
    """
    random.seed(42)  # Deterministic for testing
    
    features = []
    labels = []
    
    for _ in range(num_samples):
        # Random features in [-1, 1]
        feat = [random.uniform(-1, 1) for _ in range(dim)]
        # Simple linear decision boundary
        label = 1 if sum(feat) > 0 else 0
        features.append(feat)
        labels.append(label)
    
    return features, labels


def compute_gradient(weights: List[float], features: List[float], label: int) -> List[float]:
    """
    Compute gradient of squared loss: ℓ(w; x, y) = (y - w·x)² / 2
    Gradient: ∇ℓ = -e * x, where e = y - w·x
    """
    # Prediction: w · x
    prediction = sum(w * x for w, x in zip(weights, features))
    # Error
    error = label - prediction
    # Gradient
    gradient = [-error * x for x in features]
    return gradient


def compute_l2_norm(vector: List[float]) -> float:
    """Compute L2 norm of a vector"""
    return sum(v * v for v in vector) ** 0.5


def clip_gradient(gradient: List[float], tau: float) -> List[float]:
    """Clip gradient to have L2 norm at most tau"""
    norm = compute_l2_norm(gradient)
    if norm > tau:
        scale = tau / norm
        return [scale * g for g in gradient]
    return gradient


def generate_test_data(batch_size: int = 8, model_dim: int = 32, dataset_size: int = 128,
                      learning_rate: float = 0.01, clip_threshold: float = 1.0):
    """
    Generate complete test input for training circuit.
    
    Args:
        batch_size: Number of samples in training batch
        model_dim: Dimension of model weights
        dataset_size: Total size of dataset
        learning_rate: SGD learning rate (alpha)
        clip_threshold: Gradient clipping threshold (tau)
    
    Returns:
        Dictionary with all circuit inputs
    """
    print(f"\n{'='*60}")
    print("COMPONENT B TEST - Training Integrity Proof Data Generation")
    print(f"{'='*60}\n")
    
    print(f"Configuration:")
    print(f"  Batch size: {batch_size}")
    print(f"  Model dimension: {model_dim}")
    print(f"  Dataset size: {dataset_size}")
    print(f"  Learning rate (α): {learning_rate}")
    print(f"  Clipping threshold (τ): {clip_threshold}\n")
    
    # Generate full dataset
    print("Step 1: Generating dataset...")
    full_features, full_labels = generate_dataset(dataset_size, model_dim)
    
    # Create Merkle tree for dataset
    print("Step 2: Building Merkle tree...")
    leaves = []
    for feat, lab in zip(full_features, full_labels):
        # Hash (features, label) to create leaf
        leaf_hash = poseidon_hash(*[to_fixed(f) for f in feat], lab)
        leaves.append(leaf_hash)
    
    root_D, siblings_all, indices_all = build_merkle_tree(leaves)
    print(f"  Dataset root R_D: {root_D}")
    
    # Select a random batch from the dataset
    print(f"\nStep 3: Selecting training batch ({batch_size} samples)...")
    batch_indices = random.sample(range(dataset_size), batch_size)
    batch_features = [full_features[i] for i in batch_indices]
    batch_labels = [full_labels[i] for i in batch_indices]
    batch_siblings = [siblings_all[i] for i in batch_indices]
    batch_path_indices = [indices_all[i] for i in batch_indices]
    
    # Initialize weights (small random values)
    print("\nStep 4: Initializing model weights...")
    weights_old = [random.uniform(-0.1, 0.1) for _ in range(model_dim)]
    
    # Compute batch gradient
    print("\nStep 5: Computing gradients...")
    sample_gradients = []
    for feat, lab in zip(batch_features, batch_labels):
        grad = compute_gradient(weights_old, feat, lab)
        sample_gradients.append(grad)
    
    # Average gradient
    avg_gradient = [sum(g[i] for g in sample_gradients) / batch_size 
                   for i in range(model_dim)]
    
    grad_norm = compute_l2_norm(avg_gradient)
    print(f"  Gradient L2 norm: {grad_norm:.4f}")
    
    # Clip gradient
    print(f"\nStep 6: Applying gradient clipping (τ={clip_threshold})...")
    clipped_gradient = clip_gradient(avg_gradient, clip_threshold)
    clipped_norm = compute_l2_norm(clipped_gradient)
    print(f"  Clipped gradient L2 norm: {clipped_norm:.4f}")
    print(f"  Was clipped: {grad_norm > clip_threshold}")
    
    # Update weights
    print("\nStep 7: Updating weights...")
    weights_new = [w - learning_rate * g 
                  for w, g in zip(weights_old, clipped_gradient)]
    
    # Create gradient commitment
    print("\nStep 8: Creating gradient commitment R_G...")
    root_G = poseidon_hash(*[to_fixed(g) for g in clipped_gradient])
    print(f"  Gradient root R_G: {root_G}")
    
    # Prepare circuit input
    print("\nStep 9: Formatting circuit input...")
    
    circuit_input = {
        # Public inputs
        "client_id": "1",
        "root_D": str(root_D),
        "root_G": str(root_G),
        "alpha": to_fixed(learning_rate),
        "tau": to_fixed(clip_threshold),
        
        # Private inputs
        "weights_old": [to_fixed(w) for w in weights_old],
        "features": [[to_fixed(f) for f in feat] for feat in batch_features],
        "labels": [str(lab) for lab in batch_labels],
        "siblings": [[str(s) for s in sibs] for sibs in batch_siblings],
        "pathIndices": [[str(idx) for idx in indices] for indices in batch_path_indices]
    }
    
    print("\n" + "="*60)
    print("Test data generated successfully!")
    print("="*60)
    
    print(f"\nPublic inputs (visible to verifier):")
    print(f"  client_id: {circuit_input['client_id']}")
    print(f"  root_D: {circuit_input['root_D']}")
    print(f"  root_G: {circuit_input['root_G']}")
    print(f"  alpha: {circuit_input['alpha']} ({from_fixed(int(circuit_input['alpha'])):.4f})")
    print(f"  tau: {circuit_input['tau']} ({from_fixed(int(circuit_input['tau'])):.4f})")
    
    print(f"\nPrivate inputs (hidden from verifier):")
    print(f"  weights_old: {len(circuit_input['weights_old'])} values")
    print(f"  features: {len(circuit_input['features'])}x{len(circuit_input['features'][0])} matrix")
    print(f"  labels: {len(circuit_input['labels'])} values")
    print(f"  Merkle proofs: {len(circuit_input['siblings'])} proofs")
    
    # Summary statistics
    print(f"\nExpected results:")
    print(f"  Gradient norm before clipping: {grad_norm:.4f}")
    print(f"  Gradient norm after clipping: {clipped_norm:.4f}")
    print(f"  Clipping was applied: {grad_norm > clip_threshold}")
    print(f"  Weight change (L2 norm): {compute_l2_norm([w_new - w_old for w_new, w_old in zip(weights_new, weights_old)]):.4f}")
    
    return circuit_input


def main():
    parser = argparse.ArgumentParser(
        description="Generate test data for Component B (Training Integrity Proof)"
    )
    parser.add_argument("--batch-size", type=int, default=8,
                       help="Number of samples in training batch (default: 8)")
    parser.add_argument("--model-dim", type=int, default=32,
                       help="Model dimension (default: 32)")
    parser.add_argument("--dataset-size", type=int, default=128,
                       help="Total dataset size (default: 128)")
    parser.add_argument("--learning-rate", type=float, default=0.01,
                       help="Learning rate alpha (default: 0.01)")
    parser.add_argument("--clip-threshold", type=float, default=1.0,
                       help="Gradient clipping threshold tau (default: 1.0)")
    parser.add_argument("--output", type=str, default="test_input.json",
                       help="Output file path (default: test_input.json)")
    
    args = parser.parse_args()
    
    # Generate test data
    circuit_input = generate_test_data(
        batch_size=args.batch_size,
        model_dim=args.model_dim,
        dataset_size=args.dataset_size,
        learning_rate=args.learning_rate,
        clip_threshold=args.clip_threshold
    )
    
    # Save to file
    with open(args.output, 'w') as f:
        json.dump(circuit_input, f, indent=2)
    
    print(f"\n✅ Test data saved to: {args.output}")
    print(f"\nNext steps:")
    print(f"  1. Compile circuit: circom sgd_step.circom --r1cs --wasm -o build/")
    print(f"  2. Generate witness: node build/sgd_step_js/generate_witness.js \\")
    print(f"                            build/sgd_step_js/sgd_step.wasm \\")
    print(f"                            {args.output} build/witness.wtns")
    print(f"  3. Generate proof: snarkjs groth16 prove ... (see QUICK_SETUP.md)")
    

if __name__ == "__main__":
    main()
