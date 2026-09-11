// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {ABDKMathQuad} from "abdk-libraries-solidity/ABDKMathQuad.sol";

/**
 * @title TrigMath
 * @notice Internal arithmetic façade used by the production trigonometry libraries.
 * @dev Keeping these wrappers internal lets the compiler share and optimize ABDK code inside
 *      the consuming facet without scattering direct ABDK calls across the trig algorithms.
 */
library TrigMath {
    function add(bytes16 a, bytes16 b) internal pure returns (bytes16) {
        return ABDKMathQuad.add(a, b);
    }

    function sub(bytes16 a, bytes16 b) internal pure returns (bytes16) {
        return ABDKMathQuad.sub(a, b);
    }

    function mul(bytes16 a, bytes16 b) internal pure returns (bytes16) {
        return ABDKMathQuad.mul(a, b);
    }

    function div(bytes16 a, bytes16 b) internal pure returns (bytes16) {
        return ABDKMathQuad.div(a, b);
    }

    function sqrt(bytes16 a) internal pure returns (bytes16) {
        return ABDKMathQuad.sqrt(a);
    }

    function neg(bytes16 a) internal pure returns (bytes16) {
        return ABDKMathQuad.neg(a);
    }

    function abs(bytes16 a) internal pure returns (bytes16) {
        return ABDKMathQuad.abs(a);
    }

    function cmp(bytes16 a, bytes16 b) internal pure returns (int256) {
        return ABDKMathQuad.cmp(a, b);
    }

    function isNaN(bytes16 a) internal pure returns (bool) {
        return ABDKMathQuad.isNaN(a);
    }

    function isZero(bytes16 x) internal pure returns (bool) {
        return (uint128(x) & 0x7fffffffffffffffffffffffffffffff) == 0;
    }

    function fromInt(int256 value) internal pure returns (bytes16) {
        return ABDKMathQuad.fromInt(value);
    }

    function fromUInt(uint256 value) internal pure returns (bytes16) {
        return ABDKMathQuad.fromUInt(value);
    }

    function toInt(bytes16 value) internal pure returns (int256) {
        return ABDKMathQuad.toInt(value);
    }
}
