// SPDX-License-Identifier: MIT
import { expect } from "chai";
import { ethers } from "hardhat";
import type { Contract } from "ethers";
import {
    compareFiniteBinary128,
    isFiniteBinary128,
    isNaNBinary128,
    nextDownBinary128,
    nextUpBinary128,
    ulpDistance,
} from "./helpers/binary128";

type Trigonometry = Contract & {
    sin(x: string): Promise<string>;
    cos(x: string): Promise<string>;
    tan(x: string): Promise<string>;
    cot(x: string): Promise<string>;
    asin(x: string): Promise<string>;
    acos(x: string): Promise<string>;
    atan(x: string): Promise<string>;
};

const POSITIVE_ZERO = "0x00000000000000000000000000000000";
const NEGATIVE_ZERO = "0x80000000000000000000000000000000";
const MIN_SUBNORMAL = "0x00000000000000000000000000000001";
const NEGATIVE_MIN_SUBNORMAL = "0x80000000000000000000000000000001";
const ONE = "0x3fff0000000000000000000000000000";
const NEGATIVE_ONE = "0xbfff0000000000000000000000000000";
const HALF_PI = "0x3fff921fb54442d18469898cc51701b8";
const NEGATIVE_HALF_PI = "0xbfff921fb54442d18469898cc51701b8";
const PI = "0x4000921fb54442d18469898cc51701b8";
const MAX_ARGUMENT = "0x401f0000000000000000000000000000";
const NEGATIVE_MAX_ARGUMENT = "0xc01f0000000000000000000000000000";
const MAX_FINITE = "0x7ffeffffffffffffffffffffffffffff";
const NEGATIVE_MAX_FINITE = "0xfffeffffffffffffffffffffffffffff";
const POSITIVE_INFINITY = "0x7fff0000000000000000000000000000";
const NEGATIVE_INFINITY = "0xffff0000000000000000000000000000";
const CANONICAL_NAN = "0x7fff8000000000000000000000000000";
const POLE_THRESHOLD = "0x3f8f0000000000000000000000000000";

const NAN_PAYLOADS = [
    "0x7fff0000000000000000000000000001",
    "0x7fff8000000000000000000000001234",
    "0xffff800000000000000000000000abcd",
];

function absoluteEncoding(value: string): string {
    const raw = BigInt(value) & ((1n << 127n) - 1n);
    return `0x${raw.toString(16).padStart(32, "0")}`;
}

function expectInRange(actual: string, lower: string, upper: string, context: string): void {
    expect(isFiniteBinary128(actual), `${context}: expected a finite result`).to.equal(true);
    expect(compareFiniteBinary128(actual, lower), `${context}: below lower bound`).to.be.gte(0);
    expect(compareFiniteBinary128(actual, upper), `${context}: above upper bound`).to.be.lte(0);
}

describe("Trigonometry raw binary128 edge cases", function () {
    let trig: Trigonometry;

    before(async function () {
        const factory = await ethers.getContractFactory("TrigonometryFacet");
        trig = (await factory.deploy()) as unknown as Trigonometry;
        await trig.waitForDeployment();
    });

    it("orders adjacent representable values at key signed boundaries by one ULP", function () {
        for (const center of [NEGATIVE_ONE, NEGATIVE_HALF_PI, ONE, HALF_PI, PI]) {
            expect(ulpDistance(nextDownBinary128(center), center)).to.equal(1n);
            expect(ulpDistance(center, nextUpBinary128(center))).to.equal(1n);
        }

        expect(nextUpBinary128(NEGATIVE_ZERO)).to.equal(MIN_SUBNORMAL);
        expect(nextDownBinary128(POSITIVE_ZERO)).to.equal(NEGATIVE_MIN_SUBNORMAL);
    });

    it("preserves signed zero for odd functions and canonicalizes zero-valued poles", async function () {
        for (const input of [POSITIVE_ZERO, NEGATIVE_ZERO]) {
            expect(await trig.sin(input)).to.equal(input);
            expect(await trig.tan(input)).to.equal(input);
            expect(await trig.asin(input)).to.equal(input);
            expect(await trig.atan(input)).to.equal(input);
            expect(await trig.cos(input)).to.equal(ONE);
            expect(await trig.acos(input)).to.equal(HALF_PI);
            expect(await trig.cot(input)).to.equal(CANONICAL_NAN);
        }
    });

    it("classifies tangent and cotangent at and adjacent to quadrant boundaries", async function () {
        const centers = [NEGATIVE_HALF_PI, HALF_PI, PI];

        for (const center of centers) {
            for (const input of [nextDownBinary128(center), center, nextUpBinary128(center)]) {
                const sin = await trig.sin(input);
                const cos = await trig.cos(input);
                const tan = await trig.tan(input);
                const cot = await trig.cot(input);

                expect(isFiniteBinary128(sin), `sin(${input})`).to.equal(true);
                expect(isFiniteBinary128(cos), `cos(${input})`).to.equal(true);

                const tanIsPole = compareFiniteBinary128(absoluteEncoding(cos), POLE_THRESHOLD) < 0;
                const cotIsPole = compareFiniteBinary128(absoluteEncoding(sin), POLE_THRESHOLD) < 0;

                if (tanIsPole) {
                    expect(tan, `tan(${input}) pole classification`).to.equal(CANONICAL_NAN);
                } else {
                    expect(isFiniteBinary128(tan), `tan(${input}) should be finite`).to.equal(true);
                }

                if (cotIsPole) {
                    expect(cot, `cot(${input}) pole classification`).to.equal(CANONICAL_NAN);
                } else {
                    expect(isFiniteBinary128(cot), `cot(${input}) should be finite`).to.equal(true);
                }
            }
        }
    });

    it("accepts inverse inputs immediately inside the domain and rejects adjacent outside values", async function () {
        const insidePositive = nextDownBinary128(ONE);
        const outsidePositive = nextUpBinary128(ONE);
        const insideNegative = nextUpBinary128(NEGATIVE_ONE);
        const outsideNegative = nextDownBinary128(NEGATIVE_ONE);

        for (const input of [insideNegative, NEGATIVE_ONE, ONE, insidePositive]) {
            expectInRange(await trig.asin(input), NEGATIVE_HALF_PI, HALF_PI, `asin(${input})`);
            expectInRange(await trig.acos(input), POSITIVE_ZERO, PI, `acos(${input})`);
        }

        for (const input of [outsideNegative, outsidePositive]) {
            expect(await trig.asin(input), `asin(${input})`).to.equal(CANONICAL_NAN);
            expect(await trig.acos(input), `acos(${input})`).to.equal(CANONICAL_NAN);
        }
    });

    it("handles subnormals, infinities, largest finite values, and NaN payloads by policy", async function () {
        for (const input of [MIN_SUBNORMAL, NEGATIVE_MIN_SUBNORMAL]) {
            expect(await trig.sin(input)).to.equal(input);
            expect(await trig.tan(input)).to.equal(input);
            expect(await trig.asin(input)).to.equal(input);
            expect(await trig.atan(input)).to.equal(input);
            expect(await trig.cos(input)).to.equal(ONE);
            expect(ulpDistance(await trig.acos(input), HALF_PI)).to.be.lte(1n);
            expect(await trig.cot(input)).to.equal(CANONICAL_NAN);
        }

        for (const input of [MAX_FINITE, NEGATIVE_MAX_FINITE]) {
            for (const name of ["sin", "cos", "tan", "cot"] as const) {
                await expect(trig[name](input), `${name}(${input})`)
                    .to.be.revertedWith("TRIG_ARGUMENT_OUT_OF_RANGE");
            }
            expect(await trig.asin(input)).to.equal(CANONICAL_NAN);
            expect(await trig.acos(input)).to.equal(CANONICAL_NAN);
        }

        expect(await trig.atan(MAX_FINITE)).to.equal(HALF_PI);
        expect(await trig.atan(NEGATIVE_MAX_FINITE)).to.equal(NEGATIVE_HALF_PI);
        expect(await trig.atan(POSITIVE_INFINITY)).to.equal(HALF_PI);
        expect(await trig.atan(NEGATIVE_INFINITY)).to.equal(NEGATIVE_HALF_PI);

        for (const input of NAN_PAYLOADS) {
            expect(isNaNBinary128(input)).to.equal(true);
            for (const name of ["sin", "cos", "tan", "cot"] as const) {
                await expect(trig[name](input), `${name}(${input})`).to.be.revertedWith("TRIG_NAN_ANGLE");
            }
            expect(await trig.asin(input)).to.equal(CANONICAL_NAN);
            expect(await trig.acos(input)).to.equal(CANONICAL_NAN);
            expect(await trig.atan(input)).to.equal(CANONICAL_NAN);
        }
    });

    it("enforces output range invariants across representative finite supported inputs", async function () {
        const directInputs = [
            POSITIVE_ZERO,
            NEGATIVE_ZERO,
            MIN_SUBNORMAL,
            NEGATIVE_MIN_SUBNORMAL,
            NEGATIVE_ONE,
            nextDownBinary128(NEGATIVE_HALF_PI),
            NEGATIVE_HALF_PI,
            nextUpBinary128(NEGATIVE_HALF_PI),
            ONE,
            nextDownBinary128(HALF_PI),
            HALF_PI,
            nextUpBinary128(HALF_PI),
            nextDownBinary128(PI),
            PI,
            nextUpBinary128(PI),
            MAX_ARGUMENT,
            NEGATIVE_MAX_ARGUMENT,
        ];

        for (const input of directInputs) {
            expectInRange(await trig.sin(input), NEGATIVE_ONE, ONE, `sin(${input})`);
            expectInRange(await trig.cos(input), NEGATIVE_ONE, ONE, `cos(${input})`);
        }

        for (const input of [NEGATIVE_ONE, nextUpBinary128(NEGATIVE_ONE), POSITIVE_ZERO,
            nextDownBinary128(ONE), ONE]) {
            expectInRange(await trig.asin(input), NEGATIVE_HALF_PI, HALF_PI, `asin(${input})`);
            expectInRange(await trig.acos(input), POSITIVE_ZERO, PI, `acos(${input})`);
        }

        for (const input of [...directInputs, MAX_FINITE, NEGATIVE_MAX_FINITE]) {
            expectInRange(await trig.atan(input), NEGATIVE_HALF_PI, HALF_PI, `atan(${input})`);
        }
    });
});
