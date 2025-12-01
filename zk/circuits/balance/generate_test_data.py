#!/usr/bin/env python3
"""
Test data generator for Component A - Balance Proof
Creates a small dataset with Merkle tree for testing
"""

import json
from typing import List, Tuple

def poseidon_mock(inputs: List[int]) -> int:
    """
    Mock Poseidon hash for testing
    Note: This is NOT the real Poseidon! Just for structure testing.
    In production, use the actual Poseidon implementation.
    """
    # Simple hash mock: combine inputs and take modulo a prime
    PRIME = 21888242871839275222246405745257275088548364400416034343698204186575808495617
    result = sum(inputs) * 1234567 + 987654321
    return result % PRIME

def poseidon_hash_single(value: int) -> int:
    """Hash a single value (leaf node)"""
    return poseidon_mock([value])

def poseidon_hash_pair(left: int, right: int) -> int:
    """Hash a pair of values (internal node)"""
    return poseidon_mock([left, right])

class MerkleTree:
    """Simple Merkle tree implementation for testing"""
    
    def __init__(self, leaves: List[int]):
        """Build Merkle tree from leaf values"""
        self.leaves = leaves
        self.n = len(leaves)
        self.depth = 0
        temp = self.n
        while temp > 1:
            temp = (temp + 1) // 2
            self.depth += 1
        
        # Pad to power of 2
        self.padded_n = 2 ** self.depth
        
        # Hash leaves
        self.leaf_hashes = [poseidon_hash_single(leaf) for leaf in leaves]
        
        # Pad with zeros
        while len(self.leaf_hashes) < self.padded_n:
            self.leaf_hashes.append(poseidon_hash_single(0))
        
        # Build tree
        self.tree = self._build_tree(self.leaf_hashes)
        self.root = self.tree[-1][0]
    
    def _build_tree(self, leaves: List[int]) -> List[List[int]]:
        """Build tree bottom-up"""
        tree = [leaves]
        current_level = leaves
        
        while len(current_level) > 1:
            next_level = []
            for i in range(0, len(current_level), 2):
                left = current_level[i]
                right = current_level[i + 1] if i + 1 < len(current_level) else current_level[i]
                parent = poseidon_hash_pair(left, right)
                next_level.append(parent)
            tree.append(next_level)
            current_level = next_level
        
        return tree
    
    def get_proof(self, index: int) -> Tuple[List[int], List[int]]:
        """
        Get Merkle proof for leaf at index
        Returns: (siblings, pathIndices)
        """
        if index >= self.n:
            raise ValueError(f"Index {index} out of range (n={self.n})")
        
        siblings = []
        path_indices = []
        current_index = index
        
        for level in range(self.depth):
            # Determine if we're left or right child
            is_right = current_index % 2
            path_indices.append(is_right)
            
            # Get sibling index
            if is_right:
                sibling_index = current_index - 1
            else:
                sibling_index = current_index + 1
            
            # Get sibling hash (or same if at boundary)
            if sibling_index < len(self.tree[level]):
                sibling = self.tree[level][sibling_index]
            else:
                sibling = self.tree[level][current_index]
            
            siblings.append(sibling)
            
            # Move to parent
            current_index = current_index // 2
        
        return siblings, path_indices

def generate_test_data():
    """Generate test dataset and Merkle proofs"""
    
    # Test dataset: 8 binary labels
    # 3 zeros, 5 ones
    labels = [0, 1, 1, 0, 1, 1, 1, 0]
    
    print("=" * 60)
    print("COMPONENT A TEST - Data Generation")
    print("=" * 60)
    print(f"\nDataset: {labels}")
    print(f"Count of 0s (c0): {labels.count(0)}")
    print(f"Count of 1s (c1): {labels.count(1)}")
    print(f"Total (N): {len(labels)}")
    
    # Build Merkle tree
    print("\nBuilding Merkle tree...")
    tree = MerkleTree(labels)
    print(f"Tree depth: {tree.depth}")
    print(f"Root hash: {tree.root}")
    
    # Generate proofs for all leaves
    print("\nGenerating Merkle proofs...")
    all_siblings = []
    all_path_indices = []
    
    for i in range(len(labels)):
        siblings, path_indices = tree.get_proof(i)
        all_siblings.append(siblings)
        all_path_indices.append(path_indices)
        print(f"  Proof {i}: siblings={siblings[:2]}... pathIndices={path_indices}")
    
    # Create input JSON for circuit
    circuit_input = {
        "client_id": str(1),  # Client 1 (for multi-client federation)
        "root": str(tree.root),
        "N_public": str(len(labels)),
        "c0": str(labels.count(0)),
        "c1": str(labels.count(1)),
        "bits": [str(bit) for bit in labels],
        "siblings": [[str(h) for h in siblings] for siblings in all_siblings],
        "pathIndices": [[str(idx) for idx in path_indices] for path_indices in all_path_indices]
    }
    
    # Save to file
    output_file = "test_input.json"
    with open(output_file, 'w') as f:
        json.dump(circuit_input, f, indent=2)
    
    print(f"\n✅ Test input saved to: {output_file}")
    print(f"\nPublic inputs:")
    print(f"  client_id: {circuit_input['client_id']}")
    print(f"  root: {circuit_input['root']}")
    print(f"  N_public: {circuit_input['N_public']}")
    print(f"  c0: {circuit_input['c0']}")
    print(f"  c1: {circuit_input['c1']}")
    print(f"\nPrivate witness size:")
    print(f"  bits: {len(circuit_input['bits'])} values")
    print(f"  siblings: {len(circuit_input['siblings'])} x {len(circuit_input['siblings'][0])} hashes")
    print(f"  pathIndices: {len(circuit_input['pathIndices'])} x {len(circuit_input['pathIndices'][0])} bits")
    
    return circuit_input

def verify_merkle_proof(leaf_value: int, siblings: List[int], path_indices: List[int], root: int) -> bool:
    """Verify a Merkle proof"""
    # Hash the leaf
    current_hash = poseidon_hash_single(leaf_value)
    
    # Walk up the tree
    for sibling, is_right in zip(siblings, path_indices):
        if is_right:
            # We're the right child
            current_hash = poseidon_hash_pair(sibling, current_hash)
        else:
            # We're the left child
            current_hash = poseidon_hash_pair(current_hash, sibling)
    
    return current_hash == root

def test_verification(circuit_input):
    """Test that Merkle proofs verify correctly"""
    print("\n" + "=" * 60)
    print("VERIFICATION TEST")
    print("=" * 60)
    
    root = int(circuit_input['root'])
    bits = [int(b) for b in circuit_input['bits']]
    
    all_valid = True
    for i in range(len(bits)):
        siblings = [int(h) for h in circuit_input['siblings'][i]]
        path_indices = [int(idx) for idx in circuit_input['pathIndices'][i]]
        
        valid = verify_merkle_proof(bits[i], siblings, path_indices, root)
        status = "✓" if valid else "✗"
        print(f"  Proof {i} (bit={bits[i]}): {status}")
        
        if not valid:
            all_valid = False
    
    if all_valid:
        print("\n✅ All Merkle proofs verify correctly!")
    else:
        print("\n❌ Some proofs failed verification")
    
    return all_valid

if __name__ == "__main__":
    # Generate test data
    circuit_input = generate_test_data()
    
    # Verify proofs
    test_verification(circuit_input)
    
    print("\n" + "=" * 60)
    print("✅ TEST DATA GENERATION COMPLETE")
    print("=" * 60)
    print("\nNext steps:")
    print("  1. Compile circuit: circom balance_test.circom --r1cs --wasm --sym")
    print("  2. Generate witness: node balance_test_js/generate_witness.js ...")
    print("  3. Generate proof: snarkjs groth16 prove ...")
    print("  4. Verify proof: snarkjs groth16 verify ...")
