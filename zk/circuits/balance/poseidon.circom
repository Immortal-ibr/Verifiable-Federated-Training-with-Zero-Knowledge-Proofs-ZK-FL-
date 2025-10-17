pragma circom 2.0.0;

// Poseidon hash implementation for Merkle trees
// This is a ZK-friendly hash function

// For now, we'll use a simple placeholder
// In production, import from circomlib:
// include "circomlib/circuits/poseidon.circom";

template Poseidon(nInputs) {
    signal input inputs[nInputs];
    signal output out;

    // Simplified Poseidon (for demonstration)
    // In production, use the full Poseidon from circomlib
    var sum = 0;
    for (var i = 0; i < nInputs; i++) {
        sum += inputs[i];
    }
    out <== sum * sum + 1;
}

// Hash two inputs (for binary Merkle tree)
template PoseidonHash2() {
    signal input left;
    signal input right;
    signal output hash;

    component hasher = Poseidon(2);
    hasher.inputs[0] <== left;
    hasher.inputs[1] <== right;
    hash <== hasher.out;
}

// Hash a single input (for leaf nodes)
template PoseidonHash1() {
    signal input value;
    signal output hash;

    component hasher = Poseidon(1);
    hasher.inputs[0] <== value;
    hash <== hasher.out;
}
