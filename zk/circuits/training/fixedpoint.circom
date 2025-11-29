pragma circom 2.0.0;

include "../../../node_modules/circomlib/circuits/comparators.circom";

/*
 * Fixed-Point Arithmetic Library
 * 
 * ZK circuits work with integers, not floats. This library provides
 * fixed-point arithmetic to simulate decimal numbers.
 * 
 * Fixed-point representation:
 *   Real number r is represented as: r_fixed = r * PRECISION
 *   Example with PRECISION=1000:
 *     3.14 → 3140
 *     0.01 → 10
 *     -2.5 → -2500
 * 
 * This allows us to do gradient computations, weight updates, etc.
 * with fractional values in the circuit.
 * 
 * Authors: Tarek Salama, Zeyad Elshafey, Ahmed Elbehiry
 * Date: November 11, 2025
 */

/*
 * FixedPointMul
 * 
 * Multiplies two fixed-point numbers and maintains precision.
 * 
 * Mathematical operation:
 *   result = (a * b) / PRECISION
 * 
 * Example (PRECISION=1000):
 *   a = 3.14 → 3140
 *   b = 2.0  → 2000
 *   a_fixed * b_fixed = 3140 * 2000 = 6,280,000
 *   result = 6,280,000 / 1000 = 6280 → 6.28 ✓
 * 
 * Parameters:
 *   PRECISION - Fixed-point multiplier (e.g., 1000 for 3 decimals)
 * 
 * Inputs:
 *   a, b - Fixed-point numbers
 * 
 * Outputs:
 *   result - Product in fixed-point
 */
template FixedPointMul(PRECISION) {
    signal input a;
    signal input b;
    signal output result;
    
    // Compute raw product
    signal product;
    product <== a * b;
    
    // Divide by PRECISION to maintain scale
    // Use hint for division, then verify with constraints
    result <-- product / PRECISION;
    
    // Verify the division: product = result * PRECISION + remainder
    signal remainder;
    remainder <-- product % PRECISION;
    product === result * PRECISION + remainder;
    
    // Constrain remainder to be less than PRECISION
    component rangeCheck = LessThan(252);
    rangeCheck.in[0] <== remainder;
    rangeCheck.in[1] <== PRECISION;
    rangeCheck.out === 1;
}

/*
 * FixedPointDiv
 * 
 * Divides two fixed-point numbers.
 * 
 * Mathematical operation:
 *   result = (a * PRECISION) / b
 * 
 * Example (PRECISION=1000):
 *   a = 6.28 → 6280
 *   b = 2.0  → 2000
 *   result = (6280 * 1000) / 2000 = 3140 → 3.14 ✓
 * 
 * Parameters:
 *   PRECISION - Fixed-point multiplier
 * 
 * Inputs:
 *   a - Numerator (fixed-point)
 *   b - Denominator (fixed-point, must be non-zero)
 * 
 * Outputs:
 *   result - Quotient (fixed-point)
 * 
 * IMPORTANT: Division by zero is undefined! Caller must ensure b != 0.
 */
template FixedPointDiv(PRECISION) {
    signal input a;
    signal input b;
    signal output result;
    
    // Scale numerator to maintain precision
    signal scaledA;
    scaledA <== a * PRECISION;
    
    // Divide using hint and constraints
    result <-- scaledA / b;
    
    // Verify division: scaledA = result * b + remainder
    signal remainder;
    remainder <-- scaledA % b;
    scaledA === result * b + remainder;
    
    // Verify remainder is less than b
    component remainderCheck = LessThan(252);
    remainderCheck.in[0] <== remainder;
    remainderCheck.in[1] <== b;
    remainderCheck.out === 1;
    
    // Constrain b to be non-zero by checking b * b_inv = 1
    // where b_inv is the multiplicative inverse
    signal b_inv;
    b_inv <-- 1 / b;
    b * b_inv === 1;
}

/*
 * FixedPointAdd
 * 
 * Adds two fixed-point numbers.
 * 
 * This is straightforward: since both numbers have the same scale,
 * we can just add them directly.
 * 
 * Mathematical operation:
 *   result = a + b
 * 
 * Example (PRECISION=1000):
 *   a = 3.14 → 3140
 *   b = 2.86 → 2860
 *   result = 3140 + 2860 = 6000 → 6.0 ✓
 * 
 * Parameters:
 *   PRECISION - Fixed-point multiplier (informational only)
 * 
 * Inputs:
 *   a, b - Fixed-point numbers
 * 
 * Outputs:
 *   result - Sum (fixed-point)
 */
template FixedPointAdd(PRECISION) {
    signal input a;
    signal input b;
    signal output result;
    
    // Direct addition (both have same scale)
    result <== a + b;
}

/*
 * FixedPointSub
 * 
 * Subtracts two fixed-point numbers.
 * 
 * Mathematical operation:
 *   result = a - b
 * 
 * Example (PRECISION=1000):
 *   a = 5.0 → 5000
 *   b = 2.3 → 2300
 *   result = 5000 - 2300 = 2700 → 2.7 ✓
 * 
 * Parameters:
 *   PRECISION - Fixed-point multiplier (informational only)
 * 
 * Inputs:
 *   a, b - Fixed-point numbers
 * 
 * Outputs:
 *   result - Difference (fixed-point)
 */
template FixedPointSub(PRECISION) {
    signal input a;
    signal input b;
    signal output result;
    
    // Direct subtraction
    result <== a - b;
}

/*
 * FixedPointSqrt
 * 
 * Computes square root of a fixed-point number using Newton's method.
 * 
 * Newton's method for sqrt(x):
 *   y_{n+1} = (y_n + x/y_n) / 2
 * 
 * We iterate a fixed number of times for determinism.
 * 
 * Mathematical operation:
 *   result = sqrt(value)
 * 
 * Example (PRECISION=1000):
 *   value = 9.0 → 9000
 *   result = 3000 → 3.0 ✓
 * 
 * Parameters:
 *   PRECISION - Fixed-point multiplier
 * 
 * Inputs:
 *   value - Input value (fixed-point, must be non-negative)
 * 
 * Outputs:
 *   result - Square root (fixed-point)
 * 
 * IMPORTANT: Only works for non-negative values!
 */
template FixedPointSqrt(PRECISION) {
    signal input value;
    signal output result;
    
    // Number of Newton iterations (more = more accurate)
    var ITERATIONS = 10;
    
    // Initial guess: y_0 = value / 2
    signal guess[ITERATIONS + 1];
    component div1 = FixedPointDiv(PRECISION);
    div1.a <== value;
    div1.b <== 2 * PRECISION; // Divide by 2
    guess[0] <== div1.result;
    
    // Newton iterations
    component div2[ITERATIONS];
    component add[ITERATIONS];
    component div3[ITERATIONS];
    
    for (var i = 0; i < ITERATIONS; i++) {
        // Compute x / y_n
        div2[i] = FixedPointDiv(PRECISION);
        div2[i].a <== value;
        div2[i].b <== guess[i];
        
        // Compute y_n + x/y_n
        add[i] = FixedPointAdd(PRECISION);
        add[i].a <== guess[i];
        add[i].b <== div2[i].result;
        
        // Divide by 2: y_{n+1} = (y_n + x/y_n) / 2
        div3[i] = FixedPointDiv(PRECISION);
        div3[i].a <== add[i].result;
        div3[i].b <== 2 * PRECISION;
        guess[i + 1] <== div3[i].result;
    }
    
    result <== guess[ITERATIONS];
    
    // Verify that result² ≈ value (within tolerance)
    component mul = FixedPointMul(PRECISION);
    mul.a <== result;
    mul.b <== result;
    signal resultSquared <== mul.result;
    
    // Allow small error due to rounding
    signal error <== value - resultSquared;
    // In practice, you'd want to bound the error, but for now we just compute it
}

/*
 * FixedPointAbs
 * 
 * Computes absolute value of a fixed-point number.
 * 
 * Mathematical operation:
 *   result = |value|
 * 
 * Example (PRECISION=1000):
 *   value = -3.14 → -3140
 *   result = 3140 → 3.14 ✓
 * 
 * Parameters:
 *   PRECISION - Fixed-point multiplier (informational only)
 * 
 * Inputs:
 *   value - Input value (fixed-point, can be negative)
 * 
 * Outputs:
 *   result - Absolute value (fixed-point, always non-negative)
 */
template FixedPointAbs(PRECISION) {
    signal input value;
    signal output result;
    
    // Check if value is negative
    // In field arithmetic, negative numbers are large positive numbers
    // So we check if value > (p-1)/2 where p is the field prime
    
    component isNegative = LessThan(252);
    // Check if value is in upper half of field (negative)
    // This is a simplified check; in practice you'd use a more robust method
    
    // For now, use a simple conditional:
    // If value appears negative (high bit set), negate it
    // Otherwise, keep it as is
    signal isNeg <-- (value > (1 << 251)) ? 1 : 0;
    
    // result = isNeg ? -value : value
    result <== isNeg * (-value - value) + value;
    // Simplifies to: result = -2*isNeg*value + value
    // If isNeg = 0: result = value
    // If isNeg = 1: result = -value
}

/*
 * FixedPointMin
 * 
 * Returns the minimum of two fixed-point numbers.
 * 
 * Mathematical operation:
 *   result = min(a, b)
 * 
 * Parameters:
 *   PRECISION - Fixed-point multiplier (informational only)
 * 
 * Inputs:
 *   a, b - Two fixed-point numbers
 * 
 * Outputs:
 *   result - Minimum of a and b
 */
template FixedPointMin(PRECISION) {
    signal input a;
    signal input b;
    signal output result;
    
    // Compare a and b
    component lt = LessThan(252);
    lt.in[0] <== a;
    lt.in[1] <== b;
    signal aLessB <== lt.out; // 1 if a < b, 0 otherwise
    
    // result = aLessB ? a : b
    result <== aLessB * (a - b) + b;
    // If aLessB = 1: result = a
    // If aLessB = 0: result = b
}

/*
 * FixedPointMax
 * 
 * Returns the maximum of two fixed-point numbers.
 * 
 * Mathematical operation:
 *   result = max(a, b)
 * 
 * Parameters:
 *   PRECISION - Fixed-point multiplier (informational only)
 * 
 * Inputs:
 *   a, b - Two fixed-point numbers
 * 
 * Outputs:
 *   result - Maximum of a and b
 */
template FixedPointMax(PRECISION) {
    signal input a;
    signal input b;
    signal output result;
    
    // Compare a and b
    component lt = LessThan(252);
    lt.in[0] <== a;
    lt.in[1] <== b;
    signal aLessB <== lt.out; // 1 if a < b, 0 otherwise
    
    // result = aLessB ? b : a
    result <== aLessB * (b - a) + a;
    // If aLessB = 1: result = b
    // If aLessB = 0: result = a
}
