// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {MathLib} from "../libraries/MathLib.sol";
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

/** @notice Candidate that invokes the production shared sincos implementation. */
contract SharedSinCosBenchmarkHarness is SinCosWorkloadBenchmarkBase {
    function _evaluateSinCos(bytes16 x) internal pure override returns (bytes16 s, bytes16 c) {
        return TSC.sincos(x);
    }
}
