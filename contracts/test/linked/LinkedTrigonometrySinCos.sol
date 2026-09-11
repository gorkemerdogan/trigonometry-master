// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {MathLib} from "../../libraries/MathLib.sol";
import {QuadConstants as QC} from "../../libraries/QuadConstants.sol";

/**
 * @title TrigonometrySinCos
 * @notice Sine and cosine evaluation using IEEE-754 binary128 (bytes16) arithmetic.
 *         Implements quadrant-aware angle reduction followed by finite Taylor
 *         polynomials on the interval [-π/4, +π/4]. Function accuracy is limited
 *         by range reduction and polynomial truncation, not just the binary128 format.
 */
library LinkedTrigonometrySinCos {
    // ------------------------------------------------------------
    // Helpers
    // ------------------------------------------------------------

    bytes16 internal constant QZERO = 0x00000000000000000000000000000000;
    bytes16 internal constant ONE = 0x3fff0000000000000000000000000000;

    // These are the exact binary128 results of the previous MathLib runtime
    // construction: ±MathLib.div(MathLib.fromUInt(1), MathLib.fromUInt(n)).
    // test/trigonometry.polynomial.ab.gas.test.ts audits every encoding and
    // asserts bit-identical polynomial results against that runtime baseline.
    bytes16 internal constant SIN_C1 = 0xbffc5555555555555555555555555555; // -1/3!
    bytes16 internal constant SIN_C2 = 0x3ff81111111111111111111111111111; //  1/5!
    bytes16 internal constant SIN_C3 = 0xbff2a01a01a01a01a01a01a01a01a01a; // -1/7!
    bytes16 internal constant SIN_C4 = 0x3fec71de3a556c7338faac1c88e50017; //  1/9!
    bytes16 internal constant SIN_C5 = 0xbfe5ae64567f544e38fe747e4b837dc7; // -1/11!
    bytes16 internal constant SIN_C6 = 0x3fde6124613a86d097ca38331d23af68; //  1/13!

    bytes16 internal constant COS_C1 = 0xbffe0000000000000000000000000000; // -1/2!
    bytes16 internal constant COS_C2 = 0x3ffa5555555555555555555555555555; //  1/4!
    bytes16 internal constant COS_C3 = 0xbff56c16c16c16c16c16c16c16c16c16; // -1/6!
    bytes16 internal constant COS_C4 = 0x3fefa01a01a01a01a01a01a01a01a01a; //  1/8!
    bytes16 internal constant COS_C5 = 0xbfe927e4fb7789f5c72ef016d3ea6678; // -1/10!
    bytes16 internal constant COS_C6 = 0x3fe21eed8eff8d897b544da987acfe84; //  1/12!

    // |x| <= 2^32 radians. This keeps the current binary128 quotient-and-subtract
    // reducer in its characterized range; broader support needs multiprecision
    // reduction such as Payne-Hanek.
    bytes16 internal constant MAX_REDUCTION_ARGUMENT = 0x401F0000000000000000000000000000;

    /**
     * @notice Validates the supported domain for quotient-based angle reduction.
     * @dev This must run before converting x / (2π) to int256. NaN and infinity
     *      are rejected explicitly, while finite inputs outside ±2^32 are rejected
     *      because this reducer does not preserve phase for arbitrary binary128 angles.
     */
    function _validateReductionArgument(bytes16 x) private pure {
        if (MathLib.isNaN(x)) revert("TRIG_NAN_ANGLE");

        uint128 exponent = (uint128(x) >> 112) & 0x7fff;
        if (exponent == 0x7fff) revert("TRIG_INFINITE_ANGLE");

        require(
            MathLib.cmp(MathLib.abs(x), MAX_REDUCTION_ARGUMENT) <= 0,
            "TRIG_ARGUMENT_OUT_OF_RANGE"
        );
    }

    function _floorToInt(bytes16 x) private pure returns (int256) {
        if (MathLib.isZero(x)) return 0;

        int256 k = MathLib.toInt(x);
        if (MathLib.cmp(x, MathLib.fromInt(k)) < 0) {
            k -= 1;
        }
        return k;
    }

    /**
     * @notice Reduces an angle into the core range [-π/4, +π/4] and encodes
     *         quadrant information in a mask.
     * @dev Reduction occurs in two stages:
     *        (1) Modulo 2π → principal domain
     *        (2) Modulo π/2 → core subrange
     *
     *      Supported finite input range: |x| ≤ 2^32 radians. The quotient-and-
     *      subtract approach is not reliable for arbitrary binary128 magnitudes;
     *      broad-domain reduction requires Payne-Hanek or equivalent multiprecision
     *      arithmetic.
     *
     *      The returned bitmask contains:
     *        bit0: swap flag (0 → use sin polynomial, 1 → use cos polynomial)
     *        bit1: sine sign bit  (1 → negative)
     *        bit2: cosine sign bit (1 → negative)
     *
     * @param x Input angle (bytes16)
     * @return xr Reduced angle in [-π/4, +π/4]
     * @return mask Encoded quadrant and swap information
     */
    function reduceAngle(
        bytes16 x
    ) internal pure returns (bytes16 xr, uint8 mask) {
        _validateReductionArgument(x);

        bytes16 halfpi = QC.HALF_PI();
        bytes16 twopi = QC.TWO_PI();

        // 1) floor-based mod 2π
        bytes16 t = MathLib.div(x, twopi);
        int256 k = _floorToInt(t);
        bytes16 kq = MathLib.fromInt(k);
        bytes16 xm = MathLib.sub(x, MathLib.mul(kq, twopi));

        // 2) floor-based mod π/2
        bytes16 t2 = MathLib.div(xm, halfpi);
        int256 k2 = _floorToInt(t2);
        bytes16 k2q = MathLib.fromInt(k2);
        xr = MathLib.sub(xm, MathLib.mul(k2q, halfpi));

        uint8 q = uint8(uint256(k2 & 3));

        uint8 swap = (q == 1 || q == 3) ? 1 : 0;
        uint8 sinNeg = (q == 2 || q == 3) ? 1 : 0;
        uint8 cosNeg = (q == 1 || q == 2) ? 1 : 0;

        mask = swap | (sinNeg << 1) | (cosNeg << 2);
        return (xr, mask);
    }

    /**
     * @notice Decodes the original quadrant from the bitmask produced by reduceAngle.
     * @dev Mapping:
     *        mask = 0 → Q0
     *        mask = 5 → Q1
     *        mask = 6 → Q2
     *        mask = 3 → Q3
     *      Returns 0 as a fallback for invalid masks.
     *
     * @param mask Encoded quadrant information
     * @return uint8 Quadrant index in {0,1,2,3}
     */
    function _quadrant(uint8 mask) private pure returns (uint8) {
        if (mask == 0) return 0;
        if (mask == 5) return 1;
        if (mask == 6) return 2;
        if (mask == 3) return 3;
        // Should not happen; default to Q0
        return 0;
    }

    /**
     * @notice Evaluates the core sine polynomial on the reduced domain.
     * @dev Uses a truncated Taylor expansion expressed in Horner form:
     *
     *        sin(x) = x + x * z * P(z),   z = x²
     *
     *      where P(z) is a degree-5 polynomial matching the odd terms
     *      of the sine series through x¹³. The leading omitted term is -x¹⁵/15!;
     *      its magnitude is at most about 2.1e-14 on this core interval.
     *      That is a Taylor-truncation estimate only and excludes reduction and
     *      binary128 arithmetic error.
     *
     * @param x Angle in core interval [-π/4, +π/4]
     * @return bytes16 Approximated sin(x)
     */
    function _sin_poly(bytes16 x) internal pure returns (bytes16) {
        bytes16 z = MathLib.mul(x, x); // z = x^2

        // Coefficients for P(z): c1..c6  (for x^3..x^13 terms)
        // P(z) = c1 + c2*z + c3*z^2 + c4*z^3 + c5*z^4 + c6*z^5
        //
        // c1 = -1/3!
        // c2 =  1/5!
        // c3 = -1/7!
        // c4 =  1/9!
        // c5 = -1/11!
        // c6 =  1/13!

        // Horner: y = c6; y = c5 + z*y; ...; y = c1 + z*y;
        bytes16 y = SIN_C6;
        y = MathLib.add(SIN_C5, MathLib.mul(z, y));
        y = MathLib.add(SIN_C4, MathLib.mul(z, y));
        y = MathLib.add(SIN_C3, MathLib.mul(z, y));
        y = MathLib.add(SIN_C2, MathLib.mul(z, y));
        y = MathLib.add(SIN_C1, MathLib.mul(z, y));

        // sin(x) ≈ x + x*z*y
        bytes16 xz = MathLib.mul(x, z);
        bytes16 corr = MathLib.mul(xz, y);
        return MathLib.add(x, corr);
    }

    /**
     * @notice Evaluates the core cosine polynomial on the reduced domain.
     * @dev Uses a truncated Taylor expansion expressed in Horner form:
     *
     *        cos(x) = 1 + z * Q(z),   z = x²
     *
     *      where Q(z) is a degree-5 polynomial matching the even cosine
     *      terms through x¹². The leading omitted term is x¹⁴/14!;
     *      its magnitude is at most about 3.9e-13 on this core interval.
     *      That is a Taylor-truncation estimate only and excludes reduction and
     *      binary128 arithmetic error.
     *
     * @param x Angle in core interval [-π/4, +π/4]
     * @return bytes16 Approximated cos(x)
     */
    function _cos_poly(bytes16 x) internal pure returns (bytes16) {
        bytes16 z = MathLib.mul(x, x); // z = x^2

        // Q(z) = d1 + d2*z + d3*z^2 + d4*z^3 + d5*z^4 + d6*z^5
        //
        // d1 = -1/2!
        // d2 =  1/4!
        // d3 = -1/6!
        // d4 =  1/8!
        // d5 = -1/10!
        // d6 =  1/12!

        // Horner: q = d6; q = d5 + z*q; ...; q = d1 + z*q;
        bytes16 q = COS_C6;
        q = MathLib.add(COS_C5, MathLib.mul(z, q));
        q = MathLib.add(COS_C4, MathLib.mul(z, q));
        q = MathLib.add(COS_C3, MathLib.mul(z, q));
        q = MathLib.add(COS_C2, MathLib.mul(z, q));
        q = MathLib.add(COS_C1, MathLib.mul(z, q));

        // cos(x) ≈ 1 + z*q
        bytes16 zq = MathLib.mul(z, q);
        return MathLib.add(ONE, zq);
    }

    /**
     * @dev Evaluates both core Taylor polynomials with a single x² calculation.
     *      The coefficients and Horner operation order match _sin_poly and
     *      _cos_poly exactly; the shared sincos A/B regression asserts
     *      bit-identical results against separate calls.
     */
    function _sincos_poly(bytes16 x) private pure returns (bytes16 sinValue, bytes16 cosValue) {
        bytes16 z = MathLib.mul(x, x);

        bytes16 sinAccumulator = SIN_C6;
        sinAccumulator = MathLib.add(SIN_C5, MathLib.mul(z, sinAccumulator));
        sinAccumulator = MathLib.add(SIN_C4, MathLib.mul(z, sinAccumulator));
        sinAccumulator = MathLib.add(SIN_C3, MathLib.mul(z, sinAccumulator));
        sinAccumulator = MathLib.add(SIN_C2, MathLib.mul(z, sinAccumulator));
        sinAccumulator = MathLib.add(SIN_C1, MathLib.mul(z, sinAccumulator));
        sinValue = MathLib.add(x, MathLib.mul(MathLib.mul(x, z), sinAccumulator));

        bytes16 cosAccumulator = COS_C6;
        cosAccumulator = MathLib.add(COS_C5, MathLib.mul(z, cosAccumulator));
        cosAccumulator = MathLib.add(COS_C4, MathLib.mul(z, cosAccumulator));
        cosAccumulator = MathLib.add(COS_C3, MathLib.mul(z, cosAccumulator));
        cosAccumulator = MathLib.add(COS_C2, MathLib.mul(z, cosAccumulator));
        cosAccumulator = MathLib.add(COS_C1, MathLib.mul(z, cosAccumulator));
        cosValue = MathLib.add(ONE, MathLib.mul(z, cosAccumulator));
    }

    /**
     * @notice Computes a paired binary128 sine/cosine approximation.
     * @dev Shares validation, range reduction, complementary mapping, and x² for
     *      consumers that require both values. Standalone sin and cos preserve
     *      their established paths. The A/B tests prove parity with those paths.
     */
    function sincos(bytes16 x) internal pure returns (bytes16 sinX, bytes16 cosX) {
        // Preserve sin's signed zero and cos's positive-one behavior.
        if (MathLib.isZero(x)) return (x, ONE);

        (bytes16 xr, uint8 mask) = reduceAngle(x);

        if (MathLib.isZero(xr)) {
            uint8 q = _quadrant(mask);
            if (q == 0) return (QZERO, ONE);
            if (q == 1) return (ONE, QZERO);
            if (q == 2) return (QZERO, MathLib.neg(ONE));
            return (MathLib.neg(ONE), QZERO);
        }

        bool swap = (mask & 1) != 0;
        bytes16 axr = MathLib.abs(xr);
        if (MathLib.cmp(axr, QC.QUARTER_PI()) > 0) {
            bytes16 mapped = MathLib.sub(QC.HALF_PI(), axr);
            if (MathLib.cmp(xr, QZERO) < 0) mapped = MathLib.neg(mapped);
            xr = mapped;
            swap = !swap;
        }

        (bytes16 sinCore, bytes16 cosCore) = _sincos_poly(xr);
        sinX = swap ? cosCore : sinCore;
        cosX = swap ? sinCore : cosCore;

        if ((mask & 2) != 0) sinX = MathLib.neg(sinX);
        if ((mask & 4) != 0) cosX = MathLib.neg(cosX);
    }

    // ------------------------------------------------------------
    // sin(x)
    // ------------------------------------------------------------
    /**
     * @notice Computes a binary128-encoded approximation of sin(x).
     * @dev Procedure:
     *        (1) reduceAngle → core domain and mask
     *        (2) handle exact multiples of π/2
     *        (3) optionally map to complementary angle if |xr| > π/4
     *        (4) select sin or cos polynomial via mask bit0
     *        (5) apply quadrant sign adjustment (bit1)
     *
     *      Accepts only finite |x| ≤ 2^32 radians; other inputs revert before
     *      reduction. This is not a broad binary128-domain angle reducer.
     *
     * @param x Input angle (bytes16)
     * @return bytes16 Approximation of sin(x), encoded as binary128
     */
    function sin(bytes16 x) internal pure returns (bytes16) {
        // Preserve the sign bit required by odd-function signed-zero semantics.
        if (MathLib.isZero(x)) return x;

        // 1) Range reduction → xr in [-π/2, π/2], mask holds swap/sign info
        (bytes16 xr, uint8 mask) = reduceAngle(x);

        // 2) Special case: exact multiples of π/2
        //    xr == 0 => x = k * (π/2)
        if (MathLib.isZero(xr)) {
            uint8 q = _quadrant(mask);
            if (q == 1) return MathLib.fromUInt(1); // +π/2, 5π/2, ...
            if (q == 3) return MathLib.neg(MathLib.fromUInt(1)); // -π/2, 3π/2, ...
            return QZERO; // 0, π, 2π, ...
        }

        bool swap = (mask & 1) != 0; // bit0
        bool sinNeg = (mask & 2) != 0; // bit1

        // 3) Core mapping: |xr| > π/4 → use complementary angle
        //    xr' = sign(xr) * (π/2 - |xr|)
        bytes16 axr = MathLib.abs(xr);
        if (MathLib.cmp(axr, QC.QUARTER_PI()) > 0) {
            bytes16 newxr = MathLib.sub(QC.HALF_PI(), axr);
            if (MathLib.cmp(xr, QZERO) < 0) {
                newxr = MathLib.neg(newxr);
            }
            xr = newxr;
            swap = !swap; // toggle: sin ↔ cos
        }

        // 4) Evaluate appropriate polynomial in core domain [-π/4, +π/4]
        bytes16 y = swap ? _cos_poly(xr) : _sin_poly(xr);

        // 5) Apply final sign from quadrant
        if (sinNeg) {
            y = MathLib.neg(y);
        }

        return y;
    }

    // ------------------------------------------------------------
    // cos(x)
    // ------------------------------------------------------------
    /**
     * @notice Computes a binary128-encoded approximation of cos(x).
     * @dev Procedure mirrors sin(x):
     *        (1) reduceAngle → core domain and mask
     *        (2) handle exact multiples of π/2
     *        (3) complementary mapping when |xr| > π/4
     *        (4) evaluate appropriate polynomial via swap bit
     *        (5) apply cosine sign from mask bit2
     *
     *      Accepts only finite |x| ≤ 2^32 radians; other inputs revert before
     *      reduction. This is not a broad binary128-domain angle reducer.
     *
     * @param x Input angle (bytes16)
     * @return bytes16 Approximation of cos(x), encoded as binary128
     */
    function cos(bytes16 x) internal pure returns (bytes16) {
        // 1) Range reduction
        (bytes16 xr, uint8 mask) = reduceAngle(x);

        // 2) Special case: exact multiples of π/2
        if (MathLib.isZero(xr)) {
            uint8 q = _quadrant(mask);
            if (q == 0) return MathLib.fromUInt(1); // 0, 2π, ...
            if (q == 2) return MathLib.neg(MathLib.fromUInt(1)); // π, 3π, ...
            return QZERO; // ±π/2, ...
        }

        bool swap = (mask & 1) != 0; // bit0
        bool cosNeg = (mask & 4) != 0; // bit2

        // 3) Core mapping to [-π/4, +π/4]
        bytes16 axr = MathLib.abs(xr);
        if (MathLib.cmp(axr, QC.QUARTER_PI()) > 0) {
            bytes16 newxr = MathLib.sub(QC.HALF_PI(), axr);
            if (MathLib.cmp(xr, QZERO) < 0) {
                newxr = MathLib.neg(newxr);
            }
            xr = newxr;
            swap = !swap; // cos ↔ sin
        }

        // 4) Evaluate polynomial
        bytes16 y = swap ? _sin_poly(xr) : _cos_poly(xr);

        // 5) Quadrant sign
        if (cosNeg) {
            y = MathLib.neg(y);
        }

        return y;
    }
}
