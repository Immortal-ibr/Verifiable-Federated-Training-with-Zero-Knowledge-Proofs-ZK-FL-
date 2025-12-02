#!/usr/bin/env node
/**
 * ═══════════════════════════════════════════════════════════════════════════
 * FULL SYSTEM SIMULATION: Prover/Verifier Interaction
 * ═══════════════════════════════════════════════════════════════════════════
 * 
 * This test simulates the REAL federated learning system locally:
 * 
 *   - Multiple CLIENTS (provers) with private datasets
 *   - One SERVER (verifier) that validates proofs and aggregates
 *   - Actual ZK proof generation and verification
 *   - Proper message passing protocol
 * 
 * Flow:
 *   1. Setup Phase: Server distributes parameters, clients register
 *   2. Commitment Phase: Clients commit to their datasets (root_D)
 *   3. Balance Proof Phase: Clients prove dataset balance
 *   4. Training Phase: Clients train locally and generate proofs
 *   5. Aggregation Phase: Server verifies all proofs and aggregates
 * 
 * Authors: ZK-FL Team
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
    // Number of clients in the federation
    NUM_CLIENTS: 3,
    
    // Dataset parameters (small for testing)
    N: 8,                    // Samples per client
    MODEL_DIM: 4,            // Feature dimensions  
    DEPTH: 3,                // Merkle tree depth (2^3 = 8)
    BATCH_SIZE: 8,           // Training batch size
    TAU_SQUARED: 10000,      // Gradient clipping threshold
    
    // Learning parameters
    LEARNING_RATE: 0.01,
    
    // Paths
    BALANCE_DIR: path.join(__dirname, '..', 'zk', 'circuits', 'balance'),
    TRAINING_DIR: path.join(__dirname, '..', 'zk', 'circuits', 'training'),
    PROJECT_ROOT: path.join(__dirname, '..'),
    
    // Poseidon
    CHUNK_SIZE: 16,
    FIELD_PRIME: 21888242871839275222246405745257275088548364400416034343698204186575808495617n
};

// ═══════════════════════════════════════════════════════════════════════════
// UTILITY FUNCTIONS
// ═══════════════════════════════════════════════════════════════════════════

const COLORS = {
    reset: '\x1b[0m',
    bold: '\x1b[1m',
    green: '\x1b[32m',
    red: '\x1b[31m',
    yellow: '\x1b[33m',
    blue: '\x1b[36m',
    magenta: '\x1b[35m',
    gray: '\x1b[90m'
};

function color(text, c) { return `${COLORS[c] || ''}${text}${COLORS.reset}`; }

function printBanner(text) {
    const line = '═'.repeat(70);
    console.log(`\n${color(line, 'bold')}`);
    console.log(color(`  ${text}`, 'blue'));
    console.log(color(line, 'bold'));
}

function printPhase(num, text) {
    console.log(`\n${color(`━━━ PHASE ${num}: ${text} ━━━`, 'magenta')}`);
}

function printClient(id, text) {
    console.log(`  ${color(`[Client ${id}]`, 'yellow')} ${text}`);
}

function printServer(text) {
    console.log(`  ${color('[Server]', 'green')} ${text}`);
}

function printSuccess(text) { console.log(`    ${color('✓', 'green')} ${text}`); }
function printError(text) { console.log(`    ${color('✗', 'red')} ${text}`); }
function printInfo(text) { console.log(`    ${color('→', 'gray')} ${text}`); }

function runCommand(cmd, cwd) {
    try {
        execSync(cmd, { cwd, stdio: 'pipe' });
        return { success: true };
    } catch (error) {
        return { success: false, error: error.message };
    }
}

// Seeded random for reproducibility
let globalSeed = 12345;
function seededRandom(clientId = 0) {
    globalSeed = (globalSeed * 1103515245 + 12345 + clientId * 7919) & 0x7fffffff;
    return globalSeed / 0x7fffffff;
}

function randomInt(min, max, clientId = 0) {
    return Math.floor(seededRandom(clientId) * (max - min + 1)) + min;
}

// ═══════════════════════════════════════════════════════════════════════════
// CRYPTOGRAPHIC PRIMITIVES (shared between prover and verifier)
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
// CLIENT CLASS (PROVER)
// ═══════════════════════════════════════════════════════════════════════════

class Client {
    constructor(clientId) {
        this.clientId = clientId;
        this.privateData = null;      // Secret: actual dataset
        this.merkleTree = null;       // Secret: full tree structure
        this.gradient = null;         // Secret: computed gradient
        
        // Public commitments
        this.root_D = null;           // Public: dataset commitment
        this.root_G = null;           // Public: gradient commitment
        this.c0 = null;               // Public: class 0 count
        this.c1 = null;               // Public: class 1 count
        
        // Proofs to send to server
        this.balanceProof = null;
        this.trainingProof = null;
    }
    
    // ─────────────────────────────────────────────────────────────────────
    // Phase 1: Generate private dataset
    // ─────────────────────────────────────────────────────────────────────
    generatePrivateDataset() {
        printClient(this.clientId, 'Generating private dataset...');
        
        const features = [];
        const labels = [];
        let c0 = 0, c1 = 0;
        
        // Each client has slightly different data distribution
        const bias = this.clientId * 0.1;
        
        for (let i = 0; i < CONFIG.N; i++) {
            const row = [];
            for (let j = 0; j < CONFIG.MODEL_DIM; j++) {
                row.push(randomInt(0, 100, this.clientId * 1000 + i * 10 + j));
            }
            features.push(row);
            
            // Ensure roughly balanced classes
            const label = (i + this.clientId) % 2;
            labels.push(label);
            if (label === 0) c0++;
            else c1++;
        }
        
        this.privateData = { features, labels };
        this.c0 = c0;
        this.c1 = c1;
        
        printSuccess(`Generated ${CONFIG.N} samples (c0=${c0}, c1=${c1})`);
        return { c0, c1, N: CONFIG.N };
    }
    
    // ─────────────────────────────────────────────────────────────────────
    // Phase 2: Compute dataset commitment
    // ─────────────────────────────────────────────────────────────────────
    computeDatasetCommitment() {
        printClient(this.clientId, 'Computing dataset commitment (root_D)...');
        
        const { features, labels } = this.privateData;
        
        // Compute leaf hashes
        const leafHashes = [];
        for (let i = 0; i < CONFIG.N; i++) {
            const sampleValues = [...features[i], labels[i]];
            const hash = vectorHash(sampleValues);
            leafHashes.push(hash);
        }
        
        // Build Merkle tree
        this.merkleTree = buildMerkleTree(leafHashes, CONFIG.DEPTH);
        this.root_D = this.merkleTree[this.merkleTree.length - 1][0];
        
        printSuccess(`root_D = ${this.root_D.toString().slice(0, 20)}...`);
        
        // Return public commitment (this is what gets sent to server)
        return {
            clientId: this.clientId,
            root_D: this.root_D.toString(),
            c0: this.c0,
            c1: this.c1,
            N: CONFIG.N
        };
    }
    
    // ─────────────────────────────────────────────────────────────────────
    // Phase 3: Generate balance proof
    // ─────────────────────────────────────────────────────────────────────
    async generateBalanceProof() {
        printClient(this.clientId, 'Generating balance proof...');
        
        const { features, labels } = this.privateData;
        
        // Prepare Merkle proofs for all samples
        const siblings = [];
        const pathIndices = [];
        
        for (let i = 0; i < CONFIG.N; i++) {
            const proof = getMerkleProof(this.merkleTree, i, CONFIG.DEPTH);
            siblings.push(proof.siblings.map(s => s.toString()));
            pathIndices.push(proof.pathIndices.map(p => p.toString()));
        }
        
        // Create circuit input
        const input = {
            client_id: this.clientId.toString(),
            root: this.root_D.toString(),
            N_public: CONFIG.N.toString(),
            c0: this.c0.toString(),
            c1: this.c1.toString(),
            features: features.map(row => row.map(x => x.toString())),
            labels: labels.map(l => l.toString()),
            siblings: siblings,
            pathIndices: pathIndices
        };
        
        // Save input and generate proof
        const inputPath = path.join(CONFIG.BALANCE_DIR, `client${this.clientId}_balance_input.json`);
        fs.writeFileSync(inputPath, JSON.stringify(input, null, 2));
        
        const proofResult = await this._runZKProof(
            CONFIG.BALANCE_DIR, 
            'balance_unified', 
            inputPath,
            `client${this.clientId}_balance`
        );
        
        if (!proofResult) {
            throw new Error(`Client ${this.clientId}: Balance proof generation failed`);
        }
        
        this.balanceProof = proofResult;
        printSuccess('Balance proof generated');
        
        // Return proof package to send to server
        return {
            clientId: this.clientId,
            proof: proofResult.proof,
            publicSignals: proofResult.publicSignals,
            root_D: this.root_D.toString(),
            c0: this.c0,
            c1: this.c1
        };
    }
    
    // ─────────────────────────────────────────────────────────────────────
    // Phase 4: Local training and proof generation
    // ─────────────────────────────────────────────────────────────────────
    async trainAndGenerateProof(globalModel) {
        printClient(this.clientId, 'Training locally...');
        
        // Simulate training: compute gradient
        const { features, labels } = this.privateData;
        
        // Simple gradient computation (simulate SGD step)
        const gradient = [];
        const gradPos = [];
        const gradNeg = [];
        
        for (let j = 0; j < CONFIG.MODEL_DIM; j++) {
            // Simulate gradient based on data
            let g = 0;
            for (let i = 0; i < CONFIG.BATCH_SIZE; i++) {
                const error = labels[i] - 0.5; // Simplified loss
                g += error * features[i][j] * 0.01;
            }
            g = Math.round(g);
            
            // Vary by client
            g += randomInt(-30, 30, this.clientId * 100 + j);
            
            gradient.push(g);
            
            if (g >= 0) {
                gradPos.push(g);
                gradNeg.push(0);
            } else {
                gradPos.push(0);
                gradNeg.push(-g);
            }
        }
        
        // Check gradient norm
        const normSquared = gradient.reduce((sum, g) => sum + g * g, 0);
        printInfo(`Gradient norm² = ${normSquared} (limit: ${CONFIG.TAU_SQUARED})`);
        
        if (normSquared > CONFIG.TAU_SQUARED) {
            // Clip gradient
            const scale = Math.sqrt(CONFIG.TAU_SQUARED / normSquared);
            for (let j = 0; j < CONFIG.MODEL_DIM; j++) {
                gradient[j] = Math.round(gradient[j] * scale);
                if (gradient[j] >= 0) {
                    gradPos[j] = gradient[j];
                    gradNeg[j] = 0;
                } else {
                    gradPos[j] = 0;
                    gradNeg[j] = -gradient[j];
                }
            }
            printInfo('Gradient clipped');
        }
        
        // Compute gradient commitment
        const gradientField = gradient.map(g => g >= 0 ? BigInt(g) : CONFIG.FIELD_PRIME + BigInt(g));
        this.root_G = vectorHash(gradientField);
        this.gradient = gradient;
        
        printInfo(`root_G = ${this.root_G.toString().slice(0, 20)}...`);
        
        // Generate training proof
        printClient(this.clientId, 'Generating training proof...');
        
        const siblings = [];
        const pathIndices = [];
        
        for (let i = 0; i < CONFIG.BATCH_SIZE; i++) {
            const proof = getMerkleProof(this.merkleTree, i, CONFIG.DEPTH);
            siblings.push(proof.siblings.map(s => s.toString()));
            pathIndices.push(proof.pathIndices.map(p => p.toString()));
        }
        
        const input = {
            client_id: this.clientId.toString(),
            root_D: this.root_D.toString(),
            root_G: this.root_G.toString(),
            tauSquared: CONFIG.TAU_SQUARED.toString(),
            gradPos: gradPos.map(x => x.toString()),
            gradNeg: gradNeg.map(x => x.toString()),
            features: this.privateData.features.map(row => row.map(x => x.toString())),
            labels: this.privateData.labels.map(l => l.toString()),
            siblings: siblings,
            pathIndices: pathIndices
        };
        
        const inputPath = path.join(CONFIG.TRAINING_DIR, `client${this.clientId}_training_input.json`);
        fs.writeFileSync(inputPath, JSON.stringify(input, null, 2));
        
        const proofResult = await this._runZKProof(
            CONFIG.TRAINING_DIR,
            'sgd_step_quick',
            inputPath,
            `client${this.clientId}_training`
        );
        
        if (!proofResult) {
            throw new Error(`Client ${this.clientId}: Training proof generation failed`);
        }
        
        this.trainingProof = proofResult;
        printSuccess('Training proof generated');
        
        // Return update package to send to server
        return {
            clientId: this.clientId,
            proof: proofResult.proof,
            publicSignals: proofResult.publicSignals,
            root_D: this.root_D.toString(),
            root_G: this.root_G.toString(),
            // In real system, gradient would be encrypted for secure aggregation
            // For now, we send it in the clear
            gradient: gradient
        };
    }
    
    // ─────────────────────────────────────────────────────────────────────
    // Helper: Run ZK proof workflow
    // ─────────────────────────────────────────────────────────────────────
    async _runZKProof(circuitDir, circuitName, inputPath, outputPrefix) {
        const wasmPath = path.join(circuitDir, `${circuitName}_js`, `${circuitName}.wasm`);
        const zkeyPath = path.join(circuitDir, `${circuitName}_final.zkey`);
        
        // Find ptau file
        let ptauFile = null;
        const possiblePtau = ['pot17_final.ptau', 'pot14_final.ptau'];
        const possibleDirs = [CONFIG.PROJECT_ROOT, circuitDir, CONFIG.TRAINING_DIR];
        
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
        
        // Setup circuit if needed
        if (!fs.existsSync(wasmPath) || !fs.existsSync(zkeyPath)) {
            printInfo('Setting up circuit...');
            
            const r1csPath = path.join(circuitDir, `${circuitName}.r1cs`);
            if (!fs.existsSync(r1csPath)) {
                let result = runCommand(
                    `circom ${circuitName}.circom --r1cs --wasm --sym -o .`,
                    circuitDir
                );
                if (!result.success) {
                    printError('Compilation failed');
                    return null;
                }
            }
            
            if (!fs.existsSync(zkeyPath)) {
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
                
                runCommand(
                    `npx snarkjs zkey export verificationkey ${circuitName}_final.zkey ${circuitName}_vkey.json`,
                    circuitDir
                );
                
                try { fs.unlinkSync(path.join(circuitDir, `${circuitName}_0000.zkey`)); } catch(e) {}
            }
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
        const witnessPath = path.join(circuitDir, `${outputPrefix}.wtns`);
        let result = runCommand(
            `node "${cjsPath}" "${wasmPath}" "${inputPath}" "${witnessPath}"`,
            circuitDir
        );
        if (!result.success) {
            printError('Witness generation failed');
            return null;
        }
        
        // Generate proof
        const proofPath = path.join(circuitDir, `${outputPrefix}_proof.json`);
        const publicPath = path.join(circuitDir, `${outputPrefix}_public.json`);
        
        result = runCommand(
            `npx snarkjs groth16 prove ${circuitName}_final.zkey ${witnessPath} ${proofPath} ${publicPath}`,
            circuitDir
        );
        if (!result.success) {
            printError('Proof generation failed');
            return null;
        }
        
        return {
            proof: JSON.parse(fs.readFileSync(proofPath, 'utf8')),
            publicSignals: JSON.parse(fs.readFileSync(publicPath, 'utf8')),
            proofPath,
            publicPath
        };
    }
}

// ═══════════════════════════════════════════════════════════════════════════
// SERVER CLASS (VERIFIER)
// ═══════════════════════════════════════════════════════════════════════════

class Server {
    constructor() {
        this.registeredClients = new Map();
        this.datasetCommitments = new Map();
        this.balanceProofs = new Map();
        this.trainingUpdates = new Map();
        
        this.globalModel = null;
        this.aggregatedGradient = null;
        
        this.verificationResults = {
            balance: new Map(),
            training: new Map(),
            binding: new Map()
        };
    }
    
    // ─────────────────────────────────────────────────────────────────────
    // Phase 0: Initialize global model
    // ─────────────────────────────────────────────────────────────────────
    initializeModel() {
        printServer('Initializing global model...');
        this.globalModel = new Array(CONFIG.MODEL_DIM).fill(0);
        printSuccess(`Model initialized (dim=${CONFIG.MODEL_DIM})`);
        return { modelDim: CONFIG.MODEL_DIM };
    }
    
    // ─────────────────────────────────────────────────────────────────────
    // Phase 1: Register client
    // ─────────────────────────────────────────────────────────────────────
    registerClient(clientId, metadata) {
        printServer(`Registering client ${clientId}...`);
        this.registeredClients.set(clientId, {
            ...metadata,
            registeredAt: Date.now()
        });
        printSuccess(`Client ${clientId} registered (N=${metadata.N}, c0=${metadata.c0}, c1=${metadata.c1})`);
    }
    
    // ─────────────────────────────────────────────────────────────────────
    // Phase 2: Receive and store dataset commitment
    // ─────────────────────────────────────────────────────────────────────
    receiveDatasetCommitment(commitment) {
        printServer(`Received commitment from client ${commitment.clientId}`);
        this.datasetCommitments.set(commitment.clientId, commitment);
        printSuccess(`Stored root_D = ${commitment.root_D.slice(0, 20)}...`);
    }
    
    // ─────────────────────────────────────────────────────────────────────
    // Phase 3: Verify balance proof
    // ─────────────────────────────────────────────────────────────────────
    async verifyBalanceProof(proofPackage) {
        const { clientId, proof, publicSignals, root_D, c0, c1 } = proofPackage;
        printServer(`Verifying balance proof from client ${clientId}...`);
        
        // 1. Check public signals match claimed values
        const claimedRoot = publicSignals[1]; // root is second public signal
        if (claimedRoot !== root_D) {
            printError('root_D mismatch in public signals!');
            this.verificationResults.balance.set(clientId, false);
            return false;
        }
        
        // 2. Verify ZK proof
        const vkeyPath = path.join(CONFIG.BALANCE_DIR, 'balance_unified_vkey.json');
        const proofPath = path.join(CONFIG.BALANCE_DIR, `client${clientId}_balance_proof.json`);
        const publicPath = path.join(CONFIG.BALANCE_DIR, `client${clientId}_balance_public.json`);
        
        const result = runCommand(
            `npx snarkjs groth16 verify "${vkeyPath}" "${publicPath}" "${proofPath}"`,
            CONFIG.BALANCE_DIR
        );
        
        if (!result.success) {
            printError('ZK proof verification failed!');
            this.verificationResults.balance.set(clientId, false);
            return false;
        }
        
        this.balanceProofs.set(clientId, proofPackage);
        this.verificationResults.balance.set(clientId, true);
        printSuccess(`Balance proof VERIFIED (c0=${c0}, c1=${c1})`);
        return true;
    }
    
    // ─────────────────────────────────────────────────────────────────────
    // Phase 4: Verify training proof and check binding
    // ─────────────────────────────────────────────────────────────────────
    async verifyTrainingProof(updatePackage) {
        const { clientId, proof, publicSignals, root_D, root_G, gradient } = updatePackage;
        printServer(`Verifying training proof from client ${clientId}...`);
        
        // 1. CRITICAL: Check that root_D matches the one from balance proof
        const balanceProof = this.balanceProofs.get(clientId);
        if (!balanceProof) {
            printError('No balance proof found for client!');
            this.verificationResults.training.set(clientId, false);
            return false;
        }
        
        if (root_D !== balanceProof.root_D) {
            printError('BINDING VIOLATION: root_D does not match balance proof!');
            printInfo(`Balance root_D: ${balanceProof.root_D.slice(0, 20)}...`);
            printInfo(`Training root_D: ${root_D.slice(0, 20)}...`);
            this.verificationResults.binding.set(clientId, false);
            return false;
        }
        
        this.verificationResults.binding.set(clientId, true);
        printSuccess('Binding check PASSED: root_D matches balance proof');
        
        // 2. Verify root_D in public signals
        const claimedRootD = publicSignals[1];
        if (claimedRootD !== root_D) {
            printError('root_D mismatch in training public signals!');
            this.verificationResults.training.set(clientId, false);
            return false;
        }
        
        // 3. Verify ZK proof
        const vkeyPath = path.join(CONFIG.TRAINING_DIR, 'sgd_step_quick_vkey.json');
        const proofPath = path.join(CONFIG.TRAINING_DIR, `client${clientId}_training_proof.json`);
        const publicPath = path.join(CONFIG.TRAINING_DIR, `client${clientId}_training_public.json`);
        
        const result = runCommand(
            `npx snarkjs groth16 verify "${vkeyPath}" "${publicPath}" "${proofPath}"`,
            CONFIG.TRAINING_DIR
        );
        
        if (!result.success) {
            printError('ZK proof verification failed!');
            this.verificationResults.training.set(clientId, false);
            return false;
        }
        
        this.trainingUpdates.set(clientId, updatePackage);
        this.verificationResults.training.set(clientId, true);
        printSuccess('Training proof VERIFIED');
        return true;
    }
    
    // ─────────────────────────────────────────────────────────────────────
    // Phase 5: Aggregate verified updates
    // ─────────────────────────────────────────────────────────────────────
    aggregateUpdates() {
        printServer('Aggregating verified updates...');
        
        // Only aggregate from clients with verified proofs
        const verifiedClients = [];
        for (const [clientId, verified] of this.verificationResults.training) {
            if (verified && this.verificationResults.binding.get(clientId)) {
                verifiedClients.push(clientId);
            }
        }
        
        printInfo(`Verified clients: ${verifiedClients.length}/${this.registeredClients.size}`);
        
        if (verifiedClients.length === 0) {
            printError('No verified updates to aggregate!');
            return null;
        }
        
        // Aggregate gradients (simple average)
        this.aggregatedGradient = new Array(CONFIG.MODEL_DIM).fill(0);
        
        for (const clientId of verifiedClients) {
            const update = this.trainingUpdates.get(clientId);
            for (let j = 0; j < CONFIG.MODEL_DIM; j++) {
                this.aggregatedGradient[j] += update.gradient[j];
            }
        }
        
        // Average
        for (let j = 0; j < CONFIG.MODEL_DIM; j++) {
            this.aggregatedGradient[j] /= verifiedClients.length;
        }
        
        // Update global model
        for (let j = 0; j < CONFIG.MODEL_DIM; j++) {
            this.globalModel[j] -= CONFIG.LEARNING_RATE * this.aggregatedGradient[j];
        }
        
        printSuccess('Updates aggregated');
        printInfo(`Aggregated gradient: [${this.aggregatedGradient.slice(0, 3).map(x => x.toFixed(2)).join(', ')}, ...]`);
        printInfo(`Updated model: [${this.globalModel.slice(0, 3).map(x => x.toFixed(4)).join(', ')}, ...]`);
        
        return {
            aggregatedGradient: this.aggregatedGradient,
            newModel: this.globalModel,
            numClients: verifiedClients.length
        };
    }
    
    // ─────────────────────────────────────────────────────────────────────
    // Get final summary
    // ─────────────────────────────────────────────────────────────────────
    getSummary() {
        let totalBalance = 0, passedBalance = 0;
        let totalTraining = 0, passedTraining = 0;
        let totalBinding = 0, passedBinding = 0;
        
        for (const [_, v] of this.verificationResults.balance) {
            totalBalance++;
            if (v) passedBalance++;
        }
        for (const [_, v] of this.verificationResults.training) {
            totalTraining++;
            if (v) passedTraining++;
        }
        for (const [_, v] of this.verificationResults.binding) {
            totalBinding++;
            if (v) passedBinding++;
        }
        
        return {
            balance: { passed: passedBalance, total: totalBalance },
            training: { passed: passedTraining, total: totalTraining },
            binding: { passed: passedBinding, total: totalBinding },
            allPassed: passedBalance === totalBalance && 
                       passedTraining === totalTraining && 
                       passedBinding === totalBinding
        };
    }
}

// ═══════════════════════════════════════════════════════════════════════════
// MAIN SIMULATION
// ═══════════════════════════════════════════════════════════════════════════

async function runSimulation() {
    printBanner('ZK-FL FULL SYSTEM SIMULATION');
    console.log(`
    Simulating a federated learning round with:
    • ${CONFIG.NUM_CLIENTS} clients (provers)
    • 1 server (verifier)
    • Actual ZK proof generation and verification
    `);
    
    const startTime = Date.now();
    
    try {
        // Initialize cryptographic primitives
        await initCrypto();
        printSuccess('Cryptographic primitives initialized\n');
        
        // Create entities
        const server = new Server();
        const clients = [];
        for (let i = 1; i <= CONFIG.NUM_CLIENTS; i++) {
            clients.push(new Client(i));
        }
        
        // ═══════════════════════════════════════════════════════════════════
        // PHASE 0: Server Setup
        // ═══════════════════════════════════════════════════════════════════
        printPhase(0, 'SERVER SETUP');
        const modelParams = server.initializeModel();
        
        // ═══════════════════════════════════════════════════════════════════
        // PHASE 1: Client Registration & Data Generation
        // ═══════════════════════════════════════════════════════════════════
        printPhase(1, 'CLIENT REGISTRATION');
        
        for (const client of clients) {
            const metadata = client.generatePrivateDataset();
            server.registerClient(client.clientId, metadata);
        }
        
        // ═══════════════════════════════════════════════════════════════════
        // PHASE 2: Dataset Commitment
        // ═══════════════════════════════════════════════════════════════════
        printPhase(2, 'DATASET COMMITMENT');
        
        for (const client of clients) {
            const commitment = client.computeDatasetCommitment();
            server.receiveDatasetCommitment(commitment);
        }
        
        // ═══════════════════════════════════════════════════════════════════
        // PHASE 3: Balance Proof Generation & Verification
        // ═══════════════════════════════════════════════════════════════════
        printPhase(3, 'BALANCE PROOF');
        
        for (const client of clients) {
            const proofPackage = await client.generateBalanceProof();
            await server.verifyBalanceProof(proofPackage);
        }
        
        // ═══════════════════════════════════════════════════════════════════
        // PHASE 4: Training & Proof Generation
        // ═══════════════════════════════════════════════════════════════════
        printPhase(4, 'TRAINING & VERIFICATION');
        
        for (const client of clients) {
            const updatePackage = await client.trainAndGenerateProof(server.globalModel);
            await server.verifyTrainingProof(updatePackage);
        }
        
        // ═══════════════════════════════════════════════════════════════════
        // PHASE 5: Aggregation
        // ═══════════════════════════════════════════════════════════════════
        printPhase(5, 'AGGREGATION');
        
        const aggregationResult = server.aggregateUpdates();
        
        // ═══════════════════════════════════════════════════════════════════
        // SUMMARY
        // ═══════════════════════════════════════════════════════════════════
        const summary = server.getSummary();
        const duration = ((Date.now() - startTime) / 1000).toFixed(2);
        
        printBanner('SIMULATION COMPLETE');
        
        console.log(`
    ┌─────────────────────────────────────────────────────────────┐
    │                    VERIFICATION SUMMARY                      │
    ├─────────────────────────────────────────────────────────────┤
    │  Balance Proofs:    ${summary.balance.passed}/${summary.balance.total} verified                             │
    │  Training Proofs:   ${summary.training.passed}/${summary.training.total} verified                             │
    │  Binding Checks:    ${summary.binding.passed}/${summary.binding.total} passed                               │
    ├─────────────────────────────────────────────────────────────┤
    │  Clients Aggregated: ${aggregationResult ? aggregationResult.numClients : 0}/${CONFIG.NUM_CLIENTS}                                │
    │  Duration:           ${duration}s                                 │
    └─────────────────────────────────────────────────────────────┘
        `);
        
        if (summary.allPassed) {
            console.log(color('    ✓ ALL VERIFICATIONS PASSED - SYSTEM WORKING CORRECTLY', 'green'));
            console.log(color(`
    The simulation proves:
    1. Clients can generate valid ZK proofs for their private data
    2. Server can verify proofs without seeing private data
    3. Cryptographic binding ensures balance ↔ training consistency
    4. Aggregation only includes verified updates
            `, 'gray'));
            return true;
        } else {
            console.log(color('    ✗ SOME VERIFICATIONS FAILED', 'red'));
            return false;
        }
        
    } catch (error) {
        printError(`Simulation failed: ${error.message}`);
        console.error(error);
        return false;
    }
}

// Run simulation
runSimulation().then(success => {
    process.exit(success ? 0 : 1);
}).catch(err => {
    console.error(err);
    process.exit(1);
});
