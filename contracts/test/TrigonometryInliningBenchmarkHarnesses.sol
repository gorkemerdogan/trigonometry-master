// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {LinkedTrigonometrySinCos as LinkedTSC} from "./linked/LinkedTrigonometrySinCos.sol";
import {LinkedTrigonometryTanCot as LinkedTTC} from "./linked/LinkedTrigonometryTanCot.sol";
import {LinkedTrigonometryArc as LinkedTA} from "./linked/LinkedTrigonometryArc.sol";
import {TrigonometrySinCos as ProductionTSC} from "../libraries/TrigonometrySinCos.sol";
import {TrigonometryTanCot as ProductionTTC} from "../libraries/TrigonometryTanCot.sol";
import {TrigonometryArc as ProductionTA} from "../libraries/TrigonometryArc.sol";

/** @notice Frozen pre-inlining linked behavior with the seven production selectors. */
contract LinkedTrigonometryFacetShape {
    function sin(bytes16 x) external pure returns (bytes16) { return LinkedTSC.sin(x); }
    function cos(bytes16 x) external pure returns (bytes16) { return LinkedTSC.cos(x); }
    function tan(bytes16 x) external pure returns (bytes16) { return LinkedTTC.tan(x); }
    function cot(bytes16 x) external pure returns (bytes16) { return LinkedTTC.cot(x); }
    function asin(bytes16 x) external pure returns (bytes16) { return LinkedTA.asin(x); }
    function acos(bytes16 x) external pure returns (bytes16) { return LinkedTA.acos(x); }
    function atan(bytes16 x) external pure returns (bytes16) { return LinkedTA.atan(x); }
}

/** @notice Frozen linked behavior with an additional test-only paired selector. */
contract LinkedTrigonometryInliningBenchmarkHarness {
    function sin(bytes16 x) external pure returns (bytes16) { return LinkedTSC.sin(x); }
    function cos(bytes16 x) external pure returns (bytes16) { return LinkedTSC.cos(x); }
    function tan(bytes16 x) external pure returns (bytes16) { return LinkedTTC.tan(x); }
    function cot(bytes16 x) external pure returns (bytes16) { return LinkedTTC.cot(x); }
    function asin(bytes16 x) external pure returns (bytes16) { return LinkedTA.asin(x); }
    function acos(bytes16 x) external pure returns (bytes16) { return LinkedTA.acos(x); }
    function atan(bytes16 x) external pure returns (bytes16) { return LinkedTA.atan(x); }
    function sincos(bytes16 x) external pure returns (bytes16, bytes16) { return LinkedTSC.sincos(x); }
}

/** @notice Real production behavior with an additional test-only paired selector. */
contract InlinedTrigonometryBenchmarkHarness {
    function sin(bytes16 x) external pure returns (bytes16) { return ProductionTSC.sin(x); }
    function cos(bytes16 x) external pure returns (bytes16) { return ProductionTSC.cos(x); }
    function tan(bytes16 x) external pure returns (bytes16) { return ProductionTTC.tan(x); }
    function cot(bytes16 x) external pure returns (bytes16) { return ProductionTTC.cot(x); }
    function asin(bytes16 x) external pure returns (bytes16) { return ProductionTA.asin(x); }
    function acos(bytes16 x) external pure returns (bytes16) { return ProductionTA.acos(x); }
    function atan(bytes16 x) external pure returns (bytes16) { return ProductionTA.atan(x); }
    function sincos(bytes16 x) external pure returns (bytes16, bytes16) { return ProductionTSC.sincos(x); }
}
