// SPDX-License-Identifier: MIT
import { expect } from "chai";
import { ethers } from "hardhat";
import type { Contract } from "ethers";

// ------------------------------------------------------------
// Types
// ------------------------------------------------------------

type TrigonometryHarness = Contract & {
    fromDouble(x: number | bigint): Promise<string>;
    fromUInt(x: number | bigint): Promise<string>;
    toDouble(x: string): Promise<unknown>;

    fromFloat(x: bigint): Promise<string>;
    toFloat(x: string): Promise<unknown>;

    abs(x: string): Promise<string>;
    neg(x: string): Promise<string>;
    cmp(a: string, b: string): Promise<bigint>;
    isNaN(x: string): Promise<boolean>;
    add(a: string, b: string): Promise<string>;
    mul(a: string, b: string): Promise<string>;

    sin(x: string): Promise<string>;
    cos(x: string): Promise<string>;
    tan(x: string): Promise<string>;
    cot(x: string): Promise<string>;
    asin(x: string): Promise<string>;
    acos(x: string): Promise<string>;
    atan(x: string): Promise<string>;

    QPI(): Promise<string>;
    QHALF_PI(): Promise<string>;
    QQUARTER_PI(): Promise<string>;
    QTWO_PI(): Promise<string>;
    QNAN(): Promise<string>;
};

// ------------------------------------------------------------
// Global Constants
// ------------------------------------------------------------

const NUM_CASES = 30;
const FIXED_SEED = "TRIG_MULTI_CASE_SEED_V1";

// Contract-side scaling used by TrigonometryHarness.fromFloat/toFloat.
const SCALE = 10n ** 12n;
const SCALE_NUMBER = Number(SCALE);
const EXECUTION_MODEL = "estimateGas + eth_call_result";
const EXECUTION_PATH = "harness_direct";
const GAS_MEASUREMENT = "estimateGas (callback-free transaction simulation)";
const RESULT_EXECUTION = "eth_call_result";

// Useful numeric constants in the same scaled representation.
const PI_SCALED = BigInt(Math.round(Math.PI * SCALE_NUMBER));
const HALF_PI_SCALED = PI_SCALED / 2n;
const QUARTER_PI_SCALED = PI_SCALED / 4n;
const TWO_PI_SCALED = PI_SCALED * 2n;

// Accuracy is observable only to 1e-12 through the current harness conversion.
// Relative tolerances are encoded in SCALE units (100 = 1e-10).
const IDENTITY_ABS_TOL = 2n;
const DIRECT_ABS_TOL = 2n;
const INVERSE_ABS_TOL = 5n;
const RATIO_ABS_TOL = 10n;
const ROUND_TRIP_ABS_TOL = 10n;
const DEFAULT_REL_TOL = 100n; // 1e-10.
const NEAR_ZERO_THRESHOLD = 1_000n; // 1e-9; use absolute error below this.
const POLE_EXCLUSION = 10_000_000_000n; // 0.01 radians.

// ------------------------------------------------------------
// Helper Types
// ------------------------------------------------------------

type NumericRecord = {
    actual: bigint;
    expected: bigint;
    absError: bigint;
    relErrorScaled?: bigint;
    expectedAbs: bigint;
    gas: bigint;
    caseLabel: string;
};

type AccuracyGroup = {
    name: string;
    records: NumericRecord[];
    absTolerance: bigint;
    relTolerance?: bigint;
    nearZeroThreshold?: bigint;
};

type BoolRecord = {
    ok: boolean;
    gas: bigint;
};

// ------------------------------------------------------------
// Generic Helpers
// ------------------------------------------------------------

function asBigInt(v: unknown): bigint {
    if (typeof v === "bigint") return v;
    if (typeof v === "number") return BigInt(v);
    if (typeof v === "string") return BigInt(v);

    if (v && typeof v === "object") {
        const maybeToString = (v as { toString?: () => string }).toString;
        if (typeof maybeToString === "function") {
            return BigInt(maybeToString.call(v));
        }
    }

    throw new Error(`Cannot convert value to bigint: ${String(v)}`);
}

function absBigInt(x: bigint): bigint {
    return x < 0n ? -x : x;
}

function avgBigInt(values: bigint[]): bigint {
    if (values.length === 0) return 0n;
    return values.reduce((a, b) => a + b, 0n) / BigInt(values.length);
}

function minBigInt(values: bigint[]): bigint {
    return values.reduce((a, b) => (a < b ? a : b));
}

function maxBigInt(values: bigint[]): bigint {
    return values.reduce((a, b) => (a > b ? a : b));
}

function formatScaledInt(v: bigint, decimals = 18): string {
    const neg = v < 0n;
    const abs = neg ? -v : v;
    const s = 10n ** BigInt(decimals);

    const intPart = abs / s;
    const fracPart = abs % s;
    const fracStr = fracPart.toString().padStart(decimals, "0");

    return `${neg ? "-" : ""}${intPart.toString()}.${fracStr}`.replace(/\.?0+$/, "");
}

function toScaledFromNumber(x: number): bigint {
    if (!Number.isFinite(x)) {
        throw new Error(`Reference oracle returned a non-finite value: ${x}`);
    }
    return BigInt(Math.round(x * SCALE_NUMBER));
}

function scaledAbsError(actual: bigint, expected: bigint): bigint {
    return absBigInt(actual - expected);
}

/**
 * Relative error in SCALE units:
 *   rel = |actual - expected| / |expected|
 * If expected == 0, returns undefined.
 */
function scaledRelError(actual: bigint, expected: bigint): bigint | undefined {
    const den = absBigInt(expected);
    if (den === 0n) return undefined;

    const num = absBigInt(actual - expected);
    return (num * SCALE) / den;
}

function numericRecord(
    actual: bigint,
    expected: bigint,
    gas: bigint,
    caseLabel: string
): NumericRecord {
    return {
        actual,
        expected,
        absError: scaledAbsError(actual, expected),
        relErrorScaled: scaledRelError(actual, expected),
        expectedAbs: absBigInt(expected),
        gas,
        caseLabel,
    };
}

function assertAccuracyGroups(groups: AccuracyGroup[]): void {
    const failures: string[] = [];

    for (const group of groups) {
        const nearZeroThreshold = group.nearZeroThreshold ?? NEAR_ZERO_THRESHOLD;
        const failed = group.records.filter((record) => {
            if (record.absError <= group.absTolerance) return false;
            if (record.expectedAbs <= nearZeroThreshold) return true;
            if (group.relTolerance === undefined || record.relErrorScaled === undefined) return true;
            return record.relErrorScaled > group.relTolerance;
        });

        if (failed.length === 0) continue;

        const worstAbs = failed.reduce((a, b) => (a.absError >= b.absError ? a : b));
        const worstRelCandidates = failed.filter(
            (record): record is NumericRecord & { relErrorScaled: bigint } =>
                record.relErrorScaled !== undefined
        );
        const worstRel = worstRelCandidates.length === 0
            ? undefined
            : worstRelCandidates.reduce((a, b) =>
                a.relErrorScaled >= b.relErrorScaled ? a : b
            );

        failures.push(
            `${group.name}: ${failed.length}/${group.records.length} cases exceeded tolerance; ` +
            `max abs=${formatScaledInt(worstAbs.absError, 12)} at ${worstAbs.caseLabel} ` +
            `(actual=${formatScaledInt(worstAbs.actual, 12)}, ` +
            `expected=${formatScaledInt(worstAbs.expected, 12)})` +
            (worstRel
                ? `; max rel=${formatScaledInt(worstRel.relErrorScaled, 12)} at ${worstRel.caseLabel}`
                : "")
        );
    }

    expect(failures, failures.join("\n")).to.deep.equal([]);
}

// ------------------------------------------------------------
// Deterministic Pseudo-Random Helpers
// ------------------------------------------------------------

/**
 * Returns a deterministic pseudo-random bigint in [0, 2^256-1].
 */
function pseudoRandomBigInt(label: string, index: number): bigint {
    const digest = ethers.keccak256(
        ethers.solidityPacked(
            ["string", "string", "uint256"],
            [FIXED_SEED, label, BigInt(index)]
        )
    );
    return BigInt(digest);
}

/**
 * Maps a pseudo-random integer to the closed interval [min, max].
 */
function pseudoRandomScaledInRange(label: string, index: number, min: bigint, max: bigint): bigint {
    const lo = min < max ? min : max;
    const hi = min < max ? max : min;

    const span = hi - lo;
    if (span === 0n) return lo;

    const r = pseudoRandomBigInt(label, index) % (span + 1n);
    return lo + r;
}

/**
 * Generates a deterministic pseudo-random test value in [-10pi, 10pi].
 */
function randomAngleWideScaled(label: string, index: number): bigint {
    return pseudoRandomScaledInRange(label, index, -10n * PI_SCALED, 10n * PI_SCALED);
}

/**
 * Generates a deterministic pseudo-random x in [-1, 1].
 */
function randomUnitIntervalScaled(label: string, index: number): bigint {
    return pseudoRandomScaledInRange(label, index, -1n * SCALE, 1n * SCALE);
}

/**
 * Generates a deterministic pseudo-random x in [-100, 100].
 */
function randomAtanInputScaled(label: string, index: number): bigint {
    return pseudoRandomScaledInRange(label, index, -100n * SCALE, 100n * SCALE);
}

/**
 * Generates deterministic valid inputs for tan, staying away from singularities.
 * Chosen domain: [-3pi/2 + margin, 3pi/2 - margin], excluding points near pi/2 + k*pi.
 */
function randomValidTanInputScaled(index: number): bigint {
    const margin = POLE_EXCLUSION;
    while (true) {
        const x = pseudoRandomScaledInRange(
            "tan-valid",
            index,
            -3n * HALF_PI_SCALED + margin,
            3n * HALF_PI_SCALED - margin
        );

        let nearSingularity = false;
        for (let k = -3; k <= 3; k++) {
            const singular = HALF_PI_SCALED + BigInt(k) * PI_SCALED;
            if (absBigInt(x - singular) < POLE_EXCLUSION) {
                nearSingularity = true;
                break;
            }
        }

        if (!nearSingularity) return x;
        index += 1000;
    }
}

/**
 * Generates deterministic valid inputs for cot, staying away from k*pi.
 */
function randomValidCotInputScaled(index: number): bigint {
    const margin = POLE_EXCLUSION;
    while (true) {
        const x = pseudoRandomScaledInRange(
            "cot-valid",
            index,
            -3n * PI_SCALED + margin,
            3n * PI_SCALED - margin
        );

        let nearSingularity = false;
        for (let k = -3; k <= 3; k++) {
            const singular = BigInt(k) * PI_SCALED;
            if (absBigInt(x - singular) < POLE_EXCLUSION) {
                nearSingularity = true;
                break;
            }
        }

        if (!nearSingularity) return x;
        index += 1000;
    }
}

// ------------------------------------------------------------
// Contract Interaction Helpers
// ------------------------------------------------------------

async function qScaled(harness: TrigonometryHarness, scaledValue: bigint): Promise<string> {
    return await harness.fromFloat(scaledValue);
}

async function outScaled(harness: TrigonometryHarness, q: string): Promise<bigint> {
    const raw = await harness.toFloat(q);
    return asBigInt(raw);
}

async function expectFiniteQuad(
    harness: TrigonometryHarness,
    q: string,
    caseLabel: string
): Promise<void> {
    expect(await harness.isNaN(q), `${caseLabel} returned NaN`).to.equal(false);
    const exponent = (BigInt(q) >> 112n) & 0x7fffn;
    expect(exponent, `${caseLabel} returned infinity`).to.not.equal(0x7fffn);
}

async function estimateGasFor(
    harness: TrigonometryHarness,
    method: string,
    args: unknown[]
): Promise<bigint> {
    // This is an estimateGas simulation. Any failure rejects the accuracy test.
    const fn = harness.getFunction(method) as unknown as {
        estimateGas: (...innerArgs: unknown[]) => Promise<bigint>;
    };
    return await fn.estimateGas(...args);
}

async function buildKPi(
    harness: TrigonometryHarness,
    k: bigint,
    QPI: string
): Promise<string> {
    const QZERO = await harness.fromDouble(0n);
    if (k === 0n) return QZERO;

    let acc = QZERO;

    if (k > 0n) {
        for (let i = 0n; i < k; i++) {
            acc = await harness.add(acc, QPI);
        }
        return acc;
    }

    const negQPI = await harness.neg(QPI);
    for (let i = 0n; i < -k; i++) {
        acc = await harness.add(acc, negQPI);
    }
    return acc;
}

// ------------------------------------------------------------
// Reporting Helpers
// ------------------------------------------------------------

function printNumericSummary(title: string, method: string, records: NumericRecord[]) {
    const absErrors = records.map((r) => r.absError);
    const relErrors = records
        .map((r) => r.relErrorScaled)
        .filter((v): v is bigint => v !== undefined);
    const gasValues = records.map((r) => r.gas);

    console.log("============================================================");
    console.log(`${title}`);
    console.log("============================================================");
    console.log(`Method             : ${method}`);
    console.log(`Execution Model    : ${EXECUTION_MODEL}`);
    console.log(`Execution Path     : ${EXECUTION_PATH}`);
    console.log(`Gas Measurement    : ${GAS_MEASUREMENT}`);
    console.log(`Result Execution   : ${RESULT_EXECUTION}`);
    console.log(`Number of Tests    : ${records.length}`);
    console.log(`Average Abs. Error : ${formatScaledInt(avgBigInt(absErrors), 12)}`);
    console.log(`Max Abs. Error     : ${formatScaledInt(maxBigInt(absErrors), 12)}`);
    console.log(
        `Average Rel. Error : ${relErrors.length > 0 ? formatScaledInt(avgBigInt(relErrors), 12) : "N/A"}`
    );
    console.log(`Min Estimated Gas  : ${minBigInt(gasValues).toString()}`);
    console.log(`Avg Estimated Gas  : ${avgBigInt(gasValues).toString()}`);
    console.log(`Max Estimated Gas  : ${maxBigInt(gasValues).toString()}`);
    console.log("============================================================");
}

function printBooleanSummary(title: string, method: string, records: BoolRecord[]) {
    const gasValues = records.map((r) => r.gas);
    const okCount = records.filter((r) => r.ok).length;

    console.log("============================================================");
    console.log(`${title}`);
    console.log("============================================================");
    console.log(`Method             : ${method}`);
    console.log(`Execution Model    : ${EXECUTION_MODEL}`);
    console.log(`Execution Path     : ${EXECUTION_PATH}`);
    console.log(`Gas Measurement    : ${GAS_MEASUREMENT}`);
    console.log(`Result Execution   : ${RESULT_EXECUTION}`);
    console.log(`Number of Tests    : ${records.length}`);
    console.log(`Correct Cases      : ${okCount}`);
    console.log(`Accuracy           : ${okCount}/${records.length}`);
    console.log(`Min Estimated Gas  : ${minBigInt(gasValues).toString()}`);
    console.log(`Avg Estimated Gas  : ${avgBigInt(gasValues).toString()}`);
    console.log(`Max Estimated Gas  : ${maxBigInt(gasValues).toString()}`);
    console.log("============================================================");
}

// ------------------------------------------------------------
// Test Suite
// ------------------------------------------------------------

describe("Trigonometry Library - Harness-Observable Accuracy Checks (1e-12 scale; estimateGas + eth_call)", function () {
    let harness: TrigonometryHarness;

    let QPI: string;
    let QHALF_PI: string;
    let QQUARTER_PI: string;
    let QTWO_PI: string;

    before(async () => {
        const MathLibFactory = await ethers.getContractFactory("MathLib");
        const mathlib = await MathLibFactory.deploy();
        await mathlib.waitForDeployment();

        const HF = await ethers.getContractFactory("TrigonometryHarness", {
            libraries: { MathLib: await mathlib.getAddress() },
        });

        harness = (await HF.deploy()) as unknown as TrigonometryHarness;

        QPI = await harness.QPI();
        QHALF_PI = await harness.QHALF_PI();
        QQUARTER_PI = await harness.QQUARTER_PI();
        QTWO_PI = await harness.QTWO_PI();
    });

    // ------------------------------------------------------------
    // 1) Symmetry Tests (30 each)
    // ------------------------------------------------------------

    it("should evaluate symmetry properties over 30 deterministic pseudo-random cases each", async function () {
        const sinRecords: NumericRecord[] = [];
        const cosRecords: NumericRecord[] = [];
        const atanRecords: NumericRecord[] = [];

        for (let i = 0; i < NUM_CASES; i++) {
            const xScaled = pseudoRandomScaledInRange("symmetry-x", i, 1n, 10n * PI_SCALED);
            const qx = await qScaled(harness, xScaled);
            const qNegX = await qScaled(harness, -xScaled);

            {
                const gas1 = await estimateGasFor(harness, "sin", [qx]);
                const gas2 = await estimateGasFor(harness, "sin", [qNegX]);

                const sPos = await harness.sin(qx);
                const sNeg = await harness.sin(qNegX);
                await expectFiniteQuad(harness, sPos, `sin symmetry positive case ${i}`);
                await expectFiniteQuad(harness, sNeg, `sin symmetry negative case ${i}`);

                const sPosScaled = await outScaled(harness, sPos);
                const sNegScaled = await outScaled(harness, sNeg);

                const propertyActual = sNegScaled + sPosScaled;
                sinRecords.push(numericRecord(
                    propertyActual,
                    0n,
                    gas1 + gas2,
                    `x=${formatScaledInt(xScaled, 12)}`
                ));
            }

            {
                const gas1 = await estimateGasFor(harness, "cos", [qx]);
                const gas2 = await estimateGasFor(harness, "cos", [qNegX]);

                const cPos = await harness.cos(qx);
                const cNeg = await harness.cos(qNegX);
                await expectFiniteQuad(harness, cPos, `cos symmetry positive case ${i}`);
                await expectFiniteQuad(harness, cNeg, `cos symmetry negative case ${i}`);

                const cPosScaled = await outScaled(harness, cPos);
                const cNegScaled = await outScaled(harness, cNeg);

                const propertyActual = cNegScaled - cPosScaled;
                cosRecords.push(numericRecord(
                    propertyActual,
                    0n,
                    gas1 + gas2,
                    `x=${formatScaledInt(xScaled, 12)}`
                ));
            }

            {
                const xAtanScaled = pseudoRandomScaledInRange("atan-symmetry-x", i, 1n, 100n * SCALE);
                const qxa = await qScaled(harness, xAtanScaled);
                const qNegXa = await qScaled(harness, -xAtanScaled);

                const gas1 = await estimateGasFor(harness, "atan", [qxa]);
                const gas2 = await estimateGasFor(harness, "atan", [qNegXa]);

                const aPos = await harness.atan(qxa);
                const aNeg = await harness.atan(qNegXa);
                await expectFiniteQuad(harness, aPos, `atan symmetry positive case ${i}`);
                await expectFiniteQuad(harness, aNeg, `atan symmetry negative case ${i}`);

                const aPosScaled = await outScaled(harness, aPos);
                const aNegScaled = await outScaled(harness, aNeg);

                const propertyActual = aNegScaled + aPosScaled;
                atanRecords.push(numericRecord(
                    propertyActual,
                    0n,
                    gas1 + gas2,
                    `x=${formatScaledInt(xAtanScaled, 12)}`
                ));
            }
        }

        printNumericSummary("Harness-Observable Symmetry Results", "sin(-x) = -sin(x)", sinRecords);
        printNumericSummary("Harness-Observable Symmetry Results", "cos(-x) = cos(x)", cosRecords);
        printNumericSummary("Harness-Observable Symmetry Results", "atan(-x) = -atan(x)", atanRecords);

        expect(sinRecords).to.have.length(NUM_CASES);
        expect(cosRecords).to.have.length(NUM_CASES);
        expect(atanRecords).to.have.length(NUM_CASES);
        assertAccuracyGroups([
            { name: "sin odd symmetry", records: sinRecords, absTolerance: IDENTITY_ABS_TOL },
            { name: "cos even symmetry", records: cosRecords, absTolerance: IDENTITY_ABS_TOL },
            { name: "atan odd symmetry", records: atanRecords, absTolerance: IDENTITY_ABS_TOL },
        ]);
    });

    // ------------------------------------------------------------
    // 2) Periodicity Tests (30 each)
    // ------------------------------------------------------------

    it("should evaluate periodicity properties over 30 deterministic pseudo-random cases each", async function () {
        const sinRecords: NumericRecord[] = [];
        const cosRecords: NumericRecord[] = [];

        for (let i = 0; i < NUM_CASES; i++) {
            const xScaled = randomAngleWideScaled("periodicity-x", i);
            const xPlusTwoPiScaled = xScaled + TWO_PI_SCALED;

            const qx = await qScaled(harness, xScaled);
            const qxPlusTwoPi = await qScaled(harness, xPlusTwoPiScaled);

            {
                const gas1 = await estimateGasFor(harness, "sin", [qx]);
                const gas2 = await estimateGasFor(harness, "sin", [qxPlusTwoPi]);

                const s1 = await harness.sin(qx);
                const s2 = await harness.sin(qxPlusTwoPi);
                await expectFiniteQuad(harness, s1, `sin periodicity base case ${i}`);
                await expectFiniteQuad(harness, s2, `sin periodicity shifted case ${i}`);

                const s1Scaled = await outScaled(harness, s1);
                const s2Scaled = await outScaled(harness, s2);

                sinRecords.push(numericRecord(
                    s2Scaled,
                    s1Scaled,
                    gas1 + gas2,
                    `x=${formatScaledInt(xScaled, 12)}`
                ));
            }

            {
                const gas1 = await estimateGasFor(harness, "cos", [qx]);
                const gas2 = await estimateGasFor(harness, "cos", [qxPlusTwoPi]);

                const c1 = await harness.cos(qx);
                const c2 = await harness.cos(qxPlusTwoPi);
                await expectFiniteQuad(harness, c1, `cos periodicity base case ${i}`);
                await expectFiniteQuad(harness, c2, `cos periodicity shifted case ${i}`);

                const c1Scaled = await outScaled(harness, c1);
                const c2Scaled = await outScaled(harness, c2);

                cosRecords.push(numericRecord(
                    c2Scaled,
                    c1Scaled,
                    gas1 + gas2,
                    `x=${formatScaledInt(xScaled, 12)}`
                ));
            }
        }

        printNumericSummary("Harness-Observable Periodicity Results", "sin(x + 2pi) = sin(x)", sinRecords);
        printNumericSummary("Harness-Observable Periodicity Results", "cos(x + 2pi) = cos(x)", cosRecords);

        expect(sinRecords).to.have.length(NUM_CASES);
        expect(cosRecords).to.have.length(NUM_CASES);
        assertAccuracyGroups([
            { name: "sin periodicity", records: sinRecords, absTolerance: IDENTITY_ABS_TOL },
            { name: "cos periodicity", records: cosRecords, absTolerance: IDENTITY_ABS_TOL },
        ]);
    });

    // ------------------------------------------------------------
    // 3) Difference Between sin(pi/4) and cos(pi/4) (30 repetitions)
    // ------------------------------------------------------------

    it("should evaluate the difference between sin(pi/4) and cos(pi/4) over 30 deterministic duplicate evaluations", async function () {
        const records: NumericRecord[] = [];

        for (let i = 0; i < NUM_CASES; i++) {
            const gasSin = await estimateGasFor(harness, "sin", [QQUARTER_PI]);
            const gasCos = await estimateGasFor(harness, "cos", [QQUARTER_PI]);

            const s = await harness.sin(QQUARTER_PI);
            const c = await harness.cos(QQUARTER_PI);
            await expectFiniteQuad(harness, s, "sin(pi/4)");
            await expectFiniteQuad(harness, c, "cos(pi/4)");

            const sScaled = await outScaled(harness, s);
            const cScaled = await outScaled(harness, c);

            const propertyActual = sScaled - cScaled;
            records.push(numericRecord(
                propertyActual,
                0n,
                gasSin + gasCos,
                "x=pi/4"
            ));
        }

        printNumericSummary(
            "Harness-Observable Difference Results at pi/4",
            "|sin(pi/4) - cos(pi/4)|",
            records
        );

        expect(records).to.have.length(NUM_CASES);
        assertAccuracyGroups([
            { name: "sin(pi/4) equals cos(pi/4)", records, absTolerance: IDENTITY_ABS_TOL },
        ]);
    });

    it("should retain inverse-trig accuracy in both asin polynomial regions", async function () {
        const cases = [
            { label: "primary polynomial region", xScaled: 500_000_000_000n },
            { label: "half-angle polynomial region", xScaled: 933_318_333_165n },
        ];

        for (const { label, xScaled } of cases) {
            const input = await qScaled(harness, xScaled);
            const inputNumber = Number(xScaled) / SCALE_NUMBER;

            const asinActual = await outScaled(harness, await harness.asin(input));
            const asinExpected = toScaledFromNumber(Math.asin(inputNumber));
            expect(
                absBigInt(asinActual - asinExpected),
                `asin ${label}`
            ).to.be.at.most(DIRECT_ABS_TOL);

            const acosActual = await outScaled(harness, await harness.acos(input));
            const acosExpected = toScaledFromNumber(Math.acos(inputNumber));
            expect(
                absBigInt(acosActual - acosExpected),
                `acos ${label}`
            ).to.be.at.most(DIRECT_ABS_TOL);
        }
    });

    // ------------------------------------------------------------
    // 4) Random Direct / Inverse Function Accuracy Tests (30 each)
    // ------------------------------------------------------------

    it("should evaluate direct and inverse trigonometric functions on 30 deterministic pseudo-random inputs each", async function () {
        const sinRecords: NumericRecord[] = [];
        const cosRecords: NumericRecord[] = [];
        const tanRecords: NumericRecord[] = [];
        const cotRecords: NumericRecord[] = [];
        const asinRecords: NumericRecord[] = [];
        const acosRecords: NumericRecord[] = [];
        const atanRecords: NumericRecord[] = [];

        for (let i = 0; i < NUM_CASES; i++) {
            {
                const xScaled = randomAngleWideScaled("sin-random", i);
                const qx = await qScaled(harness, xScaled);

                const gas = await estimateGasFor(harness, "sin", [qx]);
                const out = await harness.sin(qx);
                await expectFiniteQuad(harness, out, `sin case ${i}, x=${formatScaledInt(xScaled, 12)}`);

                const actualScaled = await outScaled(harness, out);
                const expectedScaled = toScaledFromNumber(Math.sin(Number(xScaled) / SCALE_NUMBER));

                sinRecords.push(numericRecord(
                    actualScaled,
                    expectedScaled,
                    gas,
                    `case ${i}, x=${formatScaledInt(xScaled, 12)}`
                ));
            }

            {
                const xScaled = randomAngleWideScaled("cos-random", i);
                const qx = await qScaled(harness, xScaled);

                const gas = await estimateGasFor(harness, "cos", [qx]);
                const out = await harness.cos(qx);
                await expectFiniteQuad(harness, out, `cos case ${i}, x=${formatScaledInt(xScaled, 12)}`);

                const actualScaled = await outScaled(harness, out);
                const expectedScaled = toScaledFromNumber(Math.cos(Number(xScaled) / SCALE_NUMBER));

                cosRecords.push(numericRecord(
                    actualScaled,
                    expectedScaled,
                    gas,
                    `case ${i}, x=${formatScaledInt(xScaled, 12)}`
                ));
            }

            {
                const xScaled = randomValidTanInputScaled(i);
                const qx = await qScaled(harness, xScaled);

                const gas = await estimateGasFor(harness, "tan", [qx]);
                const out = await harness.tan(qx);
                await expectFiniteQuad(harness, out, `tan case ${i}, x=${formatScaledInt(xScaled, 12)}`);

                const actualScaled = await outScaled(harness, out);
                const expectedScaled = toScaledFromNumber(Math.tan(Number(xScaled) / SCALE_NUMBER));

                tanRecords.push(numericRecord(
                    actualScaled,
                    expectedScaled,
                    gas,
                    `case ${i}, x=${formatScaledInt(xScaled, 12)}`
                ));
            }

            {
                const xScaled = randomValidCotInputScaled(i);
                const qx = await qScaled(harness, xScaled);

                const gas = await estimateGasFor(harness, "cot", [qx]);
                const out = await harness.cot(qx);
                await expectFiniteQuad(harness, out, `cot case ${i}, x=${formatScaledInt(xScaled, 12)}`);

                const actualScaled = await outScaled(harness, out);
                const expected = 1 / Math.tan(Number(xScaled) / SCALE_NUMBER);
                const expectedScaled = toScaledFromNumber(expected);

                cotRecords.push(numericRecord(
                    actualScaled,
                    expectedScaled,
                    gas,
                    `case ${i}, x=${formatScaledInt(xScaled, 12)}`
                ));
            }

            {
                const xScaled = randomUnitIntervalScaled("asin-random", i);
                const qx = await qScaled(harness, xScaled);

                const gas = await estimateGasFor(harness, "asin", [qx]);
                const out = await harness.asin(qx);
                await expectFiniteQuad(harness, out, `asin case ${i}, x=${formatScaledInt(xScaled, 12)}`);

                const actualScaled = await outScaled(harness, out);
                const expectedScaled = toScaledFromNumber(Math.asin(Number(xScaled) / SCALE_NUMBER));

                asinRecords.push(numericRecord(
                    actualScaled,
                    expectedScaled,
                    gas,
                    `case ${i}, x=${formatScaledInt(xScaled, 12)}`
                ));
            }

            {
                const xScaled = randomUnitIntervalScaled("acos-random", i);
                const qx = await qScaled(harness, xScaled);

                const gas = await estimateGasFor(harness, "acos", [qx]);
                const out = await harness.acos(qx);
                await expectFiniteQuad(harness, out, `acos case ${i}, x=${formatScaledInt(xScaled, 12)}`);

                const actualScaled = await outScaled(harness, out);
                const expectedScaled = toScaledFromNumber(Math.acos(Number(xScaled) / SCALE_NUMBER));

                acosRecords.push(numericRecord(
                    actualScaled,
                    expectedScaled,
                    gas,
                    `case ${i}, x=${formatScaledInt(xScaled, 12)}`
                ));
            }

            {
                const xScaled = randomAtanInputScaled("atan-random", i);
                const qx = await qScaled(harness, xScaled);

                const gas = await estimateGasFor(harness, "atan", [qx]);
                const out = await harness.atan(qx);
                await expectFiniteQuad(harness, out, `atan case ${i}, x=${formatScaledInt(xScaled, 12)}`);

                const actualScaled = await outScaled(harness, out);
                const expectedScaled = toScaledFromNumber(Math.atan(Number(xScaled) / SCALE_NUMBER));

                atanRecords.push(numericRecord(
                    actualScaled,
                    expectedScaled,
                    gas,
                    `case ${i}, x=${formatScaledInt(xScaled, 12)}`
                ));
            }
        }

        printNumericSummary("Harness-Observable Oracle Results", "sin(x)", sinRecords);
        printNumericSummary("Harness-Observable Oracle Results", "cos(x)", cosRecords);
        printNumericSummary("Harness-Observable Oracle Results", "tan(x)", tanRecords);
        printNumericSummary("Harness-Observable Oracle Results", "cot(x)", cotRecords);
        printNumericSummary("Harness-Observable Oracle Results", "asin(x)", asinRecords);
        printNumericSummary("Harness-Observable Oracle Results", "acos(x)", acosRecords);
        printNumericSummary("Harness-Observable Oracle Results", "atan(x)", atanRecords);

        expect(sinRecords).to.have.length(NUM_CASES);
        expect(cosRecords).to.have.length(NUM_CASES);
        expect(tanRecords).to.have.length(NUM_CASES);
        expect(cotRecords).to.have.length(NUM_CASES);
        expect(asinRecords).to.have.length(NUM_CASES);
        expect(acosRecords).to.have.length(NUM_CASES);
        expect(atanRecords).to.have.length(NUM_CASES);
        assertAccuracyGroups([
            { name: "sin oracle accuracy", records: sinRecords, absTolerance: DIRECT_ABS_TOL },
            { name: "cos oracle accuracy", records: cosRecords, absTolerance: DIRECT_ABS_TOL },
            {
                name: "tan oracle accuracy (inputs at least 0.01 rad from poles)",
                records: tanRecords,
                absTolerance: RATIO_ABS_TOL,
                relTolerance: DEFAULT_REL_TOL,
            },
            {
                name: "cot oracle accuracy (inputs at least 0.01 rad from poles)",
                records: cotRecords,
                absTolerance: RATIO_ABS_TOL,
                relTolerance: DEFAULT_REL_TOL,
            },
            {
                name: "asin oracle accuracy",
                records: asinRecords,
                absTolerance: INVERSE_ABS_TOL,
                relTolerance: DEFAULT_REL_TOL,
            },
            {
                name: "acos oracle accuracy",
                records: acosRecords,
                absTolerance: INVERSE_ABS_TOL,
                relTolerance: DEFAULT_REL_TOL,
            },
            {
                name: "atan oracle accuracy",
                records: atanRecords,
                absTolerance: INVERSE_ABS_TOL,
                relTolerance: DEFAULT_REL_TOL,
            },
        ]);
    });

    // ------------------------------------------------------------
    // 5) Direct / Inverse Consistency Tests (30 each)
    // ------------------------------------------------------------

    it("should evaluate direct and inverse consistency relations over 30 deterministic pseudo-random cases each", async function () {
        const asinSinRecords: NumericRecord[] = [];
        const acosCosRecords: NumericRecord[] = [];
        const tanAtanRecords: NumericRecord[] = [];

        for (let i = 0; i < NUM_CASES; i++) {
            {
                const xScaled = pseudoRandomScaledInRange(
                    "asin-sin-x",
                    i,
                    -HALF_PI_SCALED,
                    HALF_PI_SCALED
                );
                const qx = await qScaled(harness, xScaled);

                const gas1 = await estimateGasFor(harness, "sin", [qx]);
                const s = await harness.sin(qx);
                await expectFiniteQuad(harness, s, `asin(sin(x)) sine stage case ${i}`);

                const gas2 = await estimateGasFor(harness, "asin", [s]);
                const recovered = await harness.asin(s);
                await expectFiniteQuad(harness, recovered, `asin(sin(x)) case ${i}`);

                const recoveredScaled = await outScaled(harness, recovered);

                asinSinRecords.push(numericRecord(
                    recoveredScaled,
                    xScaled,
                    gas1 + gas2,
                    `case ${i}, x=${formatScaledInt(xScaled, 12)}`
                ));
            }

            {
                const xScaled = pseudoRandomScaledInRange(
                    "acos-cos-x",
                    i,
                    0n,
                    PI_SCALED
                );
                const qx = await qScaled(harness, xScaled);

                const gas1 = await estimateGasFor(harness, "cos", [qx]);
                const c = await harness.cos(qx);
                await expectFiniteQuad(harness, c, `acos(cos(x)) cosine stage case ${i}`);

                const gas2 = await estimateGasFor(harness, "acos", [c]);
                const recovered = await harness.acos(c);
                await expectFiniteQuad(harness, recovered, `acos(cos(x)) case ${i}`);

                const recoveredScaled = await outScaled(harness, recovered);

                acosCosRecords.push(numericRecord(
                    recoveredScaled,
                    xScaled,
                    gas1 + gas2,
                    `case ${i}, x=${formatScaledInt(xScaled, 12)}`
                ));
            }

            {
                const xScaled = randomAtanInputScaled("tan-atan-x", i);
                const qx = await qScaled(harness, xScaled);

                const gas1 = await estimateGasFor(harness, "atan", [qx]);
                const a = await harness.atan(qx);
                await expectFiniteQuad(harness, a, `tan(atan(x)) atan stage case ${i}`);

                const gas2 = await estimateGasFor(harness, "tan", [a]);
                const recovered = await harness.tan(a);
                await expectFiniteQuad(harness, recovered, `tan(atan(x)) case ${i}`);

                const recoveredScaled = await outScaled(harness, recovered);

                tanAtanRecords.push(numericRecord(
                    recoveredScaled,
                    xScaled,
                    gas1 + gas2,
                    `case ${i}, x=${formatScaledInt(xScaled, 12)}`
                ));
            }
        }

        printNumericSummary("Harness-Observable Consistency Results", "asin(sin(x)) ≈ x", asinSinRecords);
        printNumericSummary("Harness-Observable Consistency Results", "acos(cos(x)) ≈ x", acosCosRecords);
        printNumericSummary("Harness-Observable Consistency Results", "tan(atan(x)) ≈ x", tanAtanRecords);

        expect(asinSinRecords).to.have.length(NUM_CASES);
        expect(acosCosRecords).to.have.length(NUM_CASES);
        expect(tanAtanRecords).to.have.length(NUM_CASES);
        assertAccuracyGroups([
            {
                name: "asin(sin(x)) principal-branch round trip",
                records: asinSinRecords,
                absTolerance: ROUND_TRIP_ABS_TOL,
                relTolerance: DEFAULT_REL_TOL,
            },
            {
                name: "acos(cos(x)) principal-branch round trip",
                records: acosCosRecords,
                absTolerance: ROUND_TRIP_ABS_TOL,
                relTolerance: DEFAULT_REL_TOL,
            },
            {
                name: "tan(atan(x)) round trip",
                records: tanAtanRecords,
                absTolerance: ROUND_TRIP_ABS_TOL,
                relTolerance: DEFAULT_REL_TOL,
            },
        ]);
    });

    // ------------------------------------------------------------
    // 6) Undefined Regions for Direct Functions (30 each)
    // ------------------------------------------------------------

    it("should evaluate undefined-region behavior for tan and cot over 30 cases each", async function () {
        const tanRecords: BoolRecord[] = [];
        const cotRecords: BoolRecord[] = [];

        const QZERO = await harness.fromDouble(0n);

        for (let i = 0; i < NUM_CASES; i++) {
            // tan(pi/2) -> NaN
            {
                const gas = await estimateGasFor(harness, "tan", [QHALF_PI]);
                const out = await harness.tan(QHALF_PI);
                const isNaN = await harness.isNaN(out);

                tanRecords.push({
                    ok: isNaN,
                    gas,
                });
            }

            // cot(0) -> NaN
            {
                const gas = await estimateGasFor(harness, "cot", [QZERO]);
                const out = await harness.cot(QZERO);
                const isNaN = await harness.isNaN(out);

                cotRecords.push({
                    ok: isNaN,
                    gas,
                });
            }
        }

        printBooleanSummary("Undefined-Region Results", "tan(pi/2) -> NaN", tanRecords);
        printBooleanSummary("Undefined-Region Results", "cot(0) -> NaN", cotRecords);

        expect(tanRecords.every((r) => r.ok)).to.equal(true);
        expect(cotRecords.every((r) => r.ok)).to.equal(true);
    });

    it("should classify inverse-function domain boundaries and invalid inputs explicitly", async function () {
        const one = await qScaled(harness, SCALE);
        const negativeOne = await qScaled(harness, -SCALE);
        const aboveOne = await qScaled(harness, SCALE + 1n);
        const belowNegativeOne = await qScaled(harness, -SCALE - 1n);

        for (const [label, input] of [["+1", one], ["-1", negativeOne]] as const) {
            await expectFiniteQuad(harness, await harness.asin(input), `asin(${label})`);
            await expectFiniteQuad(harness, await harness.acos(input), `acos(${label})`);
        }

        const invalidCases = [
            { label: "asin(1 + 1e-12)", method: "asin" as const, input: aboveOne },
            { label: "asin(-1 - 1e-12)", method: "asin" as const, input: belowNegativeOne },
            { label: "acos(1 + 1e-12)", method: "acos" as const, input: aboveOne },
            { label: "acos(-1 - 1e-12)", method: "acos" as const, input: belowNegativeOne },
        ];

        for (const invalidCase of invalidCases) {
            const output = invalidCase.method === "asin"
                ? await harness.asin(invalidCase.input)
                : await harness.acos(invalidCase.input);
            expect(
                await harness.isNaN(output),
                `${invalidCase.label} must be classified as outside the supported domain`
            ).to.equal(true);
        }
    });
});
