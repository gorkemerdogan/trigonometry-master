// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {ABDKMathQuad} from "abdk-libraries-solidity/ABDKMathQuad.sol";
import {MathLib} from "../libraries/MathLib.sol";

/**
 * @notice Test-only harnesses for isolating polynomial arithmetic and coefficient costs.
 * @dev These contracts deliberately duplicate the production Horner expressions so each
 *      deployment has one unambiguous arithmetic/coefficient strategy.
 */
abstract contract SinCosPolynomialConstants {
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
}

contract LinkedRuntimePolynomialHarness {
    function sinCore(bytes16 x) external pure returns (bytes16) {
        bytes16 z = MathLib.mul(x, x);
        bytes16 c1 = MathLib.neg(MathLib.div(MathLib.fromUInt(1), MathLib.fromUInt(6)));
        bytes16 c2 = MathLib.div(MathLib.fromUInt(1), MathLib.fromUInt(120));
        bytes16 c3 = MathLib.neg(MathLib.div(MathLib.fromUInt(1), MathLib.fromUInt(5040)));
        bytes16 c4 = MathLib.div(MathLib.fromUInt(1), MathLib.fromUInt(362880));
        bytes16 c5 = MathLib.neg(MathLib.div(MathLib.fromUInt(1), MathLib.fromUInt(39916800)));
        bytes16 c6 = MathLib.div(MathLib.fromUInt(1), MathLib.fromUInt(6227020800));

        bytes16 y = c6;
        y = MathLib.add(c5, MathLib.mul(z, y));
        y = MathLib.add(c4, MathLib.mul(z, y));
        y = MathLib.add(c3, MathLib.mul(z, y));
        y = MathLib.add(c2, MathLib.mul(z, y));
        y = MathLib.add(c1, MathLib.mul(z, y));
        return MathLib.add(x, MathLib.mul(MathLib.mul(x, z), y));
    }

    function cosCore(bytes16 x) external pure returns (bytes16) {
        bytes16 z = MathLib.mul(x, x);
        bytes16 d1 = MathLib.neg(MathLib.div(MathLib.fromUInt(1), MathLib.fromUInt(2)));
        bytes16 d2 = MathLib.div(MathLib.fromUInt(1), MathLib.fromUInt(24));
        bytes16 d3 = MathLib.neg(MathLib.div(MathLib.fromUInt(1), MathLib.fromUInt(720)));
        bytes16 d4 = MathLib.div(MathLib.fromUInt(1), MathLib.fromUInt(40320));
        bytes16 d5 = MathLib.neg(MathLib.div(MathLib.fromUInt(1), MathLib.fromUInt(3628800)));
        bytes16 d6 = MathLib.div(MathLib.fromUInt(1), MathLib.fromUInt(479001600));

        bytes16 q = d6;
        q = MathLib.add(d5, MathLib.mul(z, q));
        q = MathLib.add(d4, MathLib.mul(z, q));
        q = MathLib.add(d3, MathLib.mul(z, q));
        q = MathLib.add(d2, MathLib.mul(z, q));
        q = MathLib.add(d1, MathLib.mul(z, q));
        return MathLib.add(MathLib.fromUInt(1), MathLib.mul(z, q));
    }
}

contract LinkedConstantPolynomialHarness is SinCosPolynomialConstants {
    function sinCore(bytes16 x) external pure returns (bytes16) {
        bytes16 z = MathLib.mul(x, x);
        bytes16 y = SIN_C6;
        y = MathLib.add(SIN_C5, MathLib.mul(z, y));
        y = MathLib.add(SIN_C4, MathLib.mul(z, y));
        y = MathLib.add(SIN_C3, MathLib.mul(z, y));
        y = MathLib.add(SIN_C2, MathLib.mul(z, y));
        y = MathLib.add(SIN_C1, MathLib.mul(z, y));
        return MathLib.add(x, MathLib.mul(MathLib.mul(x, z), y));
    }

    function cosCore(bytes16 x) external pure returns (bytes16) {
        bytes16 z = MathLib.mul(x, x);
        bytes16 q = COS_C6;
        q = MathLib.add(COS_C5, MathLib.mul(z, q));
        q = MathLib.add(COS_C4, MathLib.mul(z, q));
        q = MathLib.add(COS_C3, MathLib.mul(z, q));
        q = MathLib.add(COS_C2, MathLib.mul(z, q));
        q = MathLib.add(COS_C1, MathLib.mul(z, q));
        return MathLib.add(ONE, MathLib.mul(z, q));
    }
}

contract InternalRuntimePolynomialHarness {
    function sinCore(bytes16 x) external pure returns (bytes16) {
        bytes16 z = ABDKMathQuad.mul(x, x);
        bytes16 c1 = ABDKMathQuad.neg(
            ABDKMathQuad.div(ABDKMathQuad.fromUInt(1), ABDKMathQuad.fromUInt(6))
        );
        bytes16 c2 = ABDKMathQuad.div(ABDKMathQuad.fromUInt(1), ABDKMathQuad.fromUInt(120));
        bytes16 c3 = ABDKMathQuad.neg(
            ABDKMathQuad.div(ABDKMathQuad.fromUInt(1), ABDKMathQuad.fromUInt(5040))
        );
        bytes16 c4 = ABDKMathQuad.div(ABDKMathQuad.fromUInt(1), ABDKMathQuad.fromUInt(362880));
        bytes16 c5 = ABDKMathQuad.neg(
            ABDKMathQuad.div(ABDKMathQuad.fromUInt(1), ABDKMathQuad.fromUInt(39916800))
        );
        bytes16 c6 = ABDKMathQuad.div(
            ABDKMathQuad.fromUInt(1), ABDKMathQuad.fromUInt(6227020800)
        );

        bytes16 y = c6;
        y = ABDKMathQuad.add(c5, ABDKMathQuad.mul(z, y));
        y = ABDKMathQuad.add(c4, ABDKMathQuad.mul(z, y));
        y = ABDKMathQuad.add(c3, ABDKMathQuad.mul(z, y));
        y = ABDKMathQuad.add(c2, ABDKMathQuad.mul(z, y));
        y = ABDKMathQuad.add(c1, ABDKMathQuad.mul(z, y));
        return ABDKMathQuad.add(x, ABDKMathQuad.mul(ABDKMathQuad.mul(x, z), y));
    }

    function cosCore(bytes16 x) external pure returns (bytes16) {
        bytes16 z = ABDKMathQuad.mul(x, x);
        bytes16 d1 = ABDKMathQuad.neg(
            ABDKMathQuad.div(ABDKMathQuad.fromUInt(1), ABDKMathQuad.fromUInt(2))
        );
        bytes16 d2 = ABDKMathQuad.div(ABDKMathQuad.fromUInt(1), ABDKMathQuad.fromUInt(24));
        bytes16 d3 = ABDKMathQuad.neg(
            ABDKMathQuad.div(ABDKMathQuad.fromUInt(1), ABDKMathQuad.fromUInt(720))
        );
        bytes16 d4 = ABDKMathQuad.div(ABDKMathQuad.fromUInt(1), ABDKMathQuad.fromUInt(40320));
        bytes16 d5 = ABDKMathQuad.neg(
            ABDKMathQuad.div(ABDKMathQuad.fromUInt(1), ABDKMathQuad.fromUInt(3628800))
        );
        bytes16 d6 = ABDKMathQuad.div(
            ABDKMathQuad.fromUInt(1), ABDKMathQuad.fromUInt(479001600)
        );

        bytes16 q = d6;
        q = ABDKMathQuad.add(d5, ABDKMathQuad.mul(z, q));
        q = ABDKMathQuad.add(d4, ABDKMathQuad.mul(z, q));
        q = ABDKMathQuad.add(d3, ABDKMathQuad.mul(z, q));
        q = ABDKMathQuad.add(d2, ABDKMathQuad.mul(z, q));
        q = ABDKMathQuad.add(d1, ABDKMathQuad.mul(z, q));
        return ABDKMathQuad.add(ABDKMathQuad.fromUInt(1), ABDKMathQuad.mul(z, q));
    }
}

contract InternalConstantPolynomialHarness is SinCosPolynomialConstants {
    function sinCore(bytes16 x) external pure returns (bytes16) {
        bytes16 z = ABDKMathQuad.mul(x, x);
        bytes16 y = SIN_C6;
        y = ABDKMathQuad.add(SIN_C5, ABDKMathQuad.mul(z, y));
        y = ABDKMathQuad.add(SIN_C4, ABDKMathQuad.mul(z, y));
        y = ABDKMathQuad.add(SIN_C3, ABDKMathQuad.mul(z, y));
        y = ABDKMathQuad.add(SIN_C2, ABDKMathQuad.mul(z, y));
        y = ABDKMathQuad.add(SIN_C1, ABDKMathQuad.mul(z, y));
        return ABDKMathQuad.add(x, ABDKMathQuad.mul(ABDKMathQuad.mul(x, z), y));
    }

    function cosCore(bytes16 x) external pure returns (bytes16) {
        bytes16 z = ABDKMathQuad.mul(x, x);
        bytes16 q = COS_C6;
        q = ABDKMathQuad.add(COS_C5, ABDKMathQuad.mul(z, q));
        q = ABDKMathQuad.add(COS_C4, ABDKMathQuad.mul(z, q));
        q = ABDKMathQuad.add(COS_C3, ABDKMathQuad.mul(z, q));
        q = ABDKMathQuad.add(COS_C2, ABDKMathQuad.mul(z, q));
        q = ABDKMathQuad.add(COS_C1, ABDKMathQuad.mul(z, q));
        return ABDKMathQuad.add(ONE, ABDKMathQuad.mul(z, q));
    }
}
