pragma circom 2.0.0;

include "../../../node_modules/circomlib/circuits/poseidon.circom";

/*
 * Poseidon Hash Wrappers (Training Component)
 * 
 * Shared with Component A. Provides consistent interface for Poseidon hashing.
 * 
 * See ../balance/poseidon.circom for full documentation.
 * 
 * Authors: Tarek Salama, Zeyad Elshafey, Ahmed Elbehiry
 * Date: November 11, 2025
 */

/*
 * PoseidonHash1
 * Hashes a single input value
 */
template PoseidonHash1() {
    signal input in;
    signal output out;
    
    component hasher = Poseidon(1);
    hasher.inputs[0] <== in;
    out <== hasher.out;
}

/*
 * PoseidonHash2
 * Hashes two input values (used for Merkle internal nodes)
 */
template PoseidonHash2() {
    signal input in1;
    signal input in2;
    signal output out;
    
    component hasher = Poseidon(2);
    hasher.inputs[0] <== in1;
    hasher.inputs[1] <== in2;
    out <== hasher.out;
}

/*
 * PoseidonHashN
 * Hashes N input values (flexible size)
 */
template PoseidonHashN(N) {
    signal input inputs[N];
    signal output out;
    
    component hasher = Poseidon(N);
    for (var i = 0; i < N; i++) {
        hasher.inputs[i] <== inputs[i];
    }
    out <== hasher.out;
}
