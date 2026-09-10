// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import { TrigonometrySinCos as TSC } from "../libraries/TrigonometrySinCos.sol";

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
}
