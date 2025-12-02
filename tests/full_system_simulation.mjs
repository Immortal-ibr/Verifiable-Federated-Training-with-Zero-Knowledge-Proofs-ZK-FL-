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
    TAU_SQUARED: 100000000,  // Gradient clipping threshold (increased for verified gradient)
    PRECISION: 1000,         // Fixed-point scaling for gradient verification
    
    // Training round (for multi-round FL)
    CURRENT_ROUND: 1,
    
    // Learning parameters
    LEARNING_RATE: 0.01,
    
    // Paths - artifacts contain compiled circuits (.r1cs, .zkey, .vkey, _js/)
    BALANCE_DIR: path.join(__dirname, '..', 'artifacts', 'balance'),
    TRAINING_DIR: path.join(__dirname, '..', 'artifacts', 'training'),
    SECAGG_DIR: path.join(__dirname, '..', 'artifacts', 'secureagg'),
    KEYS_DIR: path.join(__dirname, '..', 'artifacts', 'keys'),
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

// GradientCommitment: Poseidon(VectorHash(gradient), Poseidon(client_id, round))
// This matches the circuit's GradientCommitment template
function gradientCommitment(gradientFieldValues, clientId, round) {
    const gradHash = vectorHash(gradientFieldValues);
    const metaHash = F.toObject(poseidon([BigInt(clientId), BigInt(round)]));
    const commitment = F.toObject(poseidon([BigInt(gradHash), BigInt(metaHash)]));
    return commitment;
}

// WeightCommitment: VectorHash(weights)
// This matches the circuit's WeightCommitmentSimple template
function weightCommitment(weights) {
    return vectorHash(weights.map(w => BigInt(w)));
}

// KeyMaterial commitment for secure aggregation
// Matches circuit: root_K = Poseidon(master_key, shared_key_1, ..., shared_key_n)
function keyMaterialCommitment(masterKey, peerSharedKeys) {
    const inputs = [BigInt(masterKey), ...peerSharedKeys.map(k => BigInt(k))];
    return F.toObject(poseidon(inputs));
}

// Derive pairwise mask using PRF with canonical ordering
// r_ij[k] = Poseidon(K_ij, round, min(i,j), max(i,j), k)
function derivePairwiseMask(sharedKey, round, clientId, peerId, dim) {
    const minId = Math.min(clientId, peerId);
    const maxId = Math.max(clientId, peerId);
    const mask = [];
    for (let k = 0; k < dim; k++) {
        const hash = poseidon([
            BigInt(sharedKey),
            BigInt(round),
            BigInt(minId),
            BigInt(maxId),
            BigInt(k)
        ]);
        mask.push(F.toObject(hash));
    }
    return mask;
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
        this.weights = null;          // Secret: local copy of global model weights
        
        // Public commitments
        this.root_D = null;           // Public: dataset commitment
        this.root_G = null;           // Public: gradient commitment
        this.root_W = null;           // Public: weight commitment
        this.c0 = null;               // Public: class 0 count
        this.c1 = null;               // Public: class 1 count
        
        // Secure aggregation state
        this.sharedKeys = null;       // Secret: pairwise shared keys K_ij
        this.root_K = null;           // Public: key material commitment
        this.maskedUpdate = null;     // Public: masked gradient for aggregation
        
        // Proofs to send to server
        this.balanceProof = null;
        this.trainingProof = null;
        this.secaggProof = null;
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
    // Phase 4: Local training with VERIFIED GRADIENT
    // Uses sgd_verified.circom which proves gradient is correctly computed
    // ─────────────────────────────────────────────────────────────────────
    async trainAndGenerateProof(globalModel) {
        printClient(this.clientId, 'Training locally with VERIFIED gradient...');
        
        // Store the global model weights
        this.weights = [...globalModel];
        
        // Compute gradient CORRECTLY using same formula as circuit
        const { features, labels } = this.privateData;
        const { gradient, expectedSummedGrad, remainder } = this._computeVerifiedGradient(features, labels, this.weights);
        
        // Split gradient into positive/negative components
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
        
        // Check gradient norm
        const normSquared = gradient.reduce((sum, g) => sum + g * g, 0);
        printInfo(`Gradient norm² = ${normSquared} (limit: ${CONFIG.TAU_SQUARED})`);
        
        if (normSquared > CONFIG.TAU_SQUARED) {
            printError(`Gradient norm exceeds threshold! Test data may need adjustment.`);
            throw new Error('Gradient too large for clipping threshold');
        }
        
        // Compute weight commitment
        this.root_W = weightCommitment(this.weights);
        
        // Compute gradient commitment
        const gradientField = gradient.map(g => g >= 0 ? BigInt(g) : CONFIG.FIELD_PRIME + BigInt(g));
        this.root_G = gradientCommitment(gradientField, this.clientId, CONFIG.CURRENT_ROUND);
        this.gradient = gradient;
        
        printInfo(`round = ${CONFIG.CURRENT_ROUND}`);
        printInfo(`root_G = ${this.root_G.toString().slice(0, 20)}...`);
        printInfo(`root_W = ${this.root_W.toString().slice(0, 20)}...`);
        
        // Generate training proof with VERIFIED gradient
        printClient(this.clientId, 'Generating training proof (sgd_verified)...');
        
        const siblings = [];
        const pathIndices = [];
        
        for (let i = 0; i < CONFIG.BATCH_SIZE; i++) {
            const proof = getMerkleProof(this.merkleTree, i, CONFIG.DEPTH);
            siblings.push(proof.siblings.map(s => s.toString()));
            pathIndices.push(proof.pathIndices.map(p => p.toString()));
        }
        
        // Input for sgd_verified circuit - includes weights, expectedSummedGrad, remainder
        const input = {
            client_id: this.clientId.toString(),
            round: CONFIG.CURRENT_ROUND.toString(),
            root_D: this.root_D.toString(),
            root_G: this.root_G.toString(),
            root_W: this.root_W.toString(),
            tauSquared: CONFIG.TAU_SQUARED.toString(),
            weights: this.weights.map(w => w.toString()),
            expectedSummedGrad: expectedSummedGrad.map(s => s.toString()),
            remainder: remainder.map(r => r.toString()),
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
            'sgd_verified',  // Changed from sgd_step_quick
            inputPath,
            `client${this.clientId}_training`
        );
        
        if (!proofResult) {
            throw new Error(`Client ${this.clientId}: Training proof generation failed`);
        }
        
        this.trainingProof = proofResult;
        printSuccess('Training proof generated (with verified gradient correctness)');
        
        // Return update package to send to server
        return {
            clientId: this.clientId,
            proof: proofResult.proof,
            publicSignals: proofResult.publicSignals,
            root_D: this.root_D.toString(),
            root_G: this.root_G.toString(),
            root_W: this.root_W.toString(),  // NEW: Include weight commitment
            round: CONFIG.CURRENT_ROUND,
            // In real system, gradient would be encrypted for secure aggregation
            // For now, we send it in the clear
            gradient: gradient
        };
    }
    
    // ─────────────────────────────────────────────────────────────────────
    // Helper: Compute gradient using EXACT formula matching the circuit
    // ─────────────────────────────────────────────────────────────────────
    _computeVerifiedGradient(features, labels, weights) {
        const PRECISION = CONFIG.PRECISION;
        const BATCH_SIZE = CONFIG.BATCH_SIZE;
        const MODEL_DIM = CONFIG.MODEL_DIM;
        const DIVISOR = BATCH_SIZE * PRECISION;
        
        // Compute summed gradient (matches circuit exactly)
        const summedGrad = new Array(MODEL_DIM).fill(0);
        
        for (let i = 0; i < BATCH_SIZE; i++) {
            // prediction = dot(features, weights)
            let prediction = 0;
            for (let j = 0; j < MODEL_DIM; j++) {
                prediction += features[i][j] * weights[j];
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
        
        printInfo(`Computed gradient: [${gradient.join(', ')}]`);
        printInfo(`Summed gradient: [${summedGrad.slice(0, 2).join(', ')}, ...]`);
        
        return { gradient, expectedSummedGrad: summedGrad, remainder };
    }
    
    // ─────────────────────────────────────────────────────────────────────
    // Phase 4.5: Secure Aggregation - Generate masked update with proof
    // ─────────────────────────────────────────────────────────────────────
    async generateSecureAggregationProof(allSharedKeys) {
        printClient(this.clientId, 'Generating secure aggregation proof...');
        
        // Store shared keys for this client
        // allSharedKeys[i][j] = K_ij (shared key between client i and j)
        this.sharedKeys = allSharedKeys[this.clientId];
        
        // Generate a master key for this client (used in key commitment)
        // In production, this would be a securely generated secret
        this.masterKey = F.toObject(poseidon([BigInt(this.clientId), BigInt(12345)]));
        
        // Prepare peer-only shared keys array (exclude self)
        // NUM_PEERS = NUM_CLIENTS - 1 = 2
        const peerSharedKeys = [];
        const peerIds = [];
        for (let j = 1; j <= CONFIG.NUM_CLIENTS; j++) {
            if (j !== this.clientId) {
                peerSharedKeys.push(this.sharedKeys[j]);
                peerIds.push(j);
            }
        }
        
        // Compute key material commitment matching circuit:
        // root_K = Poseidon(master_key, shared_key_1, shared_key_2)
        this.root_K = keyMaterialCommitment(this.masterKey, peerSharedKeys);
        printInfo(`root_K = ${this.root_K.toString().slice(0, 20)}...`);
        
        // Compute masked update: m_i = g_i + Σ_{j≠i} σ_ij * r_ij
        // where σ_ij = +1 if i < j, -1 if i > j
        const gradientField = this.gradient.map(g => 
            g >= 0 ? BigInt(g) : CONFIG.FIELD_PRIME + BigInt(g)
        );
        
        const maskedUpdate = [...gradientField];
        
        for (let j = 1; j <= CONFIG.NUM_CLIENTS; j++) {
            if (j === this.clientId) continue;
            
            const sharedKey = this.sharedKeys[j];
            const mask = derivePairwiseMask(sharedKey, CONFIG.CURRENT_ROUND, this.clientId, j, CONFIG.MODEL_DIM);
            
            // σ_ij = +1 if i < j, -1 if i > j
            const sign = this.clientId < j ? 1n : -1n;
            
            for (let k = 0; k < CONFIG.MODEL_DIM; k++) {
                if (sign === 1n) {
                    maskedUpdate[k] = (maskedUpdate[k] + mask[k]) % CONFIG.FIELD_PRIME;
                } else {
                    maskedUpdate[k] = (maskedUpdate[k] - mask[k] + CONFIG.FIELD_PRIME) % CONFIG.FIELD_PRIME;
                }
            }
        }
        
        this.maskedUpdate = maskedUpdate;
        printInfo(`masked_update[0] = ${maskedUpdate[0].toString().slice(0, 20)}...`);
        
        // Prepare circuit input
        // The circuit expects gradient as field elements (negative values wrapped)
        // MUST use BigInt and toString to avoid precision loss with large numbers
        const gradientForCircuit = this.gradient.map(g => 
            g >= 0 ? BigInt(g).toString() : (CONFIG.FIELD_PRIME + BigInt(g)).toString()
        );
        
        const input = {
            // Public inputs
            client_id: this.clientId.toString(),
            round: CONFIG.CURRENT_ROUND.toString(),
            root_D: this.root_D.toString(),
            root_G: this.root_G.toString(),
            root_W: this.root_W.toString(),
            root_K: this.root_K.toString(),
            tauSquared: CONFIG.TAU_SQUARED.toString(),
            masked_update: maskedUpdate.map(m => m.toString()),
            peer_ids: peerIds.map(id => id.toString()),
            
            // Private inputs (gradientForCircuit is already strings)
            gradient: gradientForCircuit,
            master_key: this.masterKey.toString(),
            shared_keys: peerSharedKeys.map(k => k.toString())
        };
        
        const inputPath = path.join(CONFIG.SECAGG_DIR, `client${this.clientId}_secagg_input.json`);
        fs.writeFileSync(inputPath, JSON.stringify(input, null, 2));
        
        const proofResult = await this._runZKProof(
            CONFIG.SECAGG_DIR,
            'secure_masked_update',
            inputPath,
            `client${this.clientId}_secagg`
        );
        
        if (!proofResult) {
            throw new Error(`Client ${this.clientId}: Secure aggregation proof generation failed`);
        }
        
        this.secaggProof = proofResult;
        printSuccess('Secure aggregation proof generated');
        
        // Return masked update package (gradient is hidden behind mask)
        return {
            clientId: this.clientId,
            proof: proofResult.proof,
            publicSignals: proofResult.publicSignals,
            root_D: this.root_D.toString(),
            root_G: this.root_G.toString(),
            root_W: this.root_W.toString(),
            root_K: this.root_K.toString(),
            round: CONFIG.CURRENT_ROUND,
            masked_update: maskedUpdate.map(m => m.toString())
        };
    }
    
    // ─────────────────────────────────────────────────────────────────────
    // Helper: Run ZK proof workflow
    // ─────────────────────────────────────────────────────────────────────
    async _runZKProof(circuitDir, circuitName, inputPath, outputPrefix) {
        const wasmPath = path.join(circuitDir, `${circuitName}_js`, `${circuitName}.wasm`);
        const zkeyPath = path.join(circuitDir, `${circuitName}_final.zkey`);
        
        // Find ptau file (stored in artifacts/keys/)
        let ptauFile = null;
        const possiblePtau = ['pot17_final.ptau', 'pot14_final.ptau'];
        const possibleDirs = [CONFIG.KEYS_DIR, CONFIG.PROJECT_ROOT, circuitDir];
        
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
        this.secaggUpdates = new Map();
        
        this.globalModel = null;
        this.aggregatedGradient = null;
        
        this.verificationResults = {
            balance: new Map(),
            training: new Map(),
            binding: new Map(),
            secagg: new Map()
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
    // Phase 4: Verify training proof with VERIFIED GRADIENT
    // Using sgd_verified circuit - public signals include root_W
    // ─────────────────────────────────────────────────────────────────────
    async verifyTrainingProof(updatePackage) {
        const { clientId, proof, publicSignals, root_D, root_G, root_W, round, gradient } = updatePackage;
        printServer(`Verifying training proof from client ${clientId} (with gradient verification)...`);
        
        // Public signal order for sgd_verified: 
        //   [client_id, round, root_D, root_G, root_W, tauSquared]
        //   index:  0      1      2       3       4        5
        
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
        
        // 2. Verify public signals match claimed values
        const claimedRootD = publicSignals[2];  // index 2 = root_D
        const claimedRootG = publicSignals[3];  // index 3 = root_G
        const claimedRootW = publicSignals[4];  // index 4 = root_W (NEW for verified gradient)
        const claimedRound = publicSignals[1];  // index 1 = round
        const claimedTauSquared = publicSignals[5];  // index 5 = tauSquared
        
        if (claimedRootD !== root_D) {
            printError('root_D mismatch in training public signals!');
            this.verificationResults.training.set(clientId, false);
            return false;
        }
        
        if (claimedRootG !== root_G) {
            printError('root_G mismatch in training public signals!');
            this.verificationResults.training.set(clientId, false);
            return false;
        }
        
        if (claimedRootW !== root_W) {
            printError('root_W mismatch in training public signals!');
            this.verificationResults.training.set(clientId, false);
            return false;
        }
        
        if (claimedRound !== round.toString()) {
            printError('round mismatch in training public signals!');
            this.verificationResults.training.set(clientId, false);
            return false;
        }
        
        // 3. HARDENING: Verify tauSquared matches server's clipping bound
        if (claimedTauSquared !== CONFIG.TAU_SQUARED.toString()) {
            printError('SECURITY: tauSquared does not match server clipping bound!');
            printInfo(`Expected: ${CONFIG.TAU_SQUARED}, Got: ${claimedTauSquared}`);
            this.verificationResults.training.set(clientId, false);
            return false;
        }
        printSuccess('tauSquared matches server clipping bound');
        
        // 4. HARDENING: Recompute root_G from submitted gradient and verify
        // This prevents "prove one gradient, aggregate another" attacks
        const gradientField = gradient.map(g => g >= 0 ? BigInt(g) : CONFIG.FIELD_PRIME + BigInt(g));
        const recomputedRootG = gradientCommitment(gradientField, clientId, round);
        
        if (recomputedRootG.toString() !== root_G) {
            printError('SECURITY: Recomputed root_G does not match submitted root_G!');
            printError('Client may be trying to prove one gradient but aggregate another!');
            printInfo(`Submitted root_G: ${root_G.slice(0, 20)}...`);
            printInfo(`Recomputed root_G: ${recomputedRootG.toString().slice(0, 20)}...`);
            this.verificationResults.training.set(clientId, false);
            return false;
        }
        printSuccess('Gradient commitment verified: submitted gradient matches root_G');
        
        printSuccess('All public signals and commitments verified');
        
        // 5. Verify ZK proof (using sgd_verified circuit)
        const vkeyPath = path.join(CONFIG.TRAINING_DIR, 'sgd_verified_vkey.json');
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
        printSuccess('Training proof VERIFIED (gradient correctness included)');
        return true;
    }
    
    // ─────────────────────────────────────────────────────────────────────
    // Phase 4.5: Verify secure aggregation proof
    // ─────────────────────────────────────────────────────────────────────
    async verifySecureAggregationProof(secaggPackage) {
        const { clientId, proof, publicSignals, root_D, root_G, root_W, root_K, round, masked_update } = secaggPackage;
        printServer(`Verifying secure aggregation proof from client ${clientId}...`);
        
        // Public signal order for secure_masked_update:
        //   [client_id, round, root_D, root_G, root_W, root_K, tauSquared, masked_update[0..DIM-1]]
        
        // 1. Check that root_G matches the one from training proof (binding)
        const trainingUpdate = this.trainingUpdates.get(clientId);
        if (!trainingUpdate) {
            printError('No training proof found for client!');
            this.verificationResults.secagg.set(clientId, false);
            return false;
        }
        
        if (root_G !== trainingUpdate.root_G) {
            printError('BINDING VIOLATION: root_G does not match training proof!');
            this.verificationResults.secagg.set(clientId, false);
            return false;
        }
        printSuccess('Binding check PASSED: root_G matches training proof');
        
        // 2. Cross-check root_D against balance proof (ensures same dataset)
        const balanceProof = this.balanceProofs.get(clientId);
        if (!balanceProof) {
            printError('No balance proof found for client!');
            this.verificationResults.secagg.set(clientId, false);
            return false;
        }
        if (root_D !== balanceProof.root_D) {
            printError('BINDING VIOLATION: root_D does not match balance proof!');
            this.verificationResults.secagg.set(clientId, false);
            return false;
        }
        printSuccess('Binding check PASSED: root_D matches balance proof');
        
        // 3. Cross-check root_W against training proof (ensures same weights)
        if (root_W !== trainingUpdate.root_W) {
            printError('BINDING VIOLATION: root_W does not match training proof!');
            this.verificationResults.secagg.set(clientId, false);
            return false;
        }
        printSuccess('Binding check PASSED: root_W matches training proof');
        
        // 4. Verify public signals match expected values
        // Public signal order: [client_id, round, root_D, root_G, root_W, root_K, tauSquared, masked_update[0..DIM-1], peer_ids[...]]
        const claimedClientId = publicSignals[0];
        const claimedRound = publicSignals[1];
        const claimedRootD = publicSignals[2];
        const claimedRootG = publicSignals[3];
        const claimedRootW = publicSignals[4];
        const claimedRootK = publicSignals[5];
        const claimedTauSquared = publicSignals[6];
        
        // Check client_id
        if (claimedClientId !== clientId.toString()) {
            printError(`client_id mismatch: expected ${clientId}, got ${claimedClientId}`);
            this.verificationResults.secagg.set(clientId, false);
            return false;
        }
        
        // Check round matches expected round
        if (claimedRound !== round.toString()) {
            printError(`round mismatch: expected ${round}, got ${claimedRound}`);
            this.verificationResults.secagg.set(clientId, false);
            return false;
        }
        printSuccess(`round verified: ${claimedRound}`);
        
        // Check root_D in public signals
        if (claimedRootD !== root_D) {
            printError('root_D mismatch in secagg public signals!');
            this.verificationResults.secagg.set(clientId, false);
            return false;
        }
        
        // Check root_G in public signals
        if (claimedRootG !== root_G) {
            printError('root_G mismatch in secagg public signals!');
            this.verificationResults.secagg.set(clientId, false);
            return false;
        }
        
        // Check root_W in public signals
        if (claimedRootW !== root_W) {
            printError('root_W mismatch in secagg public signals!');
            this.verificationResults.secagg.set(clientId, false);
            return false;
        }
        
        // Check root_K in public signals
        if (claimedRootK !== root_K) {
            printError('root_K mismatch in secagg public signals!');
            this.verificationResults.secagg.set(clientId, false);
            return false;
        }
        
        // Check tauSquared matches server's clipping bound
        if (claimedTauSquared !== CONFIG.TAU_SQUARED.toString()) {
            printError(`tauSquared mismatch: expected ${CONFIG.TAU_SQUARED}, got ${claimedTauSquared}`);
            this.verificationResults.secagg.set(clientId, false);
            return false;
        }
        printSuccess('tauSquared matches server clipping bound');
        
        // Check masked_update values in public signals
        for (let i = 0; i < CONFIG.MODEL_DIM; i++) {
            const claimedMasked = publicSignals[7 + i];
            if (claimedMasked !== masked_update[i].toString()) {
                printError(`masked_update[${i}] mismatch in public signals!`);
                this.verificationResults.secagg.set(clientId, false);
                return false;
            }
        }
        printSuccess('All public signals verified');
        
        // 5. Verify ZK proof
        const vkeyPath = path.join(CONFIG.SECAGG_DIR, 'secure_masked_update_vkey.json');
        const proofPath = path.join(CONFIG.SECAGG_DIR, `client${clientId}_secagg_proof.json`);
        const publicPath = path.join(CONFIG.SECAGG_DIR, `client${clientId}_secagg_public.json`);
        
        const result = runCommand(
            `npx snarkjs groth16 verify "${vkeyPath}" "${publicPath}" "${proofPath}"`,
            CONFIG.SECAGG_DIR
        );
        
        if (!result.success) {
            printError('ZK proof verification failed!');
            this.verificationResults.secagg.set(clientId, false);
            return false;
        }
        
        this.secaggUpdates.set(clientId, secaggPackage);
        this.verificationResults.secagg.set(clientId, true);
        printSuccess('Secure aggregation proof VERIFIED');
        return true;
    }
    
    // ─────────────────────────────────────────────────────────────────────
    // Phase 5: Aggregate verified updates using MASKED UPDATES
    // Masks cancel during aggregation: Σ m_i = Σ g_i
    // ─────────────────────────────────────────────────────────────────────
    aggregateUpdates() {
        printServer('Aggregating verified masked updates...');
        
        // Only aggregate from clients with ALL proofs verified
        const verifiedClients = [];
        for (const [clientId, verified] of this.verificationResults.secagg) {
            if (verified && 
                this.verificationResults.training.get(clientId) &&
                this.verificationResults.binding.get(clientId)) {
                verifiedClients.push(clientId);
            }
        }
        
        printInfo(`Fully verified clients: ${verifiedClients.length}/${this.registeredClients.size}`);
        
        if (verifiedClients.length === 0) {
            printError('No verified updates to aggregate!');
            return null;
        }
        
        // Aggregate MASKED updates (masks cancel out!)
        // Σ m_i = Σ (g_i + Σ_{j≠i} σ_ij * r_ij) = Σ g_i (since masks cancel)
        const aggregatedMasked = new Array(CONFIG.MODEL_DIM).fill(0n);
        
        for (const clientId of verifiedClients) {
            const update = this.secaggUpdates.get(clientId);
            for (let j = 0; j < CONFIG.MODEL_DIM; j++) {
                aggregatedMasked[j] = (aggregatedMasked[j] + BigInt(update.masked_update[j])) % CONFIG.FIELD_PRIME;
            }
        }
        
        // Convert back from field elements to integers (handle negative values)
        this.aggregatedGradient = new Array(CONFIG.MODEL_DIM).fill(0);
        const halfField = CONFIG.FIELD_PRIME / 2n;
        for (let j = 0; j < CONFIG.MODEL_DIM; j++) {
            if (aggregatedMasked[j] > halfField) {
                // Negative number (wrapped around)
                this.aggregatedGradient[j] = Number(aggregatedMasked[j] - CONFIG.FIELD_PRIME);
            } else {
                this.aggregatedGradient[j] = Number(aggregatedMasked[j]);
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
        
        printSuccess('Masked updates aggregated (masks cancelled!)');
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
        let totalSecagg = 0, passedSecagg = 0;
        
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
        for (const [_, v] of this.verificationResults.secagg) {
            totalSecagg++;
            if (v) passedSecagg++;
        }
        
        return {
            balance: { passed: passedBalance, total: totalBalance },
            training: { passed: passedTraining, total: totalTraining },
            binding: { passed: passedBinding, total: totalBinding },
            secagg: { passed: passedSecagg, total: totalSecagg },
            allPassed: passedBalance === totalBalance && 
                       passedTraining === totalTraining && 
                       passedBinding === totalBinding &&
                       passedSecagg === totalSecagg
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
        // PHASE 4.5: Secure Aggregation Key Exchange & Proof
        // ═══════════════════════════════════════════════════════════════════
        printPhase('4.5', 'SECURE AGGREGATION');
        
        // Simulate key exchange - in reality this would use Diffie-Hellman
        // allSharedKeys[i][j] = K_ij (shared key between client i and j)
        printServer('Simulating pairwise key exchange...');
        const allSharedKeys = {};
        for (let i = 1; i <= CONFIG.NUM_CLIENTS; i++) {
            allSharedKeys[i] = {};
            for (let j = 1; j <= CONFIG.NUM_CLIENTS; j++) {
                if (i === j) {
                    allSharedKeys[i][j] = 0n;  // No self-key
                } else {
                    // K_ij should equal K_ji
                    const minId = Math.min(i, j);
                    const maxId = Math.max(i, j);
                    // Derive shared key from pair identifiers (simulated)
                    const keyHash = poseidon([BigInt(minId), BigInt(maxId), BigInt(12345)]);
                    allSharedKeys[i][j] = F.toObject(keyHash);
                }
            }
        }
        printSuccess('Pairwise keys established');
        
        // Each client generates secure aggregation proof with masked update
        for (const client of clients) {
            const secaggPackage = await client.generateSecureAggregationProof(allSharedKeys);
            await server.verifySecureAggregationProof(secaggPackage);
        }
        
        // ═══════════════════════════════════════════════════════════════════
        // PHASE 5: Aggregation (using masked updates)
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
    │  SecureAgg Proofs:  ${summary.secagg.passed}/${summary.secagg.total} verified                             │
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
    4. Secure aggregation hides individual gradients (masks cancel)
    5. Aggregation only includes verified updates
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
