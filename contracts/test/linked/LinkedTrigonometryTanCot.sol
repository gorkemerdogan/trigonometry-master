// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import { MathLib } from "../../libraries/MathLib.sol";
import { LinkedTrigonometrySinCos as TSC } from "./LinkedTrigonometrySinCos.sol";

/**
 * @title  TrigonometryTanCot
 * @notice Tangent and cotangent using IEEE-754 binary128 (bytes16) arithmetic.
 *         Uses the finite sine/cosine approximations from TrigonometrySinCos and
 *         applies domain checks for singularities where results are undefined.
 */
library LinkedTrigonometryTanCot {

    bytes16 internal constant QZERO = 0x00000000000000000000000000000000;
    bytes16 internal constant QNAN  = 0x7fff8000000000000000000000000000;
    // 2^-112, the binary128 unit in the last place around 1. This is a
    // denominator guard for exact/near-exact poles, not an accuracy bound.
    bytes16 internal constant TINY  = 0x3F8F0000000000000000000000000000;

    /// @dev Exposes the exact pole guard to test-only harnesses without changing public APIs.
    function poleThreshold() internal pure returns (bytes16) {
        return TINY;
    }

    // ------------------------------------------------------------
    // tan(x)
    // ------------------------------------------------------------
    /**
     * @notice Computes a binary128-encoded approximation of tan(x).
     * @dev Implementation:
     *        tan(x) = sin(x) / cos(x).
     *
     *      Domain notes:
     *        - Accepts only finite |x| ≤ 2^32 radians; invalid or out-of-range
     *          inputs revert in the shared sine/cosine reducer.
     *        - Returns QNAN when cos(x) ≈ 0 (undefined).
     *
     *      Error is determined by the underlying sine/cosine approximations,
     *      range reduction, and division; it can increase near poles. Binary128
     *      storage does not imply binary128-level function accuracy.
     *
     * @param x Input angle (bytes16)
     * @return bytes16 Approximation of tan(x), or QNAN if undefined
     */
    function tan(bytes16 x) internal pure returns (bytes16) {
        (bytes16 s, bytes16 c) = TSC.sincos(x);

        if (MathLib.isNaN(s) || MathLib.isNaN(c)) return QNAN;

        // tan undefined when cos ≈ 0
        if (MathLib.cmp(MathLib.abs(c), TINY) < 0)
            return QNAN;

        return MathLib.div(s, c);
    }

    // ------------------------------------------------------------
    // cot(x)
    // ------------------------------------------------------------
    /**
     * @notice Computes a binary128-encoded approximation of cot(x).
     * @dev Implementation:
     *        cot(x) = cos(x) / sin(x).
     *
     *      Domain notes:
     *        - Accepts only finite |x| ≤ 2^32 radians; invalid or out-of-range
     *          inputs revert in the shared sine/cosine reducer.
     *        - Returns QNAN when sin(x) ≈ 0 (undefined).
     *
     *      Error is determined by the underlying sine/cosine approximations,
     *      range reduction, and division; it can increase near poles. Binary128
     *      storage does not imply binary128-level function accuracy.
     *
     * @param x Input angle (bytes16)
     * @return bytes16 Approximation of cot(x), or QNAN if undefined
     */
    function cot(bytes16 x) internal pure returns (bytes16) {
        (bytes16 s, bytes16 c) = TSC.sincos(x);

        if (MathLib.isNaN(s) || MathLib.isNaN(c)) return QNAN;

        // cot undefined when sin ≈ 0
        if (MathLib.cmp(MathLib.abs(s), TINY) < 0)
            return QNAN;

        return MathLib.div(c, s);
    }
}
