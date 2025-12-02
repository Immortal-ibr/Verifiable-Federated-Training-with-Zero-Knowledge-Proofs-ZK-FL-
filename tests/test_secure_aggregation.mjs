#!/usr/bin/env node
/**
 * ═══════════════════════════════════════════════════════════════════════════
 * Test for Secure Masked Update (Component C: Secure Aggregation)
 * ═══════════════════════════════════════════════════════════════════════════
 * 
 * This test verifies the SecureMaskedUpdate circuit which proves:
 *   1. Gradient commitment matches root_G (binds to training proof)
 *   2. Key material commitment matches root_K
 *   3. Gradient norm is bounded (prevents aggregation attacks)
 *   4. Masked update is correctly computed: m_i = g_i + Σ σ_ij * r_ij
 *   5. Masks are correctly derived from shared keys
 * 
 * The pairwise masks cancel upon aggregation:
 *   Σ_i m_i = Σ_i g_i (server learns only aggregate)
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
// CONFIGURATION
// ═══════════════════════════════════════════════════════════════════════════

const CONFIG = {
    DIM: 4,                 // Gradient dimension (must match circuit)
    NUM_PEERS: 2,           // Number of peers (for 3 total clients)
    NUM_CLIENTS: 3,         // Total clients in federation
    TAU_SQUARED: 100000000, // Gradient norm bound
    ROUND: 1,               // FL round number
    
    CHUNK_SIZE: 16,
    FIELD_PRIME: 21888242871839275222246405745257275088548364400416034343698204186575808495617n,
    
    SECUREAGG_DIR: path.join(__dirname, '..', 'artifacts', 'secureagg'),
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
// CRYPTOGRAPHIC PRIMITIVES (matching circuit logic)
// ═══════════════════════════════════════════════════════════════════════════

let poseidon, F;

async function initCrypto() {
    poseidon = await buildPoseidon();
    F = poseidon.F;
}

function poseidonHash(inputs) {
    return F.toObject(poseidon(inputs.map(x => BigInt(x))));
}

function vectorHash(values) {
    if (values.length <= CONFIG.CHUNK_SIZE) {
        return poseidonHash(values);
    } else {
        const numChunks = Math.ceil(values.length / CONFIG.CHUNK_SIZE);
        const chunkHashes = [];
        for (let c = 0; c < numChunks; c++) {
            const startIdx = c * CONFIG.CHUNK_SIZE;
            const endIdx = Math.min(startIdx + CONFIG.CHUNK_SIZE, values.length);
            const chunk = values.slice(startIdx, endIdx);
            chunkHashes.push(poseidonHash(chunk));
        }
        return poseidonHash(chunkHashes);
    }
}

// GradientCommitment: matches GradientCommitment template in vector_hash.circom
function gradientCommitment(gradient, clientId, round) {
    const gradHash = vectorHash(gradient);
    const metaHash = poseidonHash([clientId, round]);
    return poseidonHash([gradHash, metaHash]);
}

// KeyMaterialCommitment: matches KeyMaterialCommitment template
function keyMaterialCommitment(masterKey, sharedKeys) {
    const allKeys = [masterKey, ...sharedKeys];
    return poseidonHash(allKeys);
}

// PairwiseMaskDerivation: matches PairwiseMaskDerivation template
// IMPORTANT: Use canonical ordering (min, max) so r_ij = r_ji
function derivePairwiseMask(sharedKey, round, clientId, peerId, dim) {
    const mask = [];
    // Use canonical ordering: always (smaller_id, larger_id)
    const minId = clientId < peerId ? clientId : peerId;
    const maxId = clientId < peerId ? peerId : clientId;
    for (let k = 0; k < dim; k++) {
        // PRF: Poseidon(shared_key, round, min_id, max_id, k)
        mask.push(poseidonHash([sharedKey, round, minId, maxId, BigInt(k)]));
    }
    return mask;
}

// ═══════════════════════════════════════════════════════════════════════════
// SECURE AGGREGATION SIMULATION
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Simulates the secure aggregation protocol for all clients.
 * Returns the data needed to generate a proof for one client.
 */
function simulateSecureAggregation() {
    printSection('SIMULATING SECURE AGGREGATION');
    
    // Generate random gradients for each client
    const gradients = [];
    for (let i = 0; i < CONFIG.NUM_CLIENTS; i++) {
        const grad = [];
        for (let k = 0; k < CONFIG.DIM; k++) {
            // Small gradients to stay within norm bound
            grad.push(BigInt(Math.floor(Math.random() * 100) - 50));
        }
        gradients.push(grad);
    }
    printInfo(`Generated gradients for ${CONFIG.NUM_CLIENTS} clients`);
    
    // Generate master keys for each client
    const masterKeys = [];
    for (let i = 0; i < CONFIG.NUM_CLIENTS; i++) {
        masterKeys.push(BigInt(1000 + i * 111));  // Deterministic for testing
    }
    
    // Generate shared keys between pairs (K_ij = K_ji for simplicity)
    // In production, use Diffie-Hellman key exchange
    const sharedKeys = {};  // sharedKeys[i][j] = shared key between i and j
    for (let i = 0; i < CONFIG.NUM_CLIENTS; i++) {
        sharedKeys[i] = {};
        for (let j = 0; j < CONFIG.NUM_CLIENTS; j++) {
            if (i !== j) {
                // Symmetric shared key: hash of both master keys (smaller index first)
                const minId = Math.min(i, j);
                const maxId = Math.max(i, j);
                sharedKeys[i][j] = poseidonHash([masterKeys[minId], masterKeys[maxId]]);
            }
        }
    }
    printInfo('Generated pairwise shared keys');
    
    // Compute masked updates for each client
    const maskedUpdates = [];
    for (let i = 0; i < CONFIG.NUM_CLIENTS; i++) {
        // Start with gradient
        const masked = [...gradients[i]];
        
        // Add signed masks from each peer
        for (let j = 0; j < CONFIG.NUM_CLIENTS; j++) {
            if (i !== j) {
                // Derive mask
                const mask = derivePairwiseMask(
                    sharedKeys[i][j],
                    BigInt(CONFIG.ROUND),
                    BigInt(i + 1),  // 1-indexed client IDs
                    BigInt(j + 1),
                    CONFIG.DIM
                );
                
                // Determine sign: +1 if i < j, -1 if i > j
                const sign = i < j ? 1n : -1n;
                
                // Apply signed mask
                for (let k = 0; k < CONFIG.DIM; k++) {
                    if (sign === 1n) {
                        masked[k] = (masked[k] + mask[k]) % CONFIG.FIELD_PRIME;
                    } else {
                        masked[k] = (masked[k] - mask[k] + CONFIG.FIELD_PRIME) % CONFIG.FIELD_PRIME;
                    }
                }
            }
        }
        
        maskedUpdates.push(masked);
    }
    printInfo('Computed masked updates for all clients');
    
    // Verify mask cancellation: sum of masked updates should equal sum of gradients
    const sumMasked = new Array(CONFIG.DIM).fill(0n);
    const sumGradients = new Array(CONFIG.DIM).fill(0n);
    
    for (let i = 0; i < CONFIG.NUM_CLIENTS; i++) {
        for (let k = 0; k < CONFIG.DIM; k++) {
            sumMasked[k] = (sumMasked[k] + maskedUpdates[i][k]) % CONFIG.FIELD_PRIME;
            sumGradients[k] = (sumGradients[k] + gradients[i][k] + CONFIG.FIELD_PRIME) % CONFIG.FIELD_PRIME;
        }
    }
    
    let cancellationValid = true;
    for (let k = 0; k < CONFIG.DIM; k++) {
        if (sumMasked[k] !== sumGradients[k]) {
            cancellationValid = false;
            break;
        }
    }
    
    if (cancellationValid) {
        printSuccess('Mask cancellation verified: Σ masked = Σ gradients');
    } else {
        printError('Mask cancellation FAILED!');
    }
    
    return {
        gradients,
        masterKeys,
        sharedKeys,
        maskedUpdates
    };
}

// ═══════════════════════════════════════════════════════════════════════════
// TEST DATA GENERATION (for one client)
// ═══════════════════════════════════════════════════════════════════════════

function generateTestInput(simData, testClientId = 1) {
    printSection(`GENERATING INPUT FOR CLIENT ${testClientId}`);
    
    const clientIdx = testClientId - 1;  // 0-indexed
    const gradient = simData.gradients[clientIdx];
    const masterKey = simData.masterKeys[clientIdx];
    const maskedUpdate = simData.maskedUpdates[clientIdx];
    
    // Get peer IDs and shared keys (excluding self)
    const peerIds = [];
    const sharedKeysArray = [];
    for (let j = 0; j < CONFIG.NUM_CLIENTS; j++) {
        if (j !== clientIdx) {
            peerIds.push(BigInt(j + 1));  // 1-indexed
            sharedKeysArray.push(simData.sharedKeys[clientIdx][j]);
        }
    }
    
    // Compute commitments
    const root_G = gradientCommitment(gradient, BigInt(testClientId), BigInt(CONFIG.ROUND));
    const root_K = keyMaterialCommitment(masterKey, sharedKeysArray);
    
    // Dummy root_D and root_W (in real usage, these come from previous proofs)
    const root_D = poseidonHash([BigInt(12345)]);  // Placeholder
    const root_W = poseidonHash([BigInt(67890)]);  // Placeholder
    
    printInfo(`Gradient: [${gradient.slice(0, 3).join(', ')}, ...]`);
    printInfo(`root_G = ${root_G.toString().slice(0, 20)}...`);
    printInfo(`root_K = ${root_K.toString().slice(0, 20)}...`);
    
    // Check gradient norm
    let normSquared = 0n;
    for (let k = 0; k < CONFIG.DIM; k++) {
        normSquared += gradient[k] * gradient[k];
    }
    printInfo(`Gradient norm² = ${normSquared} (limit: ${CONFIG.TAU_SQUARED})`);
    
    return {
        // Public inputs
        client_id: testClientId.toString(),
        round: CONFIG.ROUND.toString(),
        root_D: root_D.toString(),
        root_G: root_G.toString(),
        root_W: root_W.toString(),
        root_K: root_K.toString(),
        tauSquared: CONFIG.TAU_SQUARED.toString(),
        masked_update: maskedUpdate.map(x => x.toString()),
        peer_ids: peerIds.map(x => x.toString()),
        
        // Private inputs
        gradient: gradient.map(x => x.toString()),
        master_key: masterKey.toString(),
        shared_keys: sharedKeysArray.map(x => x.toString())
    };
}

// ═══════════════════════════════════════════════════════════════════════════
// CIRCUIT COMPILATION AND TESTING
// ═══════════════════════════════════════════════════════════════════════════

async function compileCircuit() {
    printSection('COMPILING CIRCUIT');
    
    const circuitName = 'secure_masked_update';
    const circuitDir = CONFIG.SECUREAGG_DIR;
    const r1csPath = path.join(circuitDir, `${circuitName}.r1cs`);
    const wasmDir = path.join(circuitDir, `${circuitName}_js`);
    
    // Check if already compiled
    if (fs.existsSync(r1csPath) && fs.existsSync(wasmDir)) {
        printInfo('Circuit already compiled, skipping...');
        return true;
    }
    
    printInfo('Compiling secure_masked_update.circom...');
    
    const result = runCommand(
        `circom secure_masked_update.circom --r1cs --wasm --sym -o . -l ../../../node_modules`,
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
    
    const circuitName = 'secure_masked_update';
    const circuitDir = CONFIG.SECUREAGG_DIR;
    const zkeyPath = path.join(circuitDir, `${circuitName}_final.zkey`);
    
    if (fs.existsSync(zkeyPath)) {
        printInfo('zkey already exists, skipping...');
        return true;
    }
    
    // Find ptau file
    let ptauFile = null;
    const possiblePtau = ['pot17_final.ptau', 'pot14_final.ptau', 'pot12_final.ptau'];
    const possibleDirs = [CONFIG.PROJECT_ROOT, circuitDir, path.join(circuitDir, 'build')];
    
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
        printError('No ptau file found! Please ensure pot14_final.ptau or pot17_final.ptau exists.');
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
        console.error(result.error);
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
    
    const circuitName = 'secure_masked_update';
    const circuitDir = CONFIG.SECUREAGG_DIR;
    
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
    
    const circuitName = 'secure_masked_update';
    const circuitDir = CONFIG.SECUREAGG_DIR;
    
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
║  SECURE MASKED UPDATE TEST - Component C: Secure Aggregation              ║
╚═══════════════════════════════════════════════════════════════════════════╝

This test verifies the secure aggregation circuit (pairwise masking).
Masks cancel upon aggregation: Σ m_i = Σ g_i (server learns only aggregate)
`);
    
    const startTime = Date.now();
    
    try {
        // Initialize
        await initCrypto();
        printSuccess('Cryptographic primitives initialized');
        
        // Simulate secure aggregation for all clients
        const simData = simulateSecureAggregation();
        
        // Generate input for client 1
        const input = generateTestInput(simData, 1);
        
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
║  Secure Aggregation: ${verified ? '✓ VERIFIED' : '✗ FAILED'}                                        ║
║  Duration: ${duration}s                                                      ║
╚═══════════════════════════════════════════════════════════════════════════╝
`);
        
        if (verified) {
            console.log(color(`
    What was verified:
    1. Gradient commitment matches root_G (binds to training proof)
    2. Key material commitment matches root_K
    3. Gradient norm is bounded (prevents aggregation attacks)
    4. Masked update = gradient + Σ σ_ij * r_ij (correctly computed)
    5. Masks are derived from shared keys via domain-separated PRF
    6. root_D and root_W are included for proof chaining
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
