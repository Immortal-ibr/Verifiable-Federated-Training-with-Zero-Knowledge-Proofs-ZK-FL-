#!/usr/bin/env node
/**
 * ═══════════════════════════════════════════════════════════════════════════
 * Test for SGD with Verified Gradient Correctness (using circomlib-ml)
 * ═══════════════════════════════════════════════════════════════════════════
 * 
 * This test verifies that the new sgd_verified.circom circuit:
 *   1. Verifies batch membership
 *   2. Verifies gradient clipping
 *   3. Verifies gradient is CORRECTLY computed from data (NEW!)
 *   4. Verifies gradient commitment
 * 
 * The circuit uses circomlib-ml's matElemMul and matElemSum for dot products.
 * 
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
// CONFIGURATION (must match circuit parameters)
// ═══════════════════════════════════════════════════════════════════════════

const CONFIG = {
    BATCH_SIZE: 8,
    MODEL_DIM: 4,
    DEPTH: 3,
    PRECISION: 1000,  // Fixed-point scaling factor
    TAU_SQUARED: 100000000,  // Larger threshold for scaled gradients
    CLIENT_ID: 1,
    ROUND: 1,
    
    CHUNK_SIZE: 16,
    FIELD_PRIME: 21888242871839275222246405745257275088548364400416034343698204186575808495617n,
    
    TRAINING_DIR: path.join(__dirname, '..', 'artifacts', 'training'),
    KEYS_DIR: path.join(__dirname, '..', 'artifacts', 'keys'),
    PROJECT_ROOT: path.join(__dirname, '..')
};

// ═══════════════════════════════════════════════════════════════════════════
// UTILITIES
// ═══════════════════════════════════════════════════════════════════════════

const COLORS = {
    reset: '\x1b[0m',
    green: '\x1b[32m',
    red: '\x1b[31m',
    yellow: '\x1b[33m',
    blue: '\x1b[36m',
    gray: '\x1b[90m'
};

function color(text, c) { return `${COLORS[c] || ''}${text}${COLORS.reset}`; }
function printSuccess(text) { console.log(`  ${color('✓', 'green')} ${text}`); }
function printError(text) { console.log(`  ${color('✗', 'red')} ${text}`); }
function printInfo(text) { console.log(`  ${color('→', 'gray')} ${text}`); }
function printSection(text) { console.log(`\n${color('━━━ ' + text + ' ━━━', 'blue')}`); }

function runCommand(cmd, cwd) {
    try {
        const output = execSync(cmd, { cwd, stdio: 'pipe' });
        return { success: true, output: output.toString() };
    } catch (error) {
        return { success: false, error: error.message };
    }
}

// ═══════════════════════════════════════════════════════════════════════════
// CRYPTOGRAPHIC PRIMITIVES
// ═══════════════════════════════════════════════════════════════════════════

let poseidon, F;

async function initCrypto() {
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

function gradientCommitment(gradientFieldValues, clientId, round) {
    const gradHash = vectorHash(gradientFieldValues);
    const metaHash = F.toObject(poseidon([BigInt(clientId), BigInt(round)]));
    const commitment = F.toObject(poseidon([BigInt(gradHash), BigInt(metaHash)]));
    return commitment;
}

function weightCommitment(weights) {
    return vectorHash(weights.map(w => BigInt(w)));
}

function buildMerkleTree(leafHashes, depth) {
    const paddedN = 2 ** depth;
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

function getMerkleProof(tree, leafIdx, depth) {
    const siblings = [];
    const pathIndices = [];
    let currentIdx = leafIdx;
    
    for (let level = 0; level < depth; level++) {
        const siblingIdx = currentIdx ^ 1;
        siblings.push(tree[level][siblingIdx]);
        pathIndices.push(currentIdx % 2);
        currentIdx = Math.floor(currentIdx / 2);
    }
    
    return { siblings, pathIndices };
}

// ═══════════════════════════════════════════════════════════════════════════
// GRADIENT COMPUTATION (must match circuit logic exactly)
// ═══════════════════════════════════════════════════════════════════════════

function computeCorrectGradient(features, labels, weights) {
    const PRECISION = CONFIG.PRECISION;
    const BATCH_SIZE = CONFIG.BATCH_SIZE;
    const MODEL_DIM = CONFIG.MODEL_DIM;
    const DIVISOR = BATCH_SIZE * PRECISION;
    
    // Scale weights for fixed-point (weights are already integers, just use them)
    const scaledWeights = weights;
    
    // Compute summed gradient (matches circuit exactly)
    const summedGrad = new Array(MODEL_DIM).fill(0);
    
    for (let i = 0; i < BATCH_SIZE; i++) {
        // prediction = dot(features, weights)
        let prediction = 0;
        for (let j = 0; j < MODEL_DIM; j++) {
            prediction += features[i][j] * scaledWeights[j];
        }
        
        // error = prediction - label * PRECISION (circuit scales label)
        const scaledLabel = labels[i] * PRECISION;
        const error = prediction - scaledLabel;
        
        // gradient[j] += error * feature[j]
        for (let j = 0; j < MODEL_DIM; j++) {
            summedGrad[j] += error * features[i][j];
        }
    }
    
    // Compute gradient and remainder:
    // summedGrad[j] = gradient[j] * DIVISOR + remainder[j]
    const gradient = [];
    const remainder = [];
    for (let j = 0; j < MODEL_DIM; j++) {
        // Use floor division for gradient
        const quotient = Math.floor(summedGrad[j] / DIVISOR);
        const rem = summedGrad[j] - quotient * DIVISOR;
        gradient.push(quotient);
        remainder.push(rem);
    }
    
    return { gradient, summedGrad, remainder };
}

// ═══════════════════════════════════════════════════════════════════════════
// TEST DATA GENERATION
// ═══════════════════════════════════════════════════════════════════════════

function generateTestData() {
    printSection('GENERATING TEST DATA');
    
    // Generate random features (small values for testing)
    const features = [];
    for (let i = 0; i < CONFIG.BATCH_SIZE; i++) {
        const row = [];
        for (let j = 0; j < CONFIG.MODEL_DIM; j++) {
            row.push(Math.floor(Math.random() * 10) + 1);  // 1-10
        }
        features.push(row);
    }
    
    // Generate binary labels
    const labels = [];
    for (let i = 0; i < CONFIG.BATCH_SIZE; i++) {
        labels.push(i % 2);  // Alternating 0, 1
    }
    
    // Random weights (these are already the scaled values for the circuit)
    // In production, weights would be floats multiplied by PRECISION
    const weights = [];
    for (let j = 0; j < CONFIG.MODEL_DIM; j++) {
        weights.push(Math.floor(Math.random() * 2000) - 1000);  // -1000 to 999 (scaled)
    }
    
    printInfo(`Features: ${CONFIG.BATCH_SIZE} samples × ${CONFIG.MODEL_DIM} dims`);
    printInfo(`Weights (scaled): [${weights.join(', ')}]`);
    printInfo(`Labels: [${labels.join(', ')}]`);
    
    // Compute correct gradient and summed gradient
    const { gradient, summedGrad, remainder } = computeCorrectGradient(features, labels, weights);
    printInfo(`Summed gradient: [${summedGrad.slice(0, 3).join(', ')}, ...]`);
    printInfo(`Final gradient: [${gradient.join(', ')}]`);
    printInfo(`Remainder: [${remainder.join(', ')}]`);
    
    // Convert to sign-magnitude form
    const gradPos = [];
    const gradNeg = [];
    for (let j = 0; j < CONFIG.MODEL_DIM; j++) {
        if (gradient[j] >= 0) {
            gradPos.push(gradient[j]);
            gradNeg.push(0);
        } else {
            gradPos.push(0);
            gradNeg.push(-gradient[j]);
        }
    }
    
    // Check norm
    const normSquared = gradient.reduce((sum, g) => sum + g * g, 0);
    printInfo(`Gradient norm² = ${normSquared} (limit: ${CONFIG.TAU_SQUARED})`);
    
    if (normSquared > CONFIG.TAU_SQUARED) {
        printError('Gradient norm exceeds limit! Test will fail.');
    }
    
    // Build Merkle tree
    const leafHashes = [];
    for (let i = 0; i < CONFIG.BATCH_SIZE; i++) {
        const sampleValues = [...features[i], labels[i]];
        leafHashes.push(vectorHash(sampleValues));
    }
    const merkleTree = buildMerkleTree(leafHashes, CONFIG.DEPTH);
    const root_D = merkleTree[merkleTree.length - 1][0];
    
    // Get Merkle proofs
    const siblings = [];
    const pathIndices = [];
    for (let i = 0; i < CONFIG.BATCH_SIZE; i++) {
        const proof = getMerkleProof(merkleTree, i, CONFIG.DEPTH);
        siblings.push(proof.siblings.map(s => s.toString()));
        pathIndices.push(proof.pathIndices.map(p => p.toString()));
    }
    
    // Compute commitments (weights are already scaled)
    const root_W = weightCommitment(weights);
    const gradientField = gradient.map(g => g >= 0 ? BigInt(g) : CONFIG.FIELD_PRIME + BigInt(g));
    const root_G = gradientCommitment(gradientField, CONFIG.CLIENT_ID, CONFIG.ROUND);
    
    printSuccess('Test data generated');
    printInfo(`root_D = ${root_D.toString().slice(0, 20)}...`);
    printInfo(`root_W = ${root_W.toString().slice(0, 20)}...`);
    printInfo(`root_G = ${root_G.toString().slice(0, 20)}...`);
    
    return {
        // Public inputs
        client_id: CONFIG.CLIENT_ID.toString(),
        round: CONFIG.ROUND.toString(),
        root_D: root_D.toString(),
        root_G: root_G.toString(),
        root_W: root_W.toString(),
        tauSquared: CONFIG.TAU_SQUARED.toString(),
        
        // Private inputs
        weights: weights.map(w => w.toString()),
        expectedSummedGrad: summedGrad.map(g => g.toString()),  // for gradient verification
        remainder: remainder.map(r => r.toString()),  // NEW: remainder from division
        gradPos: gradPos.map(x => x.toString()),
        gradNeg: gradNeg.map(x => x.toString()),
        features: features.map(row => row.map(x => x.toString())),
        labels: labels.map(l => l.toString()),
        siblings: siblings,
        pathIndices: pathIndices
    };
}

// ═══════════════════════════════════════════════════════════════════════════
// CIRCUIT COMPILATION AND TESTING
// ═══════════════════════════════════════════════════════════════════════════

async function compileCircuit() {
    printSection('COMPILING CIRCUIT');
    
    const circuitName = 'sgd_verified';
    const circuitDir = CONFIG.TRAINING_DIR;
    const r1csPath = path.join(circuitDir, `${circuitName}.r1cs`);
    const wasmDir = path.join(circuitDir, `${circuitName}_js`);
    
    // Check if already compiled
    if (fs.existsSync(r1csPath) && fs.existsSync(wasmDir)) {
        printInfo('Circuit already compiled, skipping...');
        return true;
    }
    
    printInfo('Compiling sgd_verified.circom with circomlib-ml...');
    
    const result = runCommand(
        `circom sgd_verified.circom --r1cs --wasm --sym -o . -l ../../../node_modules`,
        circuitDir
    );
    
    if (!result.success) {
        printError('Compilation failed!');
        console.error(result.error);
        return false;
    }
    
    printSuccess('Circuit compiled');
    
    // Get constraint count
    const infoResult = runCommand(
        `npx snarkjs r1cs info ${circuitName}.r1cs`,
        circuitDir
    );
    if (infoResult.success) {
        const match = infoResult.output.match(/# of Constraints:\s*(\d+)/);
        if (match) {
            printInfo(`Constraints: ${match[1]}`);
        }
    }
    
    return true;
}

async function setupZKey() {
    printSection('SETTING UP ZKEY');
    
    const circuitName = 'sgd_verified';
    const circuitDir = CONFIG.TRAINING_DIR;
    const zkeyPath = path.join(circuitDir, `${circuitName}_final.zkey`);
    
    if (fs.existsSync(zkeyPath)) {
        printInfo('zkey already exists, skipping...');
        return true;
    }
    
    // Find ptau file
    let ptauFile = null;
    const possiblePtau = ['pot17_final.ptau', 'pot14_final.ptau'];
    const possibleDirs = [CONFIG.PROJECT_ROOT, circuitDir];
    
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
        printError('No ptau file found! Please download one.');
        return false;
    }
    
    printInfo(`Using ptau: ${path.basename(ptauFile)}`);
    
    // Setup
    let result = runCommand(
        `npx snarkjs groth16 setup ${circuitName}.r1cs "${ptauFile}" ${circuitName}_0000.zkey`,
        circuitDir
    );
    if (!result.success) {
        printError('Setup failed');
        return false;
    }
    
    // Contribute
    result = runCommand(
        `npx snarkjs zkey contribute ${circuitName}_0000.zkey ${circuitName}_final.zkey --name="test" -e="entropy"`,
        circuitDir
    );
    if (!result.success) {
        printError('Contribution failed');
        return false;
    }
    
    // Export vkey
    runCommand(
        `npx snarkjs zkey export verificationkey ${circuitName}_final.zkey ${circuitName}_vkey.json`,
        circuitDir
    );
    
    // Cleanup
    try { fs.unlinkSync(path.join(circuitDir, `${circuitName}_0000.zkey`)); } catch(e) {}
    
    printSuccess('zkey setup complete');
    return true;
}

async function generateProof(input) {
    printSection('GENERATING PROOF');
    
    const circuitName = 'sgd_verified';
    const circuitDir = CONFIG.TRAINING_DIR;
    
    // Save input
    const inputPath = path.join(circuitDir, `${circuitName}_input.json`);
    fs.writeFileSync(inputPath, JSON.stringify(input, null, 2));
    
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
    const wasmPath = path.join(jsDir, `${circuitName}.wasm`);
    const witnessPath = path.join(circuitDir, `${circuitName}.wtns`);
    
    printInfo('Generating witness...');
    let result = runCommand(
        `node "${cjsPath}" "${wasmPath}" "${inputPath}" "${witnessPath}"`,
        circuitDir
    );
    if (!result.success) {
        printError('Witness generation failed!');
        console.error(result.error);
        return false;
    }
    printSuccess('Witness generated');
    
    // Generate proof
    const proofPath = path.join(circuitDir, `${circuitName}_proof.json`);
    const publicPath = path.join(circuitDir, `${circuitName}_public.json`);
    
    printInfo('Generating ZK proof...');
    result = runCommand(
        `npx snarkjs groth16 prove ${circuitName}_final.zkey ${witnessPath} ${proofPath} ${publicPath}`,
        circuitDir
    );
    if (!result.success) {
        printError('Proof generation failed!');
        return false;
    }
    printSuccess('Proof generated');
    
    return { proofPath, publicPath };
}

async function verifyProof() {
    printSection('VERIFYING PROOF');
    
    const circuitName = 'sgd_verified';
    const circuitDir = CONFIG.TRAINING_DIR;
    
    const vkeyPath = path.join(circuitDir, `${circuitName}_vkey.json`);
    const proofPath = path.join(circuitDir, `${circuitName}_proof.json`);
    const publicPath = path.join(circuitDir, `${circuitName}_public.json`);
    
    const result = runCommand(
        `npx snarkjs groth16 verify "${vkeyPath}" "${publicPath}" "${proofPath}"`,
        circuitDir
    );
    
    if (result.success) {
        printSuccess('PROOF VERIFIED!');
        return true;
    } else {
        printError('Proof verification FAILED!');
        return false;
    }
}

// ═══════════════════════════════════════════════════════════════════════════
// MAIN
// ═══════════════════════════════════════════════════════════════════════════

async function main() {
    console.log(`
╔═══════════════════════════════════════════════════════════════════════════╗
║  SGD VERIFIED TEST - Gradient Correctness with circomlib-ml               ║
╚═══════════════════════════════════════════════════════════════════════════╝

This test verifies that gradients are CORRECTLY COMPUTED from data,
not just committed and clipped. Uses circomlib-ml for matrix operations.
`);
    
    const startTime = Date.now();
    
    try {
        // Initialize
        await initCrypto();
        printSuccess('Cryptographic primitives initialized');
        
        // Generate test data
        const input = generateTestData();
        
        // Compile circuit
        if (!await compileCircuit()) {
            process.exit(1);
        }
        
        // Setup zkey
        if (!await setupZKey()) {
            process.exit(1);
        }
        
        // Generate proof
        const proofResult = await generateProof(input);
        if (!proofResult) {
            process.exit(1);
        }
        
        // Verify proof
        const verified = await verifyProof();
        
        const duration = ((Date.now() - startTime) / 1000).toFixed(2);
        
        console.log(`
╔═══════════════════════════════════════════════════════════════════════════╗
║                              TEST RESULT                                   ║
╠═══════════════════════════════════════════════════════════════════════════╣
║  Gradient Correctness: ${verified ? '✓ VERIFIED' : '✗ FAILED'}                                      ║
║  Duration: ${duration}s                                                      ║
╚═══════════════════════════════════════════════════════════════════════════╝
`);
        
        if (verified) {
            console.log(color(`
    What was verified:
    1. Batch samples are in committed dataset (Merkle proof)
    2. Gradient is within clipping bound (norm² ≤ τ²)
    3. Gradient is CORRECTLY computed from features/labels/weights
    4. Gradient commitment matches the verified gradient
    5. Weight commitment matches the used weights
`, 'gray'));
        }
        
        process.exit(verified ? 0 : 1);
        
    } catch (error) {
        printError(`Test failed: ${error.message}`);
        console.error(error);
        process.exit(1);
    }
}

main();
