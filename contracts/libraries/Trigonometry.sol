// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import { TrigonometrySinCos as TSC } from "./TrigonometrySinCos.sol";
import { TrigonometryTanCot as TT } from "./TrigonometryTanCot.sol";
import { TrigonometryArc as TA } from "./TrigonometryArc.sol";

/**
 * @title Trigonometry Library
 * @notice Trigonometric utilities using binary128 arithmetic and internal
 *         sine/cosine, tangent/cotangent, and arc-function approximation modules.
 *         Direct trigonometric functions accept only finite angles with
 *         |x| ≤ 2^32 radians under the current quotient-based reducer.
 */
library Trigonometry {

    /**
     * @notice Computes sin(x) using binary128 arithmetic.
     *         Reverts unless x is finite and |x| ≤ 2^32 radians.
     * @param x Input angle in radians (bytes16)
     * @return bytes16 Sine of x
     */
    function sin(bytes16 x) internal pure returns (bytes16) {
        return TSC.sin(x);
    }

    /**
     * @notice Computes cos(x) using binary128 arithmetic.
     *         Reverts unless x is finite and |x| ≤ 2^32 radians.
     * @param x Input angle in radians (bytes16)
     * @return bytes16 Cosine of x
     */
    function cos(bytes16 x) internal pure returns (bytes16) {
        return TSC.cos(x);
    }

    /**
     * @notice Computes tan(x) using binary128 arithmetic.
     *         Reverts unless x is finite and |x| ≤ 2^32 radians; returns NaN
     *         for an in-range point where tangent is undefined.
     * @param x Input angle in radians (bytes16)
     * @return bytes16 Tangent of x
     */
    function tan(bytes16 x) internal pure returns (bytes16) {
        return TT.tan(x);
    }

    /**
     * @notice Computes cot(x) using binary128 arithmetic.
     *         Reverts unless x is finite and |x| ≤ 2^32 radians; returns NaN
     *         for an in-range point where cotangent is undefined.
     * @param x Input angle in radians (bytes16)
     * @return bytes16 Cotangent of x
     */
    function cot(bytes16 x) internal pure returns (bytes16) {
        return TT.cot(x);
    }

    /**
     * @notice Computes arcsin(x) using binary128 arithmetic.
     *         Returns NaN for NaN, infinity, or a finite x outside [-1, 1].
     * @param x Input value (bytes16)
     * @return bytes16 arcsin(x) in radians
     */
    function asin(bytes16 x) internal pure returns (bytes16) {
        return TA.asin(x);
    }

    /**
     * @notice Computes arccos(x) using binary128 arithmetic.
     *         Returns NaN for NaN, infinity, or a finite x outside [-1, 1].
     * @param x Input value (bytes16)
     * @return bytes16 arccos(x) in radians
     */
    function acos(bytes16 x) internal pure returns (bytes16) {
        return TA.acos(x);
    }

    /**
     * @notice Computes arctan(x) using binary128 arithmetic.
     *         Returns NaN for NaN and signed π/2 for signed infinity.
     * @param x Input value (bytes16)
     * @return bytes16 arctan(x) in radians
     */
    function atan(bytes16 x) internal pure returns (bytes16) {
        return TA.atan(x);
    }
}
