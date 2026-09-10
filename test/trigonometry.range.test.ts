// SPDX-License-Identifier: MIT
import { expect } from "chai";
import { ethers } from "hardhat";
import type { Contract } from "ethers";

type TrigonometryHarness = Contract & {
    fromFloat(x: bigint): Promise<string>;
    toFloat(x: string): Promise<unknown>;
    isNaN(x: string): Promise<boolean>;
    sin(x: string): Promise<string>;
    cos(x: string): Promise<string>;
    tan(x: string): Promise<string>;
    cot(x: string): Promise<string>;
    QHALF_PI(): Promise<string>;
};

const SCALE = 10n ** 12n;
const MAX_ARGUMENT = 1n << 32n;
const POSITIVE_INFINITY = "0x7fff0000000000000000000000000000";
const NEGATIVE_INFINITY = "0xffff0000000000000000000000000000";
const QNAN = "0x7fff8000000000000000000000000000";
// 2^260 is finite binary128 but x / (2π) exceeds int256; it exercised the
// accidental ABDKMathQuad.toInt overflow before the explicit range guard.
const PREVIOUS_TO_INT_OVERFLOW_INPUT = "0x41030000000000000000000000000000";

function asBigInt(value: unknown): bigint {
    if (typeof value === "bigint") return value;
    return BigInt(String(value));
}

function abs(value: bigint): bigint {
    return value < 0n ? -value : value;
}

function isFiniteBinary128(value: string): boolean {
    return ((BigInt(value) >> 112n) & 0x7fffn) !== 0x7fffn;
}

describe("Trigonometry argument-reduction range validation", function () {
    let harness: TrigonometryHarness;

    before(async function () {
        const MathLibFactory = await ethers.getContractFactory("MathLib");
        const mathLib = await MathLibFactory.deploy();
        await mathLib.waitForDeployment();

        const HarnessFactory = await ethers.getContractFactory("TrigonometryHarness", {
            libraries: { MathLib: await mathLib.getAddress() },
        });
        harness = (await HarnessFactory.deploy()) as unknown as TrigonometryHarness;
        await harness.waitForDeployment();
    });

    it("accepts finite values at and immediately inside the supported boundary", async function () {
        for (const angle of [MAX_ARGUMENT - 1n, MAX_ARGUMENT, -MAX_ARGUMENT + 1n, -MAX_ARGUMENT]) {
            const input = await harness.fromFloat(angle * SCALE);
            const sin = await harness.sin(input);
            const cos = await harness.cos(input);
            const tan = await harness.tan(input);
            const cot = await harness.cot(input);

            expect(isFiniteBinary128(sin), `sin(${angle}) must remain finite`).to.equal(true);
            expect(isFiniteBinary128(cos), `cos(${angle}) must remain finite`).to.equal(true);
            expect(isFiniteBinary128(tan), `tan(${angle}) must remain finite`).to.equal(true);
            expect(isFiniteBinary128(cot), `cot(${angle}) must remain finite`).to.equal(true);
        }
    });

    it("rejects values just outside the supported range consistently", async function () {
        const aboveMaximum = await harness.fromFloat((MAX_ARGUMENT + 1n) * SCALE);
        const belowMinimum = await harness.fromFloat((-MAX_ARGUMENT - 1n) * SCALE);

        for (const input of [aboveMaximum, belowMinimum]) {
            await expect(harness.sin(input)).to.be.revertedWith("TRIG_ARGUMENT_OUT_OF_RANGE");
            await expect(harness.cos(input)).to.be.revertedWith("TRIG_ARGUMENT_OUT_OF_RANGE");
            await expect(harness.tan(input)).to.be.revertedWith("TRIG_ARGUMENT_OUT_OF_RANGE");
            await expect(harness.cot(input)).to.be.revertedWith("TRIG_ARGUMENT_OUT_OF_RANGE");
        }
    });

    it("rejects finite values that previously reached quotient-to-int overflow", async function () {
        await expect(harness.sin(PREVIOUS_TO_INT_OVERFLOW_INPUT)).to.be.revertedWith("TRIG_ARGUMENT_OUT_OF_RANGE");
        await expect(harness.cos(PREVIOUS_TO_INT_OVERFLOW_INPUT)).to.be.revertedWith("TRIG_ARGUMENT_OUT_OF_RANGE");
        await expect(harness.tan(PREVIOUS_TO_INT_OVERFLOW_INPUT)).to.be.revertedWith("TRIG_ARGUMENT_OUT_OF_RANGE");
        await expect(harness.cot(PREVIOUS_TO_INT_OVERFLOW_INPUT)).to.be.revertedWith("TRIG_ARGUMENT_OUT_OF_RANGE");
    });

    it("rejects NaN and infinity explicitly for every direct trigonometric function", async function () {
        const methods = ["sin", "cos", "tan", "cot"] as const;
        const inputs = [
            { value: QNAN, reason: "TRIG_NAN_ANGLE" },
            { value: POSITIVE_INFINITY, reason: "TRIG_INFINITE_ANGLE" },
            { value: NEGATIVE_INFINITY, reason: "TRIG_INFINITE_ANGLE" },
        ];

        for (const { value, reason } of inputs) {
            for (const method of methods) {
                await expect(harness[method](value)).to.be.revertedWith(reason);
            }
        }
    });

    it("keeps small inputs and in-range pole behavior distinct from range rejection", async function () {
        const smallInput = await harness.fromFloat(500_000_000_000n); // 0.5
        const expected = [
            ["sin", Math.sin(0.5)],
            ["cos", Math.cos(0.5)],
            ["tan", Math.tan(0.5)],
            ["cot", 1 / Math.tan(0.5)],
        ] as const;

        for (const [method, expectedValue] of expected) {
            const output = await harness[method](smallInput);
            const actual = asBigInt(await harness.toFloat(output));
            const oracle = BigInt(Math.round(expectedValue * Number(SCALE)));
            expect(abs(actual - oracle), `${method}(0.5)`).to.be.at.most(2n);
        }

        expect(await harness.isNaN(await harness.tan(await harness.QHALF_PI()))).to.equal(true);
        const zero = await harness.fromFloat(0n);
        expect(await harness.isNaN(await harness.cot(zero))).to.equal(true);
    });
});
