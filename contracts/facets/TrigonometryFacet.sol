// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import { TrigonometrySinCos as TSC } from "../libraries/TrigonometrySinCos.sol";
import { TrigonometryTanCot as TTC } from "../libraries/TrigonometryTanCot.sol";
import { TrigonometryArc as TA } from "../libraries/TrigonometryArc.sol";

/**
 * @title TrigonometryFacet
 * @notice Facet exposing high-precision trigonometric functions that operate on
 *         IEEE-754 quadruple-precision (bytes16) values.
 *         All functions are pure passthroughs: sin, cos, tan, cot, asin, acos, and atan.
 */
contract TrigonometryFacet {
    function sin(bytes16 x) external pure returns (bytes16) {
        return TSC.sin(x);
    }

    function cos(bytes16 x) external pure returns (bytes16) {
        return TSC.cos(x);
    }

    function tan(bytes16 x) external pure returns (bytes16) {
        return TTC.tan(x);
    }

    function cot(bytes16 x) external pure returns (bytes16) {
        return TTC.cot(x);
    }

    function asin(bytes16 x) external pure returns (bytes16) {
        return TA.asin(x);
    }

    function acos(bytes16 x) external pure returns (bytes16) {
        return TA.acos(x);
    }

    function atan(bytes16 x) external pure returns (bytes16) {
        return TA.atan(x);
    }
}