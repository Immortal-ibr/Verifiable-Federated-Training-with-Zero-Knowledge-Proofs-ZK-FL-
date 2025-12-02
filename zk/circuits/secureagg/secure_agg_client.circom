pragma circom 2.0.0;

include "../lib/poseidon.circom";
include "../training/vector_hash.circom";
include "../../../node_modules/circomlib/circuits/comparators.circom";

template PRFDerivation(DIM) {
    signal input prf_seed;
    signal input client_id;
    signal output prf_outputs[DIM];

    component prf[DIM];
    for (var i = 0; i < DIM; i++) {
        prf[i] = PoseidonHash2();
        prf[i].left <== prf_seed;
        prf[i].right <== client_id * DIM + i;
        prf_outputs[i] <== prf[i].hash;
    }
}

template GradientBoundednessProof(DIM) {
    signal input gradient[DIM];
    signal input tau_squared;
    signal output isBounded;

    signal squares[DIM];
    for (var i = 0; i < DIM; i++) {
        squares[i] <== gradient[i] * gradient[i];
    }

    signal partialSums[DIM];
    partialSums[0] <== squares[0];
    for (var i = 1; i < DIM; i++) {
        partialSums[i] <== partialSums[i - 1] + squares[i];
    }
    signal normSquared <== partialSums[DIM - 1];

    component leq = LessThan(252);
    leq.in[0] <== normSquared;
    leq.in[1] <== tau_squared + 1;
    leq.out === 1;
    isBounded <== 1;
}

template MaskDerivationProof(DIM) {
    signal input shared_key_hash;
    signal input prf_seed;
    signal input mask[DIM];
    signal input client_id;
    signal output isValid;

    component seedCommit = PoseidonHash1();
    seedCommit.value <== prf_seed;
    shared_key_hash === seedCommit.hash;

    component prf = PRFDerivation(DIM);
    prf.prf_seed <== prf_seed;
    prf.client_id <== client_id;

    for (var i = 0; i < DIM; i++) {
        mask[i] === prf.prf_outputs[i];
    }

    isValid <== 1;
}

template MaskingCorrectnessProof(DIM) {
    signal input gradient[DIM];
    signal input mask[DIM];
    signal input masked_update[DIM];

    for (var i = 0; i < DIM; i++) {
        masked_update[i] === gradient[i] + mask[i];
    }
}

template AggregationWellFormenessProof(DIM) {
    signal input client_id;
    signal input shared_key_hash;
    signal input root_G;
    signal input masked_update[DIM];
    signal input tau_squared;

    signal input gradient[DIM];
    signal input mask[DIM];
    signal input prf_seed;

    component boundCheck = GradientBoundednessProof(DIM);
    for (var i = 0; i < DIM; i++) {
        boundCheck.gradient[i] <== gradient[i];
    }
    boundCheck.tau_squared <== tau_squared;

    component maskCheck = MaskDerivationProof(DIM);
    maskCheck.shared_key_hash <== shared_key_hash;
    maskCheck.prf_seed <== prf_seed;
    maskCheck.client_id <== client_id;
    for (var i = 0; i < DIM; i++) {
        maskCheck.mask[i] <== mask[i];
    }

    component maskingCheck = MaskingCorrectnessProof(DIM);
    for (var i = 0; i < DIM; i++) {
        maskingCheck.gradient[i] <== gradient[i];
        maskingCheck.mask[i] <== mask[i];
        maskingCheck.masked_update[i] <== masked_update[i];
    }

    component gradientHash = VectorHash(DIM);
    for (var i = 0; i < DIM; i++) {
        gradientHash.values[i] <== gradient[i];
    }
    root_G === gradientHash.hash;
}

template MainWrapper() {
    signal input client_id;
    signal input shared_key_hash;
    signal input root_G;
    signal input tau_squared;
    signal input masked_update0;
    signal input masked_update1;
    signal input masked_update2;
    signal input masked_update3;
    signal input masked_update4;
    signal input masked_update5;
    signal input masked_update6;
    signal input masked_update7;
    signal input gradient[8];
    signal input mask[8];
    signal input prf_seed;

    signal masked_update[8];
    masked_update[0] <== masked_update0;
    masked_update[1] <== masked_update1;
    masked_update[2] <== masked_update2;
    masked_update[3] <== masked_update3;
    masked_update[4] <== masked_update4;
    masked_update[5] <== masked_update5;
    masked_update[6] <== masked_update6;
    masked_update[7] <== masked_update7;

    component agg = AggregationWellFormenessProof(8);
    agg.client_id <== client_id;
    agg.shared_key_hash <== shared_key_hash;
    agg.root_G <== root_G;
    agg.tau_squared <== tau_squared;
    for (var i = 0; i < 8; i++) {
        agg.masked_update[i] <== masked_update[i];
        agg.gradient[i] <== gradient[i];
        agg.mask[i] <== mask[i];
    }
    agg.prf_seed <== prf_seed;
}

component main { public [
    client_id,
    shared_key_hash,
    root_G,
    tau_squared,
    masked_update0, masked_update1, masked_update2, masked_update3,
    masked_update4, masked_update5, masked_update6, masked_update7
] } = MainWrapper();
