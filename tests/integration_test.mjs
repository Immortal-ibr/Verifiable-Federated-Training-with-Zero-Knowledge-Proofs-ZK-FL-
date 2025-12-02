#!/usr/bin/env node
/**
 * ═══════════════════════════════════════════════════════════════════════════
 * COMPREHENSIVE INTEGRATION TEST: Balance + Training Components
 * ═══════════════════════════════════════════════════════════════════════════
 * 
 * This test verifies the complete flow of our ZK-FL system:
 * 
 * 1. Generate a dataset with known class balance
 * 2. Build Merkle tree with unified leaf structure
 * 3. Generate Component A (Balance) proof
 * 4. Generate Component B (Training) proof using SAME root_D
 * 5. Verify both proofs
 * 6. Confirm cryptographic binding between components
 * 
 * SUCCESS CRITERIA:
 * ✓ Both proofs verify successfully
 * ✓ root_D matches between Component A and B
 * ✓ Gradient commitment (root_G) is correctly computed
 * ✓ Clipping constraint is satisfied
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
// CONFIGURATION
// ═══════════════════════════════════════════════════════════════════════════

const CONFIG = {
    // Dataset parameters
    N: 128,                  // Total samples
    MODEL_DIM: 16,           // Feature dimensions
    DEPTH: 7,                // Merkle tree depth (2^7 = 128)
    
    // Training parameters
    BATCH_SIZE: 8,           // Samples per training batch
    TAU_SQUARED: 100000,     // Clipping threshold
    
    // Paths - artifacts contain compiled circuits
    BALANCE_DIR: path.join(__dirname, '..', 'artifacts', 'balance'),
    TRAINING_DIR: path.join(__dirname, '..', 'artifacts', 'training'),
    KEYS_DIR: path.join(__dirname, '..', 'artifacts', 'keys'),
    
    // Poseidon chunk size
    CHUNK_SIZE: 16,
    
    // BN254 field prime
    FIELD_PRIME: 21888242871839275222246405745257275088548364400416034343698204186575808495617n
};

// ═══════════════════════════════════════════════════════════════════════════
// UTILITY FUNCTIONS
// ═══════════════════════════════════════════════════════════════════════════

// Seeded random for reproducibility
let seed = 12345;
function seededRandom() {
    seed = (seed * 1103515245 + 12345) & 0x7fffffff;
    return seed / 0x7fffffff;
}

function randomInt(min, max) {
    return Math.floor(seededRandom() * (max - min + 1)) + min;
}

function printHeader(text) {
    const line = '═'.repeat(70);
    console.log(`\n${line}`);
    console.log(`  ${text}`);
    console.log(line);
}

function printStep(num, text) {
    console.log(`\n[STEP ${num}] ${text}`);
    console.log('─'.repeat(50));
}

function printSuccess(text) {
    console.log(`  ✅ ${text}`);
}

function printError(text) {
    console.log(`  ❌ ${text}`);
}

function printInfo(text) {
    console.log(`  ℹ️  ${text}`);
}

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
    
    // Pad leaves
    const leaves = [...leafHashes];
    while (leaves.length < paddedN) {
        leaves.push(zeroHash);
    }
    
    // Build tree bottom-up
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

function verifyMerkleProof(leafHash, siblings, pathIndices, root) {
    let currentHash = leafHash;
    
    for (let i = 0; i < CONFIG.DEPTH; i++) {
        const sibling = siblings[i];
        const isRight = pathIndices[i];
        
        let left, right;
        if (isRight === 0) {
            left = currentHash;
            right = sibling;
        } else {
            left = sibling;
            right = currentHash;
        }
        
        currentHash = F.toObject(poseidon([BigInt(left), BigInt(right)]));
    }
    
    return currentHash.toString() === root.toString();
}

// ═══════════════════════════════════════════════════════════════════════════
// TEST DATA GENERATION
// ═══════════════════════════════════════════════════════════════════════════

function generateDataset() {
    printStep(1, 'Generating Dataset');
    
    const features = [];
    const labels = [];
    let c0 = 0, c1 = 0;
    
    // Generate balanced dataset (roughly 50-50)
    for (let i = 0; i < CONFIG.N; i++) {
        const row = [];
        for (let j = 0; j < CONFIG.MODEL_DIM; j++) {
            row.push(randomInt(0, 1000));
        }
        features.push(row);
        
        // Alternate labels for balance
        const label = i % 2;
        labels.push(label);
        if (label === 0) c0++;
        else c1++;
    }
    
    printSuccess(`Generated ${CONFIG.N} samples`);
    printInfo(`Class distribution: c0=${c0}, c1=${c1}`);
    printInfo(`Feature dimensions: ${CONFIG.MODEL_DIM}`);
    
    return { features, labels, c0, c1 };
}

function buildDatasetTree(features, labels) {
    printStep(2, 'Building Merkle Tree');
    
    // Compute leaf hashes using UNIFIED structure: VectorHash(features || label)
    const leafHashes = [];
    for (let i = 0; i < CONFIG.N; i++) {
        const sampleValues = [...features[i], labels[i]];
        const hash = vectorHash(sampleValues);
        leafHashes.push(hash);
    }
    
    const tree = buildMerkleTree(leafHashes);
    const root = tree[tree.length - 1][0];
    
    printSuccess(`Built Merkle tree with depth ${CONFIG.DEPTH}`);
    printInfo(`root_D = ${root.toString().slice(0, 40)}...`);
    
    return { tree, leafHashes, root };
}

function generateGradient() {
    printStep(3, 'Generating Gradient (Sign-Magnitude Decomposition)');
    
    const gradient = [];
    const gradPos = [];
    const gradNeg = [];
    
    for (let j = 0; j < CONFIG.MODEL_DIM; j++) {
        // Random gradient in range [-100, 100]
        const g = randomInt(-100, 100);
        gradient.push(g);
        
        if (g >= 0) {
            gradPos.push(g);
            gradNeg.push(0);
        } else {
            gradPos.push(0);
            gradNeg.push(-g);
        }
    }
    
    // Compute norm squared
    const normSquared = gradient.reduce((sum, g) => sum + g * g, 0);
    
    printSuccess(`Generated ${CONFIG.MODEL_DIM}-dimensional gradient`);
    printInfo(`||gradient||² = ${normSquared}`);
    printInfo(`τ² = ${CONFIG.TAU_SQUARED}`);
    printInfo(`Clipping satisfied: ${normSquared <= CONFIG.TAU_SQUARED ? 'YES ✓' : 'NO ✗'}`);
    
    // Compute gradient commitment
    const gradientField = gradient.map(g => g >= 0 ? BigInt(g) : CONFIG.FIELD_PRIME + BigInt(g));
    const root_G = vectorHash(gradientField);
    
    printInfo(`root_G = ${root_G.toString().slice(0, 40)}...`);
    
    return { gradient, gradPos, gradNeg, normSquared, root_G };
}

// ═══════════════════════════════════════════════════════════════════════════
// COMPONENT A: BALANCE PROOF
// ═══════════════════════════════════════════════════════════════════════════

function generateBalanceInput(features, labels, tree, leafHashes, root, c0, c1) {
    printStep(4, 'Generating Component A (Balance) Input');
    
    // Get Merkle proofs for ALL samples
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
    
    const inputPath = path.join(CONFIG.BALANCE_DIR, 'test_input_integration.json');
    fs.writeFileSync(inputPath, JSON.stringify(input, null, 2));
    
    printSuccess(`Saved balance input to ${path.basename(inputPath)}`);
    printInfo(`Public: client_id=${input.client_id}, N=${input.N_public}, c0=${input.c0}, c1=${input.c1}`);
    
    return inputPath;
}

// ═══════════════════════════════════════════════════════════════════════════
// COMPONENT B: TRAINING PROOF
// ═══════════════════════════════════════════════════════════════════════════

function generateTrainingInput(features, labels, tree, leafHashes, root, gradPos, gradNeg, root_G) {
    printStep(5, 'Generating Component B (Training) Input');
    
    // Select batch (first BATCH_SIZE samples)
    const batchIndices = Array.from({ length: CONFIG.BATCH_SIZE }, (_, i) => i);
    const batchFeatures = batchIndices.map(i => features[i]);
    const batchLabels = batchIndices.map(i => labels[i]);
    
    // Get Merkle proofs for batch
    const siblings = [];
    const pathIndices = [];
    
    for (const idx of batchIndices) {
        const proof = getMerkleProof(tree, idx);
        siblings.push(proof.siblings.map(s => s.toString()));
        pathIndices.push(proof.pathIndices.map(p => p.toString()));
    }
    
    // Verify proofs locally
    let allValid = true;
    for (let i = 0; i < CONFIG.BATCH_SIZE; i++) {
        const valid = verifyMerkleProof(
            leafHashes[batchIndices[i]],
            siblings[i].map(s => BigInt(s)),
            pathIndices[i].map(p => parseInt(p)),
            root
        );
        if (!valid) allValid = false;
    }
    
    if (!allValid) {
        printError('Local Merkle proof verification failed!');
        process.exit(1);
    }
    printSuccess('Local Merkle proof verification passed');
    
    const input = {
        client_id: "1",
        root_D: root.toString(),
        root_G: root_G.toString(),
        tauSquared: CONFIG.TAU_SQUARED.toString(),
        gradPos: gradPos.map(x => x.toString()),
        gradNeg: gradNeg.map(x => x.toString()),
        features: batchFeatures.map(row => row.map(x => x.toString())),
        labels: batchLabels.map(l => l.toString()),
        siblings: siblings,
        pathIndices: pathIndices
    };
    
    const inputPath = path.join(CONFIG.TRAINING_DIR, 'test_input_integration.json');
    fs.writeFileSync(inputPath, JSON.stringify(input, null, 2));
    
    printSuccess(`Saved training input to ${path.basename(inputPath)}`);
    printInfo(`Public: root_D matches Balance, root_G for aggregation`);
    
    return inputPath;
}

// ═══════════════════════════════════════════════════════════════════════════
// CIRCUIT COMPILATION & PROOF GENERATION
// ═══════════════════════════════════════════════════════════════════════════

function checkCircuitFiles(circuitDir, circuitName) {
    const requiredFiles = [
        `${circuitName}.r1cs`,
        `${circuitName}_js/${circuitName}.wasm`,
        `${circuitName}_final.zkey`,
        'verification_key.json'
    ];
    
    const missing = requiredFiles.filter(f => !fs.existsSync(path.join(circuitDir, f)));
    return missing;
}

async function compileCircuit(circuitDir, circuitName, circomFile) {
    printInfo(`Compiling ${circomFile}...`);
    
    const result = runCommand(
        `circom ${circomFile} --r1cs --wasm --sym -o .`,
        circuitDir
    );
    
    if (!result.success) {
        printError(`Compilation failed: ${result.error}`);
        return false;
    }
    
    printSuccess('Compilation successful');
    return true;
}

async function setupCircuit(circuitDir, circuitName) {
    printInfo('Running trusted setup...');
    
    // Find ptau file - prefer pot17 for larger circuits
    let ptauPath = path.join(CONFIG.TRAINING_DIR, 'pot17_final.ptau');
    if (!fs.existsSync(ptauPath)) {
        ptauPath = path.join(CONFIG.TRAINING_DIR, 'pot14_final.ptau');
        if (!fs.existsSync(ptauPath)) {
            ptauPath = path.join(circuitDir, 'pot17_final.ptau');
            if (!fs.existsSync(ptauPath)) {
                printError('No ptau file found. Please download pot17_final.ptau');
                return false;
            }
        }
    }
    
    // Groth16 setup with full path
    let result = runCommand(
        `npx snarkjs groth16 setup ${circuitName}.r1cs "${ptauPath}" ${circuitName}_0000.zkey`,
        circuitDir
    );
    if (!result.success) {
        printError('Groth16 setup failed');
        return false;
    }
    
    // Contribute
    result = runCommand(
        `npx snarkjs zkey contribute ${circuitName}_0000.zkey ${circuitName}_final.zkey --name="integration_test" -e="random entropy ${Date.now()}"`,
        circuitDir
    );
    if (!result.success) {
        printError('Key contribution failed');
        return false;
    }
    
    // Export verification key
    result = runCommand(
        `npx snarkjs zkey export verificationkey ${circuitName}_final.zkey verification_key.json`,
        circuitDir
    );
    if (!result.success) {
        printError('Verification key export failed');
        return false;
    }
    
    // Cleanup intermediate file
    try {
        fs.unlinkSync(path.join(circuitDir, `${circuitName}_0000.zkey`));
    } catch (e) {}
    
    printSuccess('Trusted setup complete');
    return true;
}

async function generateWitness(circuitDir, circuitName, inputFile, witnessFile) {
    printInfo('Generating witness...');
    
    const wasmPath = path.join(circuitDir, `${circuitName}_js`, `${circuitName}.wasm`);
    const witnessGenPath = path.join(circuitDir, `${circuitName}_js`, 'generate_witness.cjs');
    
    // Check if witness generator exists, rename if needed
    const jsPath = path.join(circuitDir, `${circuitName}_js`, 'generate_witness.js');
    if (fs.existsSync(jsPath) && !fs.existsSync(witnessGenPath)) {
        // Read and modify for CommonJS
        let content = fs.readFileSync(jsPath, 'utf8');
        content = content.replace('require("./witness_calculator.js")', 'require("./witness_calculator.cjs")');
        fs.writeFileSync(witnessGenPath, content);
        
        const wcJsPath = path.join(circuitDir, `${circuitName}_js`, 'witness_calculator.js');
        const wcCjsPath = path.join(circuitDir, `${circuitName}_js`, 'witness_calculator.cjs');
        if (fs.existsSync(wcJsPath) && !fs.existsSync(wcCjsPath)) {
            fs.copyFileSync(wcJsPath, wcCjsPath);
        }
    }
    
    const result = runCommand(
        `node "${witnessGenPath}" "${wasmPath}" "${inputFile}" "${witnessFile}"`,
        circuitDir
    );
    
    if (!result.success) {
        printError('Witness generation failed');
        return false;
    }
    
    printSuccess('Witness generated');
    return true;
}

async function generateProof(circuitDir, circuitName, witnessFile, proofFile, publicFile) {
    printInfo('Generating proof...');
    
    const result = runCommand(
        `npx snarkjs groth16 prove ${circuitName}_final.zkey ${witnessFile} ${proofFile} ${publicFile}`,
        circuitDir
    );
    
    if (!result.success) {
        printError('Proof generation failed');
        return false;
    }
    
    printSuccess('Proof generated');
    return true;
}

async function verifyProof(circuitDir, proofFile, publicFile) {
    printInfo('Verifying proof...');
    
    const result = runCommand(
        `npx snarkjs groth16 verify verification_key.json ${publicFile} ${proofFile}`,
        circuitDir
    );
    
    if (!result.success) {
        printError('Proof verification failed');
        return false;
    }
    
    printSuccess('Proof verified! ✓');
    return true;
}

// ═══════════════════════════════════════════════════════════════════════════
// MAIN TEST FLOW
// ═══════════════════════════════════════════════════════════════════════════

async function runBalanceProof(features, labels, tree, leafHashes, root, c0, c1) {
    printHeader('COMPONENT A: BALANCE PROOF');
    
    // Use production version with N=128, DEPTH=7, MODEL_DIM=16
    const circuitName = 'balance_unified_prod';
    const circuitDir = CONFIG.BALANCE_DIR;
    
    // Generate input
    const inputPath = generateBalanceInput(features, labels, tree, leafHashes, root, c0, c1);
    
    // Check if circuit is compiled
    printStep('4b', 'Checking Circuit Setup');
    const missing = checkCircuitFiles(circuitDir, circuitName);
    
    if (missing.length > 0) {
        printInfo(`Missing files: ${missing.join(', ')}`);
        printInfo('Compiling and setting up circuit...');
        
        if (!await compileCircuit(circuitDir, circuitName, `${circuitName}.circom`)) {
            return { success: false };
        }
        
        if (!await setupCircuit(circuitDir, circuitName)) {
            return { success: false };
        }
    } else {
        printSuccess('Circuit already compiled and set up');
    }
    
    // Generate witness
    const witnessFile = path.join(circuitDir, 'witness_integration.wtns');
    if (!await generateWitness(circuitDir, circuitName, inputPath, witnessFile)) {
        return { success: false };
    }
    
    // Generate proof
    const proofFile = path.join(circuitDir, 'proof_integration.json');
    const publicFile = path.join(circuitDir, 'public_integration.json');
    if (!await generateProof(circuitDir, circuitName, witnessFile, proofFile, publicFile)) {
        return { success: false };
    }
    
    // Verify proof
    if (!await verifyProof(circuitDir, proofFile, publicFile)) {
        return { success: false };
    }
    
    // Read public outputs
    const publicOutputs = JSON.parse(fs.readFileSync(publicFile, 'utf8'));
    
    return {
        success: true,
        publicOutputs,
        proofFile,
        publicFile
    };
}

async function runTrainingProof(features, labels, tree, leafHashes, root, gradPos, gradNeg, root_G) {
    printHeader('COMPONENT B: TRAINING PROOF');
    
    const circuitName = 'sgd_step_v5';
    const circuitDir = CONFIG.TRAINING_DIR;
    
    // Generate input
    const inputPath = generateTrainingInput(features, labels, tree, leafHashes, root, gradPos, gradNeg, root_G);
    
    // Check if circuit is compiled
    printStep('5b', 'Checking Circuit Setup');
    const missing = checkCircuitFiles(circuitDir, circuitName);
    
    if (missing.length > 0) {
        printInfo(`Missing files: ${missing.join(', ')}`);
        printInfo('Compiling and setting up circuit...');
        
        if (!await compileCircuit(circuitDir, circuitName, `${circuitName}.circom`)) {
            return { success: false };
        }
        
        if (!await setupCircuit(circuitDir, circuitName)) {
            return { success: false };
        }
    } else {
        printSuccess('Circuit already compiled and set up');
    }
    
    // Generate witness
    const witnessFile = path.join(circuitDir, 'witness_integration.wtns');
    if (!await generateWitness(circuitDir, circuitName, inputPath, witnessFile)) {
        return { success: false };
    }
    
    // Generate proof
    const proofFile = path.join(circuitDir, 'proof_integration.json');
    const publicFile = path.join(circuitDir, 'public_integration.json');
    if (!await generateProof(circuitDir, circuitName, witnessFile, proofFile, publicFile)) {
        return { success: false };
    }
    
    // Verify proof
    if (!await verifyProof(circuitDir, proofFile, publicFile)) {
        return { success: false };
    }
    
    // Read public outputs
    const publicOutputs = JSON.parse(fs.readFileSync(publicFile, 'utf8'));
    
    return {
        success: true,
        publicOutputs,
        proofFile,
        publicFile
    };
}

async function verifyBinding(balanceResult, trainingResult, expectedRoot) {
    printHeader('VERIFYING COMPONENT BINDING');
    
    // Extract root_D from both proofs
    // Balance: public[1] is root
    // Training: public[1] is root_D
    
    const balanceRoot = balanceResult.publicOutputs[1];
    const trainingRoot = trainingResult.publicOutputs[1];
    
    printInfo(`Balance root_D:  ${balanceRoot.slice(0, 40)}...`);
    printInfo(`Training root_D: ${trainingRoot.slice(0, 40)}...`);
    printInfo(`Expected root_D: ${expectedRoot.toString().slice(0, 40)}...`);
    
    const rootsMatch = balanceRoot === trainingRoot;
    const matchesExpected = balanceRoot === expectedRoot.toString();
    
    if (rootsMatch && matchesExpected) {
        printSuccess('✓ root_D MATCHES between Component A and B');
        printSuccess('✓ Both proofs are cryptographically bound to the same dataset');
        return true;
    } else {
        printError('root_D MISMATCH! Components are not properly bound.');
        return false;
    }
}

async function main() {
    console.log('\n');
    printHeader('ZK-FL INTEGRATION TEST: Balance + Training');
    console.log('\n  Testing cryptographic binding between Component A and Component B');
    console.log('  This ensures a client cannot prove balance on one dataset');
    console.log('  while training on another.\n');
    
    const startTime = Date.now();
    
    try {
        // Initialize Poseidon
        await initPoseidon();
        printSuccess('Poseidon hash initialized');
        
        // Generate dataset
        const { features, labels, c0, c1 } = generateDataset();
        
        // Build Merkle tree
        const { tree, leafHashes, root } = buildDatasetTree(features, labels);
        
        // Generate gradient
        const { gradient, gradPos, gradNeg, normSquared, root_G } = generateGradient();
        
        // Run Component A (Balance)
        const balanceResult = await runBalanceProof(features, labels, tree, leafHashes, root, c0, c1);
        if (!balanceResult.success) {
            printError('Component A (Balance) proof failed!');
            process.exit(1);
        }
        
        // Run Component B (Training)
        const trainingResult = await runTrainingProof(features, labels, tree, leafHashes, root, gradPos, gradNeg, root_G);
        if (!trainingResult.success) {
            printError('Component B (Training) proof failed!');
            process.exit(1);
        }
        
        // Verify binding
        const bindingValid = await verifyBinding(balanceResult, trainingResult, root);
        if (!bindingValid) {
            printError('Component binding verification failed!');
            process.exit(1);
        }
        
        // Final summary
        const duration = ((Date.now() - startTime) / 1000).toFixed(2);
        
        printHeader('TEST RESULTS: ALL PASSED ✓');
        console.log(`
  ┌─────────────────────────────────────────────────────────────────┐
  │                    INTEGRATION TEST SUMMARY                     │
  ├─────────────────────────────────────────────────────────────────┤
  │                                                                 │
  │  Component A (Balance):                                         │
  │    ✓ Proof generated and verified                              │
  │    ✓ Class counts: c0=${c0}, c1=${c1}                              │
  │                                                                 │
  │  Component B (Training):                                        │
  │    ✓ Proof generated and verified                              │
  │    ✓ Batch size: ${CONFIG.BATCH_SIZE} samples                               │
  │    ✓ Gradient clipping: ||g||² = ${normSquared} ≤ τ² = ${CONFIG.TAU_SQUARED}       │
  │                                                                 │
  │  Cryptographic Binding:                                         │
  │    ✓ root_D matches between components                         │
  │    ✓ Cannot swap datasets without detection                    │
  │                                                                 │
  │  Execution Time: ${duration} seconds                               │
  │                                                                 │
  └─────────────────────────────────────────────────────────────────┘
`);
        
        console.log('  🎉 SUBMISSION READY: All integration tests passed!\n');
        
    } catch (error) {
        printError(`Test failed with error: ${error.message}`);
        console.error(error);
        process.exit(1);
    }
}

// Run the test
main().catch(console.error);
