// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {MathLib} from "../libraries/MathLib.sol";
import {QuadConstants as QC} from "../libraries/QuadConstants.sol";
import {TrigonometrySinCos as TSC} from "../libraries/TrigonometrySinCos.sol";

/**
 * @notice Common test-only workloads used to compare separate and shared sin/cos paths.
 * @dev Keeping the downstream operations in one base contract makes the only intentional
 *      A/B difference the implementation of _evaluateSinCos.
 */
abstract contract SinCosWorkloadBenchmarkBase {
    bytes16 internal constant QNAN = 0x7fff8000000000000000000000000000;
    bytes16 internal constant POLE_TINY = 0x3f8f0000000000000000000000000000;

    function _evaluateSinCos(bytes16 x) internal pure virtual returns (bytes16 s, bytes16 c);

    function pair(bytes16 x) external pure returns (bytes16 s, bytes16 c) {
        return _evaluateSinCos(x);
    }

    function tanLike(bytes16 x) external pure returns (bytes16) {
        (bytes16 s, bytes16 c) = _evaluateSinCos(x);
        if (MathLib.isNaN(s) || MathLib.isNaN(c)) return QNAN;
        if (MathLib.cmp(MathLib.abs(c), POLE_TINY) < 0) return QNAN;
        return MathLib.div(s, c);
    }

    function cotLike(bytes16 x) external pure returns (bytes16) {
        (bytes16 s, bytes16 c) = _evaluateSinCos(x);
        if (MathLib.isNaN(s) || MathLib.isNaN(c)) return QNAN;
        if (MathLib.cmp(MathLib.abs(s), POLE_TINY) < 0) return QNAN;
        return MathLib.div(c, s);
    }

    /**
     * @notice Three bounded asin-style Newton refinements from an externally supplied seed.
     * @dev Mirrors the repeated sin/cos portion of TrigonometryArc.asin without including
     *      its initial polynomial approximation, which is unrelated to this benchmark.
     */
    function asinNewton3(bytes16 target, bytes16 initial) external pure returns (bytes16 y) {
        y = initial;
        bytes16 tiny = MathLib.div(MathLib.fromUInt(1), MathLib.fromUInt(1_000_000));
        for (uint8 i = 0; i < 3; ++i) {
            (bytes16 s, bytes16 c) = _evaluateSinCos(y);
            if (MathLib.cmp(MathLib.abs(c), tiny) <= 0) break;
            bytes16 delta = MathLib.div(MathLib.sub(s, target), c);
            y = MathLib.sub(y, delta);
        }
    }
}

/** @notice Baseline that invokes the current production sin and cos paths independently. */
contract SeparateSinCosBenchmarkHarness is SinCosWorkloadBenchmarkBase {
    function _evaluateSinCos(bytes16 x) internal pure override returns (bytes16 s, bytes16 c) {
        s = TSC.sin(x);
        c = TSC.cos(x);
    }
}

/**
 * @notice Candidate path that shares reduction, core mapping, and x² across both results.
 * @dev The constants and Horner order exactly match TrigonometrySinCos.
 */
contract SharedSinCosBenchmarkHarness is SinCosWorkloadBenchmarkBase {
    bytes16 internal constant QZERO = 0x00000000000000000000000000000000;
    bytes16 internal constant ONE = 0x3fff0000000000000000000000000000;

    bytes16 internal constant SIN_C1 = 0xbffc5555555555555555555555555555;
    bytes16 internal constant SIN_C2 = 0x3ff81111111111111111111111111111;
    bytes16 internal constant SIN_C3 = 0xbff2a01a01a01a01a01a01a01a01a01a;
    bytes16 internal constant SIN_C4 = 0x3fec71de3a556c7338faac1c88e50017;
    bytes16 internal constant SIN_C5 = 0xbfe5ae64567f544e38fe747e4b837dc7;
    bytes16 internal constant SIN_C6 = 0x3fde6124613a86d097ca38331d23af68;

    bytes16 internal constant COS_C1 = 0xbffe0000000000000000000000000000;
    bytes16 internal constant COS_C2 = 0x3ffa5555555555555555555555555555;
    bytes16 internal constant COS_C3 = 0xbff56c16c16c16c16c16c16c16c16c16;
    bytes16 internal constant COS_C4 = 0x3fefa01a01a01a01a01a01a01a01a01a;
    bytes16 internal constant COS_C5 = 0xbfe927e4fb7789f5c72ef016d3ea6678;
    bytes16 internal constant COS_C6 = 0x3fe21eed8eff8d897b544da987acfe84;

    function _quadrant(uint8 mask) private pure returns (uint8) {
        if (mask == 0) return 0;
        if (mask == 5) return 1;
        if (mask == 6) return 2;
        if (mask == 3) return 3;
        return 0;
    }

    function _corePair(bytes16 x) private pure returns (bytes16 sinValue, bytes16 cosValue) {
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

    function _evaluateSinCos(bytes16 x) internal pure override returns (bytes16 s, bytes16 c) {
        // Preserve production signed-zero behavior without running reduction for cos.
        if (MathLib.isZero(x)) return (x, ONE);

        (bytes16 xr, uint8 mask) = TSC.reduceAngle(x);

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

        (bytes16 sinCore, bytes16 cosCore) = _corePair(xr);
        s = swap ? cosCore : sinCore;
        c = swap ? sinCore : cosCore;

        if ((mask & 2) != 0) s = MathLib.neg(s);
        if ((mask & 4) != 0) c = MathLib.neg(c);
    }
}
