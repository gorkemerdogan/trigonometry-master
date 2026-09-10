// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import { TrigonometrySinCos as TSC } from "../libraries/TrigonometrySinCos.sol";
import { TrigonometryTanCot as TTC } from "../libraries/TrigonometryTanCot.sol";
import { TrigonometryArc as TA } from "../libraries/TrigonometryArc.sol";
import { QuadConstants as QC } from "../libraries/QuadConstants.sol";

/**
 * @notice Test-only entry points that preserve raw binary128 inputs and outputs.
 * @dev The core functions bypass range reduction so polynomial truncation can be
 *      measured independently from public-function quadrant handling.
 */
contract TrigonometryHighResolutionHarness {
    function sinCore(bytes16 x) external pure returns (bytes16) {
        return TSC._sin_poly(x);
    }

    function cosCore(bytes16 x) external pure returns (bytes16) {
        return TSC._cos_poly(x);
    }

    function sin(bytes16 x) external pure returns (bytes16) {
        return TSC.sin(x);
    }

    function cos(bytes16 x) external pure returns (bytes16) {
        return TSC.cos(x);
    }

    function asin(bytes16 x) external pure returns (bytes16) {
        return TA.asin(x);
    }

    function atan(bytes16 x) external pure returns (bytes16) {
        return TA.atan(x);
    }

    function poleThreshold() external pure returns (bytes16) {
        return TTC.poleThreshold();
    }

    function eps1e30() external pure returns (bytes16) {
        return QC.EPS_1e30();
    }

    function halfPi() external pure returns (bytes16) {
        return QC.HALF_PI();
    }
}
