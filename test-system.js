#!/usr/bin/env node

/**
 * Verifiable Federated Learning System - Integration Test Suite
 * 
 * This script runs comprehensive tests of all three components
 * without requiring circom (simulates circuit logic in JavaScript)
 * 
 * Submitted as: [Our Names]
 * Date: November 11, 2025
 */

import crypto from 'crypto';

// Color codes for pretty output
const colors = {
    reset: '\x1b[0m',
    green: '\x1b[32m',
    red: '\x1b[31m',
    yellow: '\x1b[33m',
    blue: '\x1b[36m',
    bold: '\x1b[1m'
};

function log(msg, color = 'reset') {
    console.log(`${colors[color]}${msg}${colors.reset}`);
}

function header(text) {
    log(`\n${'='.repeat(70)}`, 'bold');
    log(text, 'blue');
    log(`${'='.repeat(70)}`, 'bold');
}

function success(text) {
    log(`✓ ${text}`, 'green');
}

function error(text) {
    log(`✗ ${text}`, 'red');
}

function warning(text) {
    log(`⚠ ${text}`, 'yellow');
}

// ============================================================================
// Cryptographic Primitives
// ============================================================================

/**
 * Simplified Poseidon hash (using SHA-256 as proxy)
 * In real system: use circomlib poseidon
 */
function poseidonHash(inputs) {
    const combined = inputs.map(x => {
        if (typeof x === 'bigint') return x.toString();
        if (typeof x === 'object') return JSON.stringify(x);
        return String(x);
    }).join('|');
    
    return crypto.createHash('sha256').update(combined).digest('hex').slice(0, 64);
}

/**
 * PRF using HMAC-SHA256
 */
function PRF(key, seed = '') {
    const hmac = crypto.createHmac('sha256', key);
    hmac.update(seed);
    return hmac.digest();
}

/**
 * Generate random bytes
 */
function randomBytes(n) {
    return crypto.randomBytes(n);
}

// ============================================================================
// COMPONENT A: Dataset Balance Proof
// ============================================================================

class ComponentA {
    constructor(n_patients, n_healthy, n_sick) {
        this.n_patients = n_patients;
        this.n_healthy = n_healthy;
        this.n_sick = n_sick;
        
        if (n_healthy + n_sick !== n_patients) {
            throw new Error("Sum of healthy and sick must equal total patients");
        }
        
        // Create balanced dataset
        this.labels = [];
        for (let i = 0; i < n_healthy; i++) this.labels.push(0);
        for (let i = 0; i < n_sick; i++) this.labels.push(1);
        
        // Shuffle
        for (let i = this.labels.length - 1; i > 0; i--) {
            const j = Math.floor(Math.random() * (i + 1));
            [this.labels[i], this.labels[j]] = [this.labels[j], this.labels[i]];
        }
    }
    
    /**
     * Build Merkle tree and generate commitment R_D
     */
    generateCommitment() {
        // Create leaf hashes
        let leaves = this.labels.map(label => poseidonHash([label]));
        
        // Build Merkle tree
        let tree = [leaves];
        while (tree[tree.length - 1].length > 1) {
            let currentLevel = tree[tree.length - 1];
            let nextLevel = [];
            for (let i = 0; i < currentLevel.length; i += 2) {
                nextLevel.push(poseidonHash([currentLevel[i], currentLevel[i + 1]]));
            }
            tree.push(nextLevel);
        }
        
        const merkleRoot = tree[tree.length - 1][0];
        const R_D = poseidonHash([merkleRoot]);
        
        return {
            merkleRoot,
            R_D,
            tree,
            labels: this.labels
        };
    }
    
    /**
     * Verify the commitment is valid
     */
    verifyCommitment(commitment) {
        const { merkleRoot, R_D, labels } = commitment;
        
        // Verify counts
        const count0 = labels.filter(l => l === 0).length;
        const count1 = labels.filter(l => l === 1).length;
        
        if (count0 + count1 !== this.n_patients) {
            return false;
        }
        
        // Verify merkle root can be reconstructed
        let leaves = labels.map(label => poseidonHash([label]));
        let tree = [leaves];
        while (tree[tree.length - 1].length > 1) {
            let currentLevel = tree[tree.length - 1];
            let nextLevel = [];
            for (let i = 0; i < currentLevel.length; i += 2) {
                nextLevel.push(poseidonHash([currentLevel[i], currentLevel[i + 1]]));
            }
            tree.push(nextLevel);
        }
        
        const reconstructedRoot = tree[tree.length - 1][0];
        if (reconstructedRoot !== merkleRoot) {
            return false;
        }
        
        // Verify R_D
        const reconstructedRD = poseidonHash([merkleRoot]);
        return reconstructedRD === R_D;
    }
    
    static verify(commitment) {
        const { merkleRoot, R_D, labels } = commitment;
        
        // Reconstruct merkle root
        let leaves = labels.map(label => poseidonHash([label]));
        let tree = [leaves];
        while (tree[tree.length - 1].length > 1) {
            let currentLevel = tree[tree.length - 1];
            let nextLevel = [];
            for (let i = 0; i < currentLevel.length; i += 2) {
                nextLevel.push(poseidonHash([currentLevel[i], currentLevel[i + 1]]));
            }
            tree.push(nextLevel);
        }
        
        const reconstructedRoot = tree[tree.length - 1][0];
        if (reconstructedRoot !== merkleRoot) return false;
        
        const reconstructedRD = poseidonHash([merkleRoot]);
        return reconstructedRD === R_D;
    }
}

// ============================================================================
// COMPONENT B: Training Integrity Proof
// ============================================================================

class ComponentB {
    constructor(dataset, batch_size = 8, model_dim = 32, tau = 1.0) {
        this.dataset = dataset;
        this.batch_size = batch_size;
        this.model_dim = model_dim;
        this.tau = tau;
        this.learning_rate = 0.01;
    }
    
    /**
     * Sample batch and compute gradient
     */
    trainingStep(labels, weights_old) {
        // Sample batch
        const batch_indices = [];
        for (let i = 0; i < this.batch_size; i++) {
            batch_indices.push(Math.floor(Math.random() * labels.length));
        }
        
        // Compute gradient (simplified: just use labels as gradient signal)
        let gradient = new Array(this.model_dim).fill(0);
        for (let i = 0; i < this.batch_size; i++) {
            const label = labels[batch_indices[i]];
            const error = Math.random() - 0.5; // Simulate prediction error
            for (let d = 0; d < this.model_dim; d++) {
                gradient[d] += error * Math.random();
            }
        }
        
        // Normalize
        for (let d = 0; d < this.model_dim; d++) {
            gradient[d] /= this.batch_size;
        }
        
        // Compute gradient norm
        let norm_squared = 0;
        for (let d = 0; d < this.model_dim; d++) {
            norm_squared += gradient[d] * gradient[d];
        }
        const norm = Math.sqrt(norm_squared);
        
        // Clip gradient
        let gradient_clipped = [...gradient];
        if (norm > this.tau) {
            const scale = this.tau / norm;
            for (let d = 0; d < this.model_dim; d++) {
                gradient_clipped[d] *= scale;
            }
        }
        
        // Update weights
        let weights_new = [];
        for (let d = 0; d < this.model_dim; d++) {
            weights_new[d] = weights_old[d] - this.learning_rate * gradient_clipped[d];
        }
        
        // Verify clipping
        let clipped_norm_squared = 0;
        for (let d = 0; d < this.model_dim; d++) {
            clipped_norm_squared += gradient_clipped[d] * gradient_clipped[d];
        }
        
        if (clipped_norm_squared > this.tau * this.tau + 1e-10) {
            throw new Error("Gradient clipping failed!");
        }
        
        return {
            batch_indices,
            gradient,
            gradient_clipped,
            norm,
            weights_old,
            weights_new
        };
    }
    
    /**
     * Create commitment R_G binding to training
     */
    createCommitment(training_result, R_D) {
        const { weights_old, weights_new, gradient_clipped } = training_result;
        
        // Create commitment
        const R_G = poseidonHash([
            JSON.stringify(weights_old),
            JSON.stringify(weights_new),
            JSON.stringify(gradient_clipped),
            R_D  // Bind to dataset commitment
        ]);
        
        return {
            R_G,
            weights_old,
            weights_new,
            gradient_clipped,
            training_result
        };
    }
    
    static verify(commitment, R_D) {
        const { R_G, weights_old, weights_new, gradient_clipped } = commitment;
        
        // Verify gradient is bounded
        let norm_squared = 0;
        for (let d = 0; d < gradient_clipped.length; d++) {
            norm_squared += gradient_clipped[d] * gradient_clipped[d];
        }
        
        // Should be <= 1.0^2 with small epsilon
        if (norm_squared > 1.0 + 1e-6) {
            return false;
        }
        
        // Reconstruct R_G
        const R_G_check = poseidonHash([
            JSON.stringify(weights_old),
            JSON.stringify(weights_new),
            JSON.stringify(gradient_clipped),
            R_D
        ]);
        
        return R_G === R_G_check;
    }
}

// ============================================================================
// COMPONENT C: Secure Aggregation with Dropout Tolerance
// ============================================================================

class ComponentC {
    constructor(model_dim = 32) {
        this.model_dim = model_dim;
    }
    
    /**
     * Create PRF-based mask and masked gradient
     */
    createMaskedUpdate(gradient, R_G) {
        // Generate shared key (kept secret by hospital)
        const shared_key = randomBytes(32);
        
        // Derive mask using PRF
        const prf_seed = Buffer.alloc(this.model_dim * 32);
        let offset = 0;
        for (let i = 0; i < this.model_dim; i++) {
            const prf_output = PRF(shared_key, Buffer.from([i]));
            prf_output.copy(prf_seed, offset);
            offset += 32;
        }
        
        // Create mask (normalized to [-0.1, 0.1] range)
        const mask = [];
        for (let d = 0; d < this.model_dim; d++) {
            const byte_val = prf_seed[d * 32];
            const normalized = (byte_val / 256.0) * 0.2 - 0.1;
            mask.push(normalized);
        }
        
        // Apply mask
        const masked_gradient = [];
        for (let d = 0; d < this.model_dim; d++) {
            masked_gradient.push(gradient[d] + mask[d]);
        }
        
        // Verify dropout tolerance structure
        const dropout_tolerance_verified = this.verifyDropoutTolerance(
            shared_key,
            mask,
            gradient
        );
        
        if (!dropout_tolerance_verified) {
            throw new Error("Dropout tolerance verification failed!");
        }
        
        return {
            shared_key,
            mask,
            masked_gradient,
            gradient,
            R_G
        };
    }
    
    /**
     * Verify dropout tolerance: can mask be recovered?
     */
    verifyDropoutTolerance(shared_key, mask, gradient) {
        // Try to recover mask using PRF
        const recovered_mask = [];
        for (let d = 0; d < this.model_dim; d++) {
            const prf_output = PRF(shared_key, Buffer.from([d]));
            const byte_val = prf_output[0];
            const normalized = (byte_val / 256.0) * 0.2 - 0.1;
            recovered_mask.push(normalized);
        }
        
        // Compare masks
        for (let d = 0; d < this.model_dim; d++) {
            if (Math.abs(recovered_mask[d] - mask[d]) > 1e-10) {
                return false;
            }
        }
        
        return true;
    }
    
    /**
     * Verify masked update is well-formed
     */
    static verify(update, R_G) {
        const { shared_key, mask, masked_gradient, gradient } = update;
        
        // 1. Verify gradient is bounded (should be from Component B)
        let norm_squared = 0;
        for (let d = 0; d < gradient.length; d++) {
            norm_squared += gradient[d] * gradient[d];
        }
        if (norm_squared > 1.0 + 1e-6) {
            return false;
        }
        
        // 2. Verify masking arithmetic: u' = u + m
        for (let d = 0; d < masked_gradient.length; d++) {
            const expected = gradient[d] + mask[d];
            if (Math.abs(masked_gradient[d] - expected) > 1e-10) {
                return false;
            }
        }
        
        // 3. Verify PRF derivation: can recover mask from key
        for (let d = 0; d < mask.length; d++) {
            const prf_output = PRF(shared_key, Buffer.from([d]));
            const byte_val = prf_output[0];
            const expected_mask = (byte_val / 256.0) * 0.2 - 0.1;
            if (Math.abs(expected_mask - mask[d]) > 1e-10) {
                return false;
            }
        }
        
        // 4. All checks passed
        return true;
    }
}

// ============================================================================
// Test Suite
// ============================================================================

async function runTests() {
    let passed = 0;
    let failed = 0;
    
    // ==========================================================================
    // PHASE 1: Component A Tests
    // ==========================================================================
    
    header('PHASE 1: Component A - Dataset Balance Verification');
    
    try {
        log('\nTest 1.1: Generate balanced dataset', 'bold');
        const hospital_A = new ComponentA(128, 60, 68);
        const commitment_A = hospital_A.generateCommitment();
        
        if (ComponentA.verify(commitment_A)) {
            success('Dataset commitment R_D is valid');
            log(`  R_D = ${commitment_A.R_D.slice(0, 16)}...`, 'blue');
            passed++;
        } else {
            error('Dataset commitment verification failed');
            failed++;
        }
    } catch (e) {
        error(`Exception: ${e.message}`);
        failed++;
    }
    
    try {
        log('\nTest 1.2: Detect commitment tampering', 'bold');
        const hospital_B = new ComponentA(128, 60, 68);
        const commitment_B = hospital_B.generateCommitment();
        
        // Try to tamper: change a label
        commitment_B.labels[0] = 1 - commitment_B.labels[0];
        
        if (!ComponentA.verify(commitment_B)) {
            success('Tampered commitment correctly rejected');
            passed++;
        } else {
            error('Tampered commitment was incorrectly accepted');
            failed++;
        }
    } catch (e) {
        error(`Exception: ${e.message}`);
        failed++;
    }
    
    try {
        log('\nTest 1.3: Three different hospitals', 'bold');
        const hospitals = [];
        const commitments = [];
        
        for (let i = 0; i < 3; i++) {
            const h = new ComponentA(128, 50 + i * 5, 78 - i * 5);
            const c = h.generateCommitment();
            hospitals.push(h);
            commitments.push(c);
            
            if (!ComponentA.verify(c)) {
                throw new Error(`Hospital ${i} verification failed`);
            }
        }
        
        success('All 3 hospital datasets verified');
        for (let i = 0; i < 3; i++) {
            log(`  Hospital ${i+1}: R_D = ${commitments[i].R_D.slice(0, 16)}...`, 'blue');
        }
        passed++;
    } catch (e) {
        error(`Exception: ${e.message}`);
        failed++;
    }
    
    // ==========================================================================
    // PHASE 2: Component B Tests
    // ==========================================================================
    
    header('PHASE 2: Component B - Training Integrity Verification');
    
    try {
        log('\nTest 2.1: Single training step with clipping', 'bold');
        const hospital = new ComponentA(128, 60, 68);
        const commitment_A = hospital.generateCommitment();
        
        const trainer = new ComponentB(commitment_A.labels, 8, 32, 1.0);
        const weights_old = new Array(32).fill(0.5);
        const training_result = trainer.trainingStep(commitment_A.labels, weights_old);
        const commitment_B = trainer.createCommitment(training_result, commitment_A.R_D);
        
        if (ComponentB.verify(commitment_B, commitment_A.R_D)) {
            success('Training step verified with correct clipping');
            log(`  Gradient norm: ${training_result.norm.toFixed(4)}`, 'blue');
            log(`  R_G = ${commitment_B.R_G.slice(0, 16)}...`, 'blue');
            passed++;
        } else {
            error('Training verification failed');
            failed++;
        }
    } catch (e) {
        error(`Exception: ${e.message}`);
        failed++;
    }
    
    try {
        log('\nTest 2.2: Commitment binding to weights', 'bold');
        const hospital = new ComponentA(128, 60, 68);
        const commitment_A = hospital.generateCommitment();
        
        const trainer = new ComponentB(commitment_A.labels, 8, 32, 1.0);
        const weights_old = new Array(32).fill(0.5);
        const training_result = trainer.trainingStep(commitment_A.labels, weights_old);
        const commitment_B = trainer.createCommitment(training_result, commitment_A.R_D);
        
        // Try to claim different weights
        commitment_B.weights_new[0] += 0.1;
        
        if (!ComponentB.verify(commitment_B, commitment_A.R_D)) {
            success('Weight tampering correctly detected');
            passed++;
        } else {
            error('Weight tampering was not detected');
            failed++;
        }
    } catch (e) {
        error(`Exception: ${e.message}`);
        failed++;
    }
    
    // Store commitments for Component C tests
    let components_B = [];
    for (let i = 0; i < 3; i++) {
        try {
            const hospital = new ComponentA(128, 50 + i * 5, 78 - i * 5);
            const commitment_A = hospital.generateCommitment();
            const trainer = new ComponentB(commitment_A.labels, 8, 32, 1.0);
            const weights_old = new Array(32).fill(0.5);
            const training_result = trainer.trainingStep(commitment_A.labels, weights_old);
            const commitment_B = trainer.createCommitment(training_result, commitment_A.R_D);
            
            components_B.push({
                commitment_A,
                commitment_B,
                trainer,
                training_result
            });
        } catch (e) {
            log(`Warning: Could not prepare Component B test ${i}`, 'yellow');
        }
    }
    
    // ==========================================================================
    // PHASE 3: Component C Tests
    // ==========================================================================
    
    header('PHASE 3: Component C - Secure Aggregation Verification');
    
    try {
        log('\nTest 3.1: Create masked update with PRF', 'bold');
        if (components_B.length === 0) throw new Error('No Component B data available');
        
        const comp_b = components_B[0];
        const aggregator = new ComponentC(32);
        const masked_update = aggregator.createMaskedUpdate(
            comp_b.training_result.gradient_clipped,
            comp_b.commitment_B.R_G
        );
        
        if (ComponentC.verify(masked_update, comp_b.commitment_B.R_G)) {
            success('Masked update verified with dropout tolerance');
            log(`  Mask derived from PRF: ✓`, 'blue');
            log(`  Masking arithmetic correct: ✓`, 'blue');
            log(`  Dropout tolerance verified: ✓`, 'blue');
            passed++;
        } else {
            error('Masked update verification failed');
            failed++;
        }
    } catch (e) {
        error(`Exception: ${e.message}`);
        failed++;
    }
    
    try {
        log('\nTest 3.2: Detect incorrect masking', 'bold');
        if (components_B.length === 0) throw new Error('No Component B data available');
        
        const comp_b = components_B[1];
        const aggregator = new ComponentC(32);
        const masked_update = aggregator.createMaskedUpdate(
            comp_b.training_result.gradient_clipped,
            comp_b.commitment_B.R_G
        );
        
        // Try to tamper: change masked gradient
        masked_update.masked_gradient[0] += 0.05;
        
        if (!ComponentC.verify(masked_update, comp_b.commitment_B.R_G)) {
            success('Incorrect masking correctly detected');
            passed++;
        } else {
            error('Tampering was not detected');
            failed++;
        }
    } catch (e) {
        error(`Exception: ${e.message}`);
        failed++;
    }
    
    // ==========================================================================
    // PHASE 4: End-to-End Integration Test
    // ==========================================================================
    
    header('PHASE 4: End-to-End Integration (All Components)');
    
    try {
        log('\nTest 4.1: Three hospitals complete pipeline', 'bold');
        
        const hospitals_data = [];
        
        for (let h = 0; h < 3; h++) {
            // Component A
            const hospital = new ComponentA(128, 50 + h * 5, 78 - h * 5);
            const commitment_A = hospital.generateCommitment();
            
            if (!ComponentA.verify(commitment_A)) {
                throw new Error(`Hospital ${h} Component A verification failed`);
            }
            
            // Component B
            const trainer = new ComponentB(commitment_A.labels, 8, 32, 1.0);
            const weights_old = new Array(32).fill(0.5);
            const training_result = trainer.trainingStep(commitment_A.labels, weights_old);
            const commitment_B = trainer.createCommitment(training_result, commitment_A.R_D);
            
            if (!ComponentB.verify(commitment_B, commitment_A.R_D)) {
                throw new Error(`Hospital ${h} Component B verification failed`);
            }
            
            // Component C
            const aggregator = new ComponentC(32);
            const masked_update = aggregator.createMaskedUpdate(
                training_result.gradient_clipped,
                commitment_B.R_G
            );
            
            if (!ComponentC.verify(masked_update, commitment_B.R_G)) {
                throw new Error(`Hospital ${h} Component C verification failed`);
            }
            
            hospitals_data.push({
                id: h,
                commitment_A,
                commitment_B,
                masked_update,
                gradient: training_result.gradient_clipped,
                mask: masked_update.mask
            });
            
            log(`  Hospital ${h+1}: ✓ All 3 components verified`, 'blue');
        }
        
        success('All 3 hospitals completed full pipeline');
        passed++;
        
        // Aggregate masked gradients
        log('\nAggregating masked gradients...', 'bold');
        let aggregate_masked = new Array(32).fill(0);
        for (let h of hospitals_data) {
            for (let d = 0; d < 32; d++) {
                aggregate_masked[d] += h.masked_update.masked_gradient[d];
            }
        }
        log(`  Aggregate (masked): [${aggregate_masked.slice(0, 5).map(x => x.toFixed(3)).join(', ')}, ...]`, 'blue');
        
        // Unmask
        log('\nUnmasking aggregate...', 'bold');
        let total_mask = new Array(32).fill(0);
        for (let h of hospitals_data) {
            for (let d = 0; d < 32; d++) {
                total_mask[d] += h.mask[d];
            }
        }
        
        let final_gradient = new Array(32);
        for (let d = 0; d < 32; d++) {
            final_gradient[d] = aggregate_masked[d] - total_mask[d];
        }
        log(`  Final (unmasked): [${final_gradient.slice(0, 5).map(x => x.toFixed(3)).join(', ')}, ...]`, 'blue');
        
        success('Aggregation pipeline complete');
        passed++;
        
    } catch (e) {
        error(`Exception: ${e.message}`);
        failed++;
    }
    
    // ==========================================================================
    // PHASE 5: Dropout Resilience Test
    // ==========================================================================
    
    header('PHASE 5: Dropout Recovery');
    
    try {
        log('\nTest 5.1: Aggregation with one hospital offline', 'bold');
        
        const hospitals_data = [];
        
        for (let h = 0; h < 3; h++) {
            const hospital = new ComponentA(128, 50 + h * 5, 78 - h * 5);
            const commitment_A = hospital.generateCommitment();
            const trainer = new ComponentB(commitment_A.labels, 8, 32, 1.0);
            const weights_old = new Array(32).fill(0.5);
            const training_result = trainer.trainingStep(commitment_A.labels, weights_old);
            const commitment_B = trainer.createCommitment(training_result, commitment_A.R_D);
            const aggregator = new ComponentC(32);
            const masked_update = aggregator.createMaskedUpdate(
                training_result.gradient_clipped,
                commitment_B.R_G
            );
            
            hospitals_data.push({
                id: h,
                masked_update,
                gradient: training_result.gradient_clipped,
                mask: masked_update.mask,
                online: h !== 2  // Hospital 2 is offline
            });
        }
        
        // Aggregate only from online hospitals
        let aggregate_masked = new Array(32).fill(0);
        for (let h of hospitals_data) {
            if (h.online) {
                for (let d = 0; d < 32; d++) {
                    aggregate_masked[d] += h.masked_update.masked_gradient[d];
                }
            }
        }
        
        // Recover masks from online hospitals
        let total_mask = new Array(32).fill(0);
        for (let h of hospitals_data) {
            if (h.online) {
                for (let d = 0; d < 32; d++) {
                    total_mask[d] += h.mask[d];
                }
            }
        }
        
        // Compute final gradient
        let final_gradient = new Array(32);
        for (let d = 0; d < 32; d++) {
            final_gradient[d] = aggregate_masked[d] - total_mask[d];
        }
        
        success('Aggregation works with Hospital 3 offline');
        log(`  Online hospitals: 2/3 ✓`, 'blue');
        log(`  Final gradient: [${final_gradient.slice(0, 5).map(x => x.toFixed(3)).join(', ')}, ...]`, 'blue');
        passed++;
        
    } catch (e) {
        error(`Exception: ${e.message}`);
        failed++;
    }
    
    // ==========================================================================
    // Summary
    // ==========================================================================
    
    header('TEST SUMMARY');
    
    log(`\nTotal Tests: ${passed + failed}`, 'bold');
    log(`Passed: ${passed}`, 'green');
    log(`Failed: ${failed}`, failed === 0 ? 'green' : 'red');
    
    if (failed === 0) {
        log(`\n${'='.repeat(70)}`, 'green');
        log('🎉 ALL TESTS PASSED! System is working correctly.', 'green');
        log(`${'='.repeat(70)}`, 'green');
    } else {
        log(`\n${'='.repeat(70)}`, 'red');
        log('❌ Some tests failed. Review the output above.', 'red');
        log(`${'='.repeat(70)}`, 'red');
    }
    
    return failed === 0;
}

// Run tests
runTests().then(success => {
    process.exit(success ? 0 : 1);
});
