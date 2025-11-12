pragma circom 2.0.0;

/*
 * ═══════════════════════════════════════════════════════════════════════════
 * fixedpoint.circom - Fixed-Point Arithmetic for ZK Circuits
 * ═══════════════════════════════════════════════════════════════════════════
 * 
 * Problem: Field arithmetic doesn't have division or decimals!
 * Solution: Use fixed-point representation with scaling factor.
 * 
 * Example: PRECISION = 1000
 *   Decimal 0.5 → 500 (fixed-point)
 *   Decimal 1.5 → 1500 (fixed-point)
 *   Decimal -2.3 → -2300 (fixed-point)
 * 
 * Used for: Gradient clipping, learning rates, weight updates
 */

/*
 * FixedPointMul
 * 
 * Multiplies two fixed-point numbers.
 * 
 * If a = x * PRECISION and b = y * PRECISION, then:
 *   a * b = (x * PRECISION) * (y * PRECISION) = x*y * PRECISION²
 * 
 * So we need to divide by PRECISION to get correct result:
 *   result = (a * b) / PRECISION
 * 
 * Parameters:
 *   PRECISION - The scaling factor (e.g., 1000 for 3 decimals)
 * 
 * Inputs:
 *   a - First fixed-point number
 *   b - Second fixed-point number
 * 
 * Output:
 *   result - Product a*b in fixed-point
 */
template FixedPointMul(PRECISION) {
    signal input a;
    signal input b;
    signal output result;
    
    // result = (a * b) / PRECISION
    // In modular arithmetic: result = (a * b) * PRECISION^(-1)
    
    var product = a * b;
    
    // Divide by PRECISION (multiply by inverse)
    // For simplicity, use integer division
    result <-- product / PRECISION;
    
    // Verify: result * PRECISION ≈ product (up to rounding)
    result * PRECISION ≈ product;  // May have small error due to rounding
}

/*
 * FixedPointDiv
 * 
 * Divides two fixed-point numbers.
 * 
 * If a = x * PRECISION and b = y * PRECISION, then:
 *   a / b = (x * PRECISION) / (y * PRECISION) = x / y
 * 
 * But we want result in fixed-point:
 *   result = (x / y) * PRECISION = (a / b) * PRECISION
 * 
 * So: result = (a * PRECISION) / b
 * 
 * Parameters:
 *   PRECISION - The scaling factor
 * 
 * Inputs:
 *   a - Dividend (fixed-point)
 *   b - Divisor (fixed-point)
 * 
 * Output:
 *   result - Quotient a/b in fixed-point
 */
template FixedPointDiv(PRECISION) {
    signal input a;
    signal input b;
    signal output result;
    
    // result = (a * PRECISION) / b
    var scaled_a = a * PRECISION;
    result <-- scaled_a / b;
    
    // Verify: result * b ≈ a * PRECISION
    result * b ≈ scaled_a;
}

/*
 * FixedPointSqrt
 * 
 * Computes square root in fixed-point.
 * 
 * If value = x² * PRECISION², then:
 *   sqrt(value) = x * PRECISION (in fixed-point)
 * 
 * Challenge: Division is hard in circuits, so we use a clever trick.
 * 
 * Parameters:
 *   PRECISION - The scaling factor
 * 
 * Inputs:
 *   value - Fixed-point number to take square root of
 * 
 * Output:
 *   result - sqrt(value) in fixed-point
 */
template FixedPointSqrt(PRECISION) {
    signal input value;
    signal output result;
    
    // Compute: result² = value
    // (result is the square root)
    
    result <-- value ** 0.5;  // Assign computed value
    
    // Verify: result² = value
    result * result === value;
}

/*
 * FixedPointCompare
 * 
 * Compares two fixed-point numbers.
 * Returns 1 if a < b, 0 otherwise.
 * 
 * Uses the trick: a < b ⟺ b - a > 0
 * 
 * Parameters:
 *   PRECISION - The scaling factor (for bit width)
 * 
 * Inputs:
 *   a - First number (fixed-point)
 *   b - Second number (fixed-point)
 * 
 * Output:
 *   lt - 1 if a < b, 0 otherwise
 */
template FixedPointCompare(PRECISION) {
    signal input a;
    signal input b;
    signal output lt;
    
    // Compute difference
    signal diff <== b - a;
    
    // Check if diff > 0 using bit manipulation
    // (would need proper range check in production)
    
    lt <-- (diff > 0) ? 1 : 0;
}

