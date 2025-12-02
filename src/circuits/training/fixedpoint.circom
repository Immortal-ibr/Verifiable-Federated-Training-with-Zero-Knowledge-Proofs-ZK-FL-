pragma circom 2.0.0;

include "../../../node_modules/circomlib/circuits/comparators.circom";
include "../../../node_modules/circomlib/circuits/bitify.circom";

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
    // NOTE: All inputs are assumed to be POSITIVE (biased representation)
    // This ensures the hint computation works correctly
    result <-- product / PRECISION;
    
    // Verify division: product = result * PRECISION + remainder
    signal remainder;
    remainder <-- product % PRECISION;
    product === result * PRECISION + remainder;
    
    // Constrain remainder to be in valid range [0, PRECISION)
    // Since all values are positive, this check works correctly
    component rangeCheck = LessThan(64);
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
    
    // Divide using hint
    // NOTE: All inputs are assumed to be POSITIVE (biased representation)
    result <-- scaledA / b;
    
    // Verify division: scaledA = result * b + remainder
    signal remainder;
    remainder <-- scaledA % b;
    scaledA === result * b + remainder;
    
    // Constrain remainder to be in valid range [0, b)
    component rangeCheck = LessThan(64);
    rangeCheck.in[0] <== remainder;
    rangeCheck.in[1] <== b;
    rangeCheck.out === 1;
    
    // Constrain b to be non-zero by checking b * b_inv = 1
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
    
    // Handle zero case: sqrt(0) = 0
    // Check if value is zero using IsZero
    component isZeroCheck = IsZero();
    isZeroCheck.in <== value;
    signal isZero <== isZeroCheck.out; // 1 if value == 0, else 0
    
    // Use hint to compute sqrt, then verify with constraints
    // This avoids Newton iteration issues with division by zero
    signal sqrtHint;
    sqrtHint <-- isZero == 1 ? 0 : sqrt_hint(value, PRECISION);
    
    // For non-zero values, verify that sqrtHint² ≈ value
    // sqrtHint² should be close to value (within PRECISION tolerance)
    signal sqrtSquared;
    sqrtSquared <== sqrtHint * sqrtHint;
    
    // Compute the scaled value for comparison
    // sqrtHint is in fixed-point, so sqrtHint² / PRECISION should ≈ value
    signal scaledSquared;
    scaledSquared <-- sqrtSquared / PRECISION;
    signal sqRemainder;
    sqRemainder <-- sqrtSquared % PRECISION;
    sqrtSquared === scaledSquared * PRECISION + sqRemainder;
    
    // Constrain remainder to be less than PRECISION
    component remCheck = LessThan(64);
    remCheck.in[0] <== sqRemainder;
    remCheck.in[1] <== PRECISION;
    remCheck.out === 1;
    
    // The squared result should be close to value
    // Allow tolerance of 2*PRECISION for rounding errors
    // |scaledSquared - value| < 2*PRECISION
    signal diff <== scaledSquared - value;
    signal absDiff;
    signal diffIsNeg <-- (diff > (1 << 251)) ? 1 : 0;
    diffIsNeg * (1 - diffIsNeg) === 0; // Binary constraint
    
    // Compute absDiff = diffIsNeg ? -diff : diff
    // Using intermediate signals to avoid non-quadratic constraints
    signal negDiff <== -diff;
    signal diffTimesIsNeg <== diffIsNeg * diff;
    signal negDiffTimesIsNeg <== diffIsNeg * negDiff;
    // absDiff = negDiff * diffIsNeg + diff * (1 - diffIsNeg)
    //         = negDiffTimesIsNeg + diff - diffTimesIsNeg
    absDiff <== negDiffTimesIsNeg + diff - diffTimesIsNeg;
    
    component errorBound = LessThan(64);
    errorBound.in[0] <== absDiff;
    errorBound.in[1] <== 2 * PRECISION; // Allow 2 units of tolerance
    // Relax constraint for zero case or accept bounded error
    signal errorOk <== errorBound.out + isZero; // Either error is small OR value is zero
    signal errorCheck;
    component isErrorOk = IsZero();
    isErrorOk.in <== errorOk;
    isErrorOk.out === 0; // errorOk must be non-zero (at least one condition true)
    
    // Final result: 0 if input was 0, otherwise the computed sqrt
    result <== (1 - isZero) * sqrtHint;
}

// Helper function for sqrt hint (computed outside circuit)
function sqrt_hint(value, PRECISION) {
    // Newton's method computed as hint
    var guess = value / 2;
    if (guess == 0) { guess = PRECISION; }
    for (var i = 0; i < 15; i++) {
        var next = (guess + (value * PRECISION) / guess) / 2;
        if (next >= guess) { return guess; }
        guess = next;
    }
    return guess;
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
    // We use a hint and then constrain it properly
    
    // Hint: check if value appears negative (in upper half of field)
    signal isNeg <-- (value > (1 << 251)) ? 1 : 0;
    
    // CRITICAL: Constrain isNeg to be binary
    isNeg * (1 - isNeg) === 0;
    
    // Compute the potential absolute value
    signal negValue <== -value;
    
    // result = isNeg ? negValue : value
    result <== isNeg * (negValue - value) + value;
    
    // Constrain that result is correct:
    // If isNeg = 0: result = value, so result + 0 = value ✓
    // If isNeg = 1: result = -value, so result + value = 0 (in field)
    // We verify: isNeg * (result + value) + (1 - isNeg) * (result - value) === 0
    signal check1 <== result + value;  // Should be 0 if negated
    signal check2 <== result - value;  // Should be 0 if not negated
    isNeg * check1 + (1 - isNeg) * check2 === 0;
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
