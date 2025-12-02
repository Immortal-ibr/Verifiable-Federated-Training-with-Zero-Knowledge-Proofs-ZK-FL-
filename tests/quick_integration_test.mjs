#!/usr/bin/env node
/**
 * ═══════════════════════════════════════════════════════════════════════════
 * QUICK INTEGRATION TEST: Balance + Training Components
 * ═══════════════════════════════════════════════════════════════════════════
 * 
 * FAST VERSION using smaller parameters for rapid testing:
 *   N=8, BATCH_SIZE=8, MODEL_DIM=4, DEPTH=3
 * 
 * This verifies the cryptographic binding between Component A and B works
 * correctly before running the full production test.
 * 
 * Authors: Tarek Salama, Zeyad Elshafey, Ahmed Elbehiry
 * Course: Applied Cryptography, Purdue University
 * ═══════════════════════════════════════════════════════════════════════════
 */

import { buildPoseidon } from 'circomlibjs';
import { execSync } from 'child_process';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// ═══════════════════════════════════════════════════════════════════════════
// CONFIGURATION - SMALL PARAMETERS FOR QUICK TESTING
// ═══════════════════════════════════════════════════════════════════════════

const CONFIG = {
    // Small test parameters
    N: 8,                    // Total samples
    MODEL_DIM: 4,            // Feature dimensions
    DEPTH: 3,                // Merkle tree depth (2^3 = 8)
    
    // Training parameters
    BATCH_SIZE: 8,           // Use all samples
    TAU_SQUARED: 10000,      // Clipping threshold
    
    // Paths
    BALANCE_DIR: path.join(__dirname, '..', 'zk', 'circuits', 'balance'),
    TRAINING_DIR: path.join(__dirname, '..', 'zk', 'circuits', 'training'),
    
    // Poseidon chunk size
    CHUNK_SIZE: 16,
    
    // BN254 field prime
    FIELD_PRIME: 21888242871839275222246405745257275088548364400416034343698204186575808495617n
};

// ═══════════════════════════════════════════════════════════════════════════
// UTILITY FUNCTIONS
// ═══════════════════════════════════════════════════════════════════════════

let seed = 42;
function seededRandom() {
    seed = (seed * 1103515245 + 12345) & 0x7fffffff;
    return seed / 0x7fffffff;
}

function randomInt(min, max) {
    return Math.floor(seededRandom() * (max - min + 1)) + min;
}

function printHeader(text) {
    console.log(`\n${'═'.repeat(60)}`);
    console.log(`  ${text}`);
    console.log('═'.repeat(60));
}

function printStep(num, text) {
    console.log(`\n[STEP ${num}] ${text}`);
}

function printSuccess(text) { console.log(`  ✅ ${text}`); }
function printError(text) { console.log(`  ❌ ${text}`); }
function printInfo(text) { console.log(`  ℹ️  ${text}`); }

function runCommand(cmd, cwd) {
    try {
        execSync(cmd, { cwd, stdio: 'pipe' });
        return { success: true };
    } catch (error) {
        return { success: false, error: error.message };
    }
}

// ═══════════════════════════════════════════════════════════════════════════
// CRYPTOGRAPHIC FUNCTIONS
// ═══════════════════════════════════════════════════════════════════════════

let poseidon, F;

async function initPoseidon() {
    poseidon = await buildPoseidon();
    F = poseidon.F;
}

function vectorHash(values) {
    if (values.length <= CONFIG.CHUNK_SIZE) {
        const hash = poseidon(values.map(v => BigInt(v)));
        return F.toObject(hash);
    } else {
        const numChunks = Math.ceil(values.length / CONFIG.CHUNK_SIZE);
        const chunkHashes = [];
        for (let c = 0; c < numChunks; c++) {
            const startIdx = c * CONFIG.CHUNK_SIZE;
            const endIdx = Math.min(startIdx + CONFIG.CHUNK_SIZE, values.length);
            const chunk = values.slice(startIdx, endIdx).map(v => BigInt(v));
            const chunkHash = poseidon(chunk);
            chunkHashes.push(F.toObject(chunkHash));
        }
        return F.toObject(poseidon(chunkHashes));
    }
}

function buildMerkleTree(leafHashes) {
    const paddedN = 2 ** CONFIG.DEPTH;
    const zeroHash = F.toObject(poseidon([BigInt(0)]));
    
    const leaves = [...leafHashes];
    while (leaves.length < paddedN) {
        leaves.push(zeroHash);
    }
    
    const tree = [leaves];
    let currentLevel = leaves;
    
    while (currentLevel.length > 1) {
        const nextLevel = [];
        for (let i = 0; i < currentLevel.length; i += 2) {
            const left = currentLevel[i];
            const right = currentLevel[i + 1];
            const hash = poseidon([BigInt(left), BigInt(right)]);
            nextLevel.push(F.toObject(hash));
        }
        tree.push(nextLevel);
        currentLevel = nextLevel;
    }
    
    return tree;
}

function getMerkleProof(tree, leafIdx) {
    const siblings = [];
    const pathIndices = [];
    let currentIdx = leafIdx;
    
    for (let level = 0; level < CONFIG.DEPTH; level++) {
        const siblingIdx = currentIdx ^ 1;
        siblings.push(tree[level][siblingIdx]);
        pathIndices.push(currentIdx % 2);
        currentIdx = Math.floor(currentIdx / 2);
    }
    
    return { siblings, pathIndices };
}

// ═══════════════════════════════════════════════════════════════════════════
// TEST DATA GENERATION
// ═══════════════════════════════════════════════════════════════════════════

function generateDataset() {
    printStep(1, 'Generating Small Test Dataset');
    
    const features = [];
    const labels = [];
    let c0 = 0, c1 = 0;
    
    for (let i = 0; i < CONFIG.N; i++) {
        const row = [];
        for (let j = 0; j < CONFIG.MODEL_DIM; j++) {
            row.push(randomInt(0, 100));
        }
        features.push(row);
        
        const label = i % 2;
        labels.push(label);
        if (label === 0) c0++;
        else c1++;
    }
    
    printSuccess(`Generated ${CONFIG.N} samples (c0=${c0}, c1=${c1})`);
    return { features, labels, c0, c1 };
}

function buildDatasetTree(features, labels) {
    printStep(2, 'Building Merkle Tree');
    
    const leafHashes = [];
    for (let i = 0; i < CONFIG.N; i++) {
        const sampleValues = [...features[i], labels[i]];
        const hash = vectorHash(sampleValues);
        leafHashes.push(hash);
    }
    
    const tree = buildMerkleTree(leafHashes);
    const root = tree[tree.length - 1][0];
    
    printSuccess(`Built tree with root_D = ${root.toString().slice(0, 30)}...`);
    return { tree, leafHashes, root };
}

function generateGradient() {
    printStep(3, 'Generating Gradient');
    
    const gradient = [];
    const gradPos = [];
    const gradNeg = [];
    
    for (let j = 0; j < CONFIG.MODEL_DIM; j++) {
        const g = randomInt(-50, 50);
        gradient.push(g);
        
        if (g >= 0) {
            gradPos.push(g);
            gradNeg.push(0);
        } else {
            gradPos.push(0);
            gradNeg.push(-g);
        }
    }
    
    const normSquared = gradient.reduce((sum, g) => sum + g * g, 0);
    
    const gradientField = gradient.map(g => g >= 0 ? BigInt(g) : CONFIG.FIELD_PRIME + BigInt(g));
    const root_G = vectorHash(gradientField);
    
    printSuccess(`||gradient||² = ${normSquared} ≤ τ² = ${CONFIG.TAU_SQUARED}`);
    return { gradient, gradPos, gradNeg, normSquared, root_G };
}

// ═══════════════════════════════════════════════════════════════════════════
// CIRCUIT OPERATIONS
// ═══════════════════════════════════════════════════════════════════════════

function generateBalanceInput(features, labels, tree, root, c0, c1) {
    printStep(4, 'Generating Balance Input');
    
    const siblings = [];
    const pathIndices = [];
    
    for (let i = 0; i < CONFIG.N; i++) {
        const proof = getMerkleProof(tree, i);
        siblings.push(proof.siblings.map(s => s.toString()));
        pathIndices.push(proof.pathIndices.map(p => p.toString()));
    }
    
    const input = {
        client_id: "1",
        root: root.toString(),
        N_public: CONFIG.N.toString(),
        c0: c0.toString(),
        c1: c1.toString(),
        features: features.map(row => row.map(x => x.toString())),
        labels: labels.map(l => l.toString()),
        siblings: siblings,
        pathIndices: pathIndices
    };
    
    const inputPath = path.join(CONFIG.BALANCE_DIR, 'quick_test_input.json');
    fs.writeFileSync(inputPath, JSON.stringify(input, null, 2));
    
    printSuccess('Saved balance input');
    return inputPath;
}

function generateTrainingInput(features, labels, tree, root, gradPos, gradNeg, root_G) {
    printStep(5, 'Generating Training Input');
    
    const siblings = [];
    const pathIndices = [];
    
    for (let i = 0; i < CONFIG.BATCH_SIZE; i++) {
        const proof = getMerkleProof(tree, i);
        siblings.push(proof.siblings.map(s => s.toString()));
        pathIndices.push(proof.pathIndices.map(p => p.toString()));
    }
    
    const input = {
        client_id: "1",
        root_D: root.toString(),
        root_G: root_G.toString(),
        tauSquared: CONFIG.TAU_SQUARED.toString(),
        gradPos: gradPos.map(x => x.toString()),
        gradNeg: gradNeg.map(x => x.toString()),
        features: features.map(row => row.map(x => x.toString())),
        labels: labels.map(l => l.toString()),
        siblings: siblings,
        pathIndices: pathIndices
    };
    
    const inputPath = path.join(CONFIG.TRAINING_DIR, 'quick_test_input.json');
    fs.writeFileSync(inputPath, JSON.stringify(input, null, 2));
    
    printSuccess('Saved training input');
    return inputPath;
}

async function runProofWorkflow(circuitDir, circuitName, inputPath, tag) {
    printStep(`${tag}`, `Processing ${circuitName}`);
    
    const wasmPath = path.join(circuitDir, `${circuitName}_js`, `${circuitName}.wasm`);
    const zkeyPath = path.join(circuitDir, `${circuitName}_final.zkey`);
    
    // Find ptau file (check project root, circuit dir, and training directory)
    // Prefer pot17 as it supports larger circuits
    let ptauFile = null;
    const possiblePtau = ['pot17_final.ptau', 'pot14_final.ptau'];
    const projectRoot = path.join(__dirname, '..');
    const possibleDirs = [projectRoot, circuitDir, CONFIG.TRAINING_DIR];
    
    for (const dir of possibleDirs) {
        for (const ptau of possiblePtau) {
            if (fs.existsSync(path.join(dir, ptau))) {
                ptauFile = path.join(dir, ptau);
                break;
            }
        }
        if (ptauFile) break;
    }
    
    if (!ptauFile) {
        printError('No ptau file found!');
        return null;
    }
    
    // Check if circuit needs setup
    if (!fs.existsSync(wasmPath) || !fs.existsSync(zkeyPath)) {
        printInfo('Circuit not fully set up. Setting up...');
        
        // Check if R1CS exists, compile if not
        const r1csPath = path.join(circuitDir, `${circuitName}.r1cs`);
        if (!fs.existsSync(r1csPath)) {
            printInfo('Compiling circuit...');
            let result = runCommand(
                `circom ${circuitName}.circom --r1cs --wasm --sym -o .`,
                circuitDir
            );
            if (!result.success) {
                printError('Compilation failed');
                return null;
            }
        }
        
        // Setup if zkey doesn't exist
        if (!fs.existsSync(zkeyPath)) {
            printInfo('Running trusted setup...');
            let result = runCommand(
                `npx snarkjs groth16 setup ${circuitName}.r1cs "${ptauFile}" ${circuitName}_0000.zkey`,
                circuitDir
            );
            if (!result.success) {
                printError('Setup failed');
                return null;
            }
            
            result = runCommand(
                `npx snarkjs zkey contribute ${circuitName}_0000.zkey ${circuitName}_final.zkey --name="test" -e="entropy"`,
                circuitDir
            );
            if (!result.success) {
                printError('Contribution failed');
                return null;
            }
            
            // Export to circuit-specific verification key
            runCommand(
                `npx snarkjs zkey export verificationkey ${circuitName}_final.zkey ${circuitName}_vkey.json`,
                circuitDir
            );
            
            try { fs.unlinkSync(path.join(circuitDir, `${circuitName}_0000.zkey`)); } catch(e) {}
        }
    }
    
    // Find verification key (circuit-specific or generic)
    let vkeyPath = path.join(circuitDir, `${circuitName}_vkey.json`);
    if (!fs.existsSync(vkeyPath)) {
        vkeyPath = path.join(circuitDir, 'verification_key.json');
    }
    
    // Ensure .cjs files exist
    const jsDir = path.join(circuitDir, `${circuitName}_js`);
    const jsPath = path.join(jsDir, 'generate_witness.js');
    const cjsPath = path.join(jsDir, 'generate_witness.cjs');
    
    if (fs.existsSync(jsPath) && !fs.existsSync(cjsPath)) {
        let content = fs.readFileSync(jsPath, 'utf8');
        content = content.replace('require("./witness_calculator.js")', 'require("./witness_calculator.cjs")');
        fs.writeFileSync(cjsPath, content);
        
        const wcJs = path.join(jsDir, 'witness_calculator.js');
        const wcCjs = path.join(jsDir, 'witness_calculator.cjs');
        if (fs.existsSync(wcJs) && !fs.existsSync(wcCjs)) {
            fs.copyFileSync(wcJs, wcCjs);
        }
    }
    
    // Generate witness
    const witnessPath = path.join(circuitDir, `${circuitName}_quick.wtns`);
    let result = runCommand(
        `node "${cjsPath}" "${wasmPath}" "${inputPath}" "${witnessPath}"`,
        circuitDir
    );
    if (!result.success) {
        printError('Witness generation failed');
        return null;
    }
    printSuccess('Witness generated');
    
    // Generate proof
    const proofPath = path.join(circuitDir, `${circuitName}_quick_proof.json`);
    const publicPath = path.join(circuitDir, `${circuitName}_quick_public.json`);
    
    result = runCommand(
        `npx snarkjs groth16 prove ${circuitName}_final.zkey ${witnessPath} ${proofPath} ${publicPath}`,
        circuitDir
    );
    if (!result.success) {
        printError('Proof generation failed');
        return null;
    }
    printSuccess('Proof generated');
    
    // Verify proof
    result = runCommand(
        `npx snarkjs groth16 verify "${vkeyPath}" ${publicPath} ${proofPath}`,
        circuitDir
    );
    if (!result.success) {
        printError('Verification failed');
        return null;
    }
    printSuccess('Proof verified! ✓');
    
    return JSON.parse(fs.readFileSync(publicPath, 'utf8'));
}

// ═══════════════════════════════════════════════════════════════════════════
// MAIN TEST
// ═══════════════════════════════════════════════════════════════════════════

async function main() {
    printHeader('QUICK INTEGRATION TEST');
    console.log('\n  Testing with small parameters: N=8, DIM=4, DEPTH=3');
    console.log('  This validates the cryptographic binding works correctly.\n');
    
    const startTime = Date.now();
    
    try {
        await initPoseidon();
        
        // Generate test data
        const { features, labels, c0, c1 } = generateDataset();
        const { tree, leafHashes, root } = buildDatasetTree(features, labels);
        const { gradPos, gradNeg, normSquared, root_G } = generateGradient();
        
        // Generate inputs (using SAME root!)
        const balanceInput = generateBalanceInput(features, labels, tree, root, c0, c1);
        const trainingInput = generateTrainingInput(features, labels, tree, root, gradPos, gradNeg, root_G);
        
        // Run proofs
        // Note: Using balance_unified which has (8, 3, 4) parameters
        const balancePublic = await runProofWorkflow(CONFIG.BALANCE_DIR, 'balance_unified', balanceInput, '6a');
        if (!balancePublic) {
            printError('Balance proof failed!');
            process.exit(1);
        }
        
        // Create matching training circuit for small test
        const trainingCircuitPath = path.join(CONFIG.TRAINING_DIR, 'sgd_step_quick.circom');
        if (!fs.existsSync(trainingCircuitPath)) {
            const circuitContent = `pragma circom 2.0.0;

include "./vector_hash.circom";
include "../lib/merkle.circom";
include "../../../node_modules/circomlib/circuits/comparators.circom";

template VerifyClippingSound(DIM) {
    signal input gradPos[DIM];
    signal input gradNeg[DIM];
    signal input tauSquared;
    
    signal output gradient[DIM];
    signal output normSquared;
    signal output valid;
    
    for (var j = 0; j < DIM; j++) {
        gradPos[j] * gradNeg[j] === 0;
    }
    
    signal posSquared[DIM];
    signal negSquared[DIM];
    signal componentNormSq[DIM];
    signal partialNorm[DIM + 1];
    
    partialNorm[0] <== 0;
    
    for (var j = 0; j < DIM; j++) {
        posSquared[j] <== gradPos[j] * gradPos[j];
        negSquared[j] <== gradNeg[j] * gradNeg[j];
        componentNormSq[j] <== posSquared[j] + negSquared[j];
        partialNorm[j + 1] <== partialNorm[j] + componentNormSq[j];
    }
    
    normSquared <== partialNorm[DIM];
    
    component lt = LessThan(64);
    lt.in[0] <== normSquared;
    lt.in[1] <== tauSquared + 1;
    valid <== lt.out;
    
    for (var j = 0; j < DIM; j++) {
        gradient[j] <== gradPos[j] - gradNeg[j];
    }
}

template TrainingStepQuick(BATCH_SIZE, MODEL_DIM, DEPTH) {
    signal input client_id;
    signal input root_D;
    signal input root_G;
    signal input tauSquared;
    
    signal input gradPos[MODEL_DIM];
    signal input gradNeg[MODEL_DIM];
    signal input features[BATCH_SIZE][MODEL_DIM];
    signal input labels[BATCH_SIZE];
    signal input siblings[BATCH_SIZE][DEPTH];
    signal input pathIndices[BATCH_SIZE][DEPTH];
    
    component batchVerifier = BatchMerkleProofPreHashed(BATCH_SIZE, DEPTH);
    batchVerifier.root <== root_D;
    
    component leafHash[BATCH_SIZE];
    for (var i = 0; i < BATCH_SIZE; i++) {
        leafHash[i] = VectorHash(MODEL_DIM + 1);
        for (var j = 0; j < MODEL_DIM; j++) {
            leafHash[i].values[j] <== features[i][j];
        }
        leafHash[i].values[MODEL_DIM] <== labels[i];
        
        batchVerifier.leafHashes[i] <== leafHash[i].hash;
        for (var j = 0; j < DEPTH; j++) {
            batchVerifier.siblings[i][j] <== siblings[i][j];
            batchVerifier.pathIndices[i][j] <== pathIndices[i][j];
        }
    }
    
    component clipVerifier = VerifyClippingSound(MODEL_DIM);
    for (var j = 0; j < MODEL_DIM; j++) {
        clipVerifier.gradPos[j] <== gradPos[j];
        clipVerifier.gradNeg[j] <== gradNeg[j];
    }
    clipVerifier.tauSquared <== tauSquared;
    clipVerifier.valid === 1;
    
    component gradHash = VectorHash(MODEL_DIM);
    for (var j = 0; j < MODEL_DIM; j++) {
        gradHash.values[j] <== clipVerifier.gradient[j];
    }
    root_G === gradHash.hash;
    
    signal clientCheck;
    clientCheck <== client_id * 0;
}

component main {public [client_id, root_D, root_G, tauSquared]} = TrainingStepQuick(8, 4, 3);
`;
            fs.writeFileSync(trainingCircuitPath, circuitContent);
            printInfo('Created quick training circuit');
        }
        
        const trainingPublic = await runProofWorkflow(CONFIG.TRAINING_DIR, 'sgd_step_quick', trainingInput, '6b');
        if (!trainingPublic) {
            printError('Training proof failed!');
            process.exit(1);
        }
        
        // Verify binding
        printHeader('VERIFYING BINDING');
        
        const balanceRoot = balancePublic[1];
        const trainingRoot = trainingPublic[1];
        
        printInfo(`Balance root:  ${balanceRoot.slice(0, 30)}...`);
        printInfo(`Training root: ${trainingRoot.slice(0, 30)}...`);
        
        if (balanceRoot === trainingRoot) {
            printSuccess('✓ root_D MATCHES - Components are cryptographically bound!');
        } else {
            printError('root_D MISMATCH!');
            process.exit(1);
        }
        
        const duration = ((Date.now() - startTime) / 1000).toFixed(2);
        
        printHeader('ALL TESTS PASSED ✓');
        console.log(`
  ┌──────────────────────────────────────────────────┐
  │           QUICK TEST SUMMARY                     │
  ├──────────────────────────────────────────────────┤
  │  ✓ Balance proof verified (c0=4, c1=4)          │
  │  ✓ Training proof verified                       │
  │  ✓ root_D binding confirmed                      │
  │  Duration: ${duration}s                              │
  └──────────────────────────────────────────────────┘
        `);
        
        console.log('  Run integration_test.mjs for full production test.\n');
        
    } catch (error) {
        printError(`Test failed: ${error.message}`);
        console.error(error);
        process.exit(1);
    }
}

main().catch(console.error);
