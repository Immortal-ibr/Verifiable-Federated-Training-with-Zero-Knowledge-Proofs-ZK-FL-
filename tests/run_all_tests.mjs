#!/usr/bin/env node
/**
 * ═══════════════════════════════════════════════════════════════════════════
 * TEST RUNNER: Execute all integration tests
 * ═══════════════════════════════════════════════════════════════════════════
 */

import { execSync } from 'child_process';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

console.log('\n╔══════════════════════════════════════════════════════════════════╗');
console.log('║              ZK-FL TEST SUITE                                    ║');
console.log('╚══════════════════════════════════════════════════════════════════╝\n');

const tests = [
    {
        name: 'Quick Integration Test',
        file: 'quick_integration_test.mjs',
        description: 'Fast validation with small parameters (N=8)'
    },
    {
        name: 'Full System Simulation',
        file: 'full_system_simulation.mjs',
        description: 'E2E prover/verifier with 3 clients using sgd_verified (gradient correctness)'
    },
    {
        name: 'Verified Gradient Test',
        file: 'test_verified_gradient.mjs',
        description: 'Standalone gradient correctness test (sanity check for sgd_verified circuit)'
    },
    // Uncomment for full test:
    // {
    //     name: 'Full Integration Test',
    //     file: 'integration_test.mjs',
    //     description: 'Production test with full parameters (N=128)'
    // }
];

let passed = 0;
let failed = 0;

for (const test of tests) {
    console.log(`\n▶ Running: ${test.name}`);
    console.log(`  ${test.description}`);
    console.log('─'.repeat(60));
    
    try {
        execSync(`node "${path.join(__dirname, test.file)}"`, { 
            stdio: 'inherit',
            cwd: path.join(__dirname, '..')
        });
        passed++;
        console.log(`\n✅ ${test.name} PASSED`);
    } catch (error) {
        failed++;
        console.log(`\n❌ ${test.name} FAILED`);
    }
}

console.log('\n' + '═'.repeat(60));
console.log(`RESULTS: ${passed} passed, ${failed} failed`);
console.log('═'.repeat(60) + '\n');

process.exit(failed > 0 ? 1 : 0);
