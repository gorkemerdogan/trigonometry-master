// SPDX-License-Identifier: MIT
import { expect } from "chai";
import { ethers } from "hardhat";
import type { Contract } from "ethers";

type HighResolutionHarness = Contract & {
    sinCore(x: string): Promise<string>;
    cosCore(x: string): Promise<string>;
    sin(x: string): Promise<string>;
    cos(x: string): Promise<string>;
};

const DECIMAL_DIGITS = 90;
const DECIMAL_SCALE = 10n ** BigInt(DECIMAL_DIGITS);
const RELATIVE_SCALE = 10n ** 60n;
const RELATIVE_MIN_MAGNITUDE = DECIMAL_SCALE / (10n ** 30n);
const CORE_STEPS = 1024;
const BROAD_STEPS = 256;

// No arbitrary-precision decimal package is installed. This test therefore uses
// deterministic BigInt fixed-point arithmetic at 90 decimal places. Binary128
// values in the measured range are decoded with less than 5e-91 decimal error,
// and the reference Taylor series is continued until both next terms are <= 1e-90.
const PI = decimalFixed(
    "3.141592653589793238462643383279502884197169399375105820974944592307816406286208998628034825"
);
const HALF_PI = divRound(PI, 2n);
const QUARTER_PI = divRound(PI, 4n);
const TWO_PI = PI * 2n;

type Observation = {
    input: bigint;
    inputRaw: string;
    actual: bigint;
    expected: bigint;
    absError: bigint;
    relError?: bigint;
};

type Characterization = {
    count: number;
    maxAbsolute: Observation;
    maxRelative?: Observation;
};

function decimalFixed(value: string): bigint {
    const negative = value.startsWith("-");
    const unsigned = negative ? value.slice(1) : value;
    const [integerPart, fractionalPart = ""] = unsigned.split(".");
    const digits = (fractionalPart + "0".repeat(DECIMAL_DIGITS)).slice(0, DECIMAL_DIGITS);
    const result = BigInt(integerPart) * DECIMAL_SCALE + BigInt(digits);
    return negative ? -result : result;
}

function abs(value: bigint): bigint {
    return value < 0n ? -value : value;
}

function divRound(numerator: bigint, denominator: bigint): bigint {
    if (denominator <= 0n) throw new Error("divRound requires a positive denominator");
    const negative = numerator < 0n;
    const magnitude = negative ? -numerator : numerator;
    let quotient = magnitude / denominator;
    const remainder = magnitude % denominator;
    const doubled = remainder * 2n;
    if (doubled > denominator || (doubled === denominator && (quotient & 1n) === 1n)) {
        quotient += 1n;
    }
    return negative ? -quotient : quotient;
}

function mulFixed(a: bigint, b: bigint): bigint {
    return divRound(a * b, DECIMAL_SCALE);
}

function powFixed(base: bigint, exponent: number): bigint {
    let result = DECIMAL_SCALE;
    for (let i = 0; i < exponent; i++) result = mulFixed(result, base);
    return result;
}

function factorial(value: number): bigint {
    let result = 1n;
    for (let i = 2n; i <= BigInt(value); i++) result *= i;
    return result;
}

function binary128ToFixed(rawHex: string): bigint {
    const raw = BigInt(rawHex);
    const negative = (raw >> 127n) === 1n;
    const exponentBits = Number((raw >> 112n) & 0x7fffn);
    const fraction = raw & ((1n << 112n) - 1n);

    if (exponentBits === 0x7fff) throw new Error(`Unexpected non-finite binary128 value: ${rawHex}`);
    if (exponentBits === 0 && fraction === 0n) return 0n;

    const significand = exponentBits === 0 ? fraction : (1n << 112n) | fraction;
    const exponent = (exponentBits === 0 ? 1 - 16383 : exponentBits - 16383) - 112;
    const magnitude = exponent >= 0
        ? significand * (1n << BigInt(exponent)) * DECIMAL_SCALE
        : divRound(significand * DECIMAL_SCALE, 1n << BigInt(-exponent));
    return negative ? -magnitude : magnitude;
}

function encodeFixed(value: bigint): string {
    if (value === 0n) return `0x${"0".repeat(32)}`;

    const negative = value < 0n;
    const magnitude = negative ? -value : value;
    let exponent = 0;
    let scaledNumerator = magnitude;
    let scaledDenominator = DECIMAL_SCALE;

    while (scaledNumerator < scaledDenominator) {
        scaledNumerator *= 2n;
        exponent -= 1;
    }
    while (scaledNumerator >= 2n * scaledDenominator) {
        scaledDenominator *= 2n;
        exponent += 1;
    }

    const shift = 112 - exponent;
    const significand = shift >= 0
        ? divRound(magnitude * (1n << BigInt(shift)), DECIMAL_SCALE)
        : divRound(magnitude, DECIMAL_SCALE * (1n << BigInt(-shift)));
    let roundedSignificand = significand;
    let roundedExponent = exponent;
    if (roundedSignificand === (1n << 113n)) {
        roundedSignificand >>= 1n;
        roundedExponent += 1;
    }

    const biasedExponent = roundedExponent + 16383;
    if (biasedExponent <= 0 || biasedExponent >= 0x7fff) {
        throw new Error(`Test input is outside the normal binary128 range: ${formatFixed(value)}`);
    }

    const sign = negative ? 1n << 127n : 0n;
    const raw = sign |
        (BigInt(biasedExponent) << 112n) |
        (roundedSignificand - (1n << 112n));
    return `0x${raw.toString(16).padStart(32, "0")}`;
}

function oracleSinCos(input: bigint): { sin: bigint; cos: bigint } {
    let x = input;
    while (x > PI) x -= TWO_PI;
    while (x < -PI) x += TWO_PI;

    const xSquared = mulFixed(x, x);
    let sinTerm = x;
    let sinSum = x;
    let cosTerm = DECIMAL_SCALE;
    let cosSum = DECIMAL_SCALE;

    for (let n = 1; n < 200; n++) {
        sinTerm = -divRound(mulFixed(sinTerm, xSquared), BigInt(2 * n) * BigInt(2 * n + 1));
        cosTerm = -divRound(mulFixed(cosTerm, xSquared), BigInt(2 * n - 1) * BigInt(2 * n));
        sinSum += sinTerm;
        cosSum += cosTerm;
        if (abs(sinTerm) <= 1n && abs(cosTerm) <= 1n) break;
    }

    return { sin: sinSum, cos: cosSum };
}

function observation(inputRaw: string, actualRaw: string, expected: bigint): Observation {
    const input = binary128ToFixed(inputRaw);
    const actual = binary128ToFixed(actualRaw);
    const absError = abs(actual - expected);
    const expectedMagnitude = abs(expected);
    return {
        input,
        inputRaw,
        actual,
        expected,
        absError,
        relError: expectedMagnitude >= RELATIVE_MIN_MAGNITUDE
            ? divRound(absError * RELATIVE_SCALE, expectedMagnitude)
            : undefined,
    };
}

function characterize(observations: Observation[]): Characterization {
    const maxAbsolute = observations.reduce((a, b) => a.absError >= b.absError ? a : b);
    const relative = observations.filter(
        (item): item is Observation & { relError: bigint } => item.relError !== undefined
    );
    const maxRelative = relative.length === 0
        ? undefined
        : relative.reduce((a, b) => a.relError >= b.relError ? a : b);
    return { count: observations.length, maxAbsolute, maxRelative };
}

function formatFixed(value: bigint): string {
    return (Number(value) / Number(DECIMAL_SCALE)).toExponential(12);
}

function formatRelative(value: bigint): string {
    return (Number(value) / Number(RELATIVE_SCALE)).toExponential(12);
}

function printCharacterization(label: string, result: Characterization): void {
    console.log("============================================================");
    console.log(`High-resolution characterization: ${label}`);
    console.log(`Samples            : ${result.count}`);
    console.log(`Max absolute error : ${formatFixed(result.maxAbsolute.absError)}`);
    console.log(`Worst input        : ${formatFixed(result.maxAbsolute.input)} (${result.maxAbsolute.inputRaw})`);
    console.log(`Actual             : ${formatFixed(result.maxAbsolute.actual)}`);
    console.log(`Reference          : ${formatFixed(result.maxAbsolute.expected)}`);
    console.log(`Max relative error (|reference| >= 1e-30): ${result.maxRelative?.relError !== undefined
        ? formatRelative(result.maxRelative.relError)
        : "N/A (reference too close to zero)"}`);
    console.log("============================================================");
}

function adjacentBinary128(rawHex: string): [string, string] {
    const raw = BigInt(rawHex);
    const negative = (raw >> 127n) === 1n;
    const lower = negative ? raw + 1n : raw - 1n;
    const upper = negative ? raw - 1n : raw + 1n;
    return [
        `0x${lower.toString(16).padStart(32, "0")}`,
        `0x${upper.toString(16).padStart(32, "0")}`,
    ];
}

describe("Trigonometry sin/cos high-resolution characterization", function () {
    let harness: HighResolutionHarness;

    before(async function () {
        const MathLibFactory = await ethers.getContractFactory("MathLib");
        const mathLib = await MathLibFactory.deploy();
        await mathLib.waitForDeployment();

        const HarnessFactory = await ethers.getContractFactory("TrigonometryHighResolutionHarness", {
            libraries: { MathLib: await mathLib.getAddress() },
        });
        harness = (await HarnessFactory.deploy()) as unknown as HighResolutionHarness;
        await harness.waitForDeployment();
    });

    it("characterizes the core Taylor polynomials over [-pi/4, pi/4]", async function () {
        const sinObservations: Observation[] = [];
        const cosObservations: Observation[] = [];

        for (let i = 0; i <= CORE_STEPS; i++) {
            const target = divRound(QUARTER_PI * BigInt(2 * i - CORE_STEPS), BigInt(CORE_STEPS));
            const inputRaw = encodeFixed(target);
            const input = binary128ToFixed(inputRaw);
            const reference = oracleSinCos(input);
            sinObservations.push(observation(inputRaw, await harness.sinCore(inputRaw), reference.sin));
            cosObservations.push(observation(inputRaw, await harness.cosCore(inputRaw), reference.cos));
        }

        const sinResult = characterize(sinObservations);
        const cosResult = characterize(cosObservations);
        const sinTaylorBound = divRound(powFixed(QUARTER_PI, 15), factorial(15));
        const cosTaylorBound = divRound(powFixed(QUARTER_PI, 14), factorial(14));
        const arithmeticAllowance = decimalFixed("0.000000000000000000000000000001");

        printCharacterization("sin core polynomial", sinResult);
        printCharacterization("cos core polynomial", cosResult);
        console.log(`Taylor leading-term bound (sin) : ${formatFixed(sinTaylorBound)}`);
        console.log(`Taylor leading-term bound (cos) : ${formatFixed(cosTaylorBound)}`);

        expect(
            sinResult.maxAbsolute.absError,
            "sin core error exceeded the x^15/15! truncation bound plus arithmetic allowance"
        ).to.be.lte(sinTaylorBound + arithmeticAllowance);
        expect(
            cosResult.maxAbsolute.absError,
            "cos core error exceeded the x^14/14! truncation bound plus arithmetic allowance"
        ).to.be.lte(cosTaylorBound + arithmeticAllowance);
    });

    it("characterizes public sin/cos range reduction over [-8pi, 8pi]", async function () {
        const sinObservations: Observation[] = [];
        const cosObservations: Observation[] = [];

        for (let i = 0; i <= BROAD_STEPS; i++) {
            const target = divRound(8n * PI * BigInt(2 * i - BROAD_STEPS), BigInt(BROAD_STEPS));
            const inputRaw = encodeFixed(target);
            const input = binary128ToFixed(inputRaw);
            const reference = oracleSinCos(input);
            sinObservations.push(observation(inputRaw, await harness.sin(inputRaw), reference.sin));
            cosObservations.push(observation(inputRaw, await harness.cos(inputRaw), reference.cos));
        }

        const sinResult = characterize(sinObservations);
        const cosResult = characterize(cosObservations);
        const rangeReductionCeiling = decimalFixed("0.0000000000005"); // 5e-13.

        printCharacterization("sin with quadrant/range reduction", sinResult);
        printCharacterization("cos with quadrant/range reduction", cosResult);

        expect(sinResult.maxAbsolute.absError).to.be.lte(rangeReductionCeiling);
        expect(cosResult.maxAbsolute.absError).to.be.lte(rangeReductionCeiling);
    });

    it("characterizes one-ULP neighborhoods of nonzero multiples of pi/2", async function () {
        const sinObservations: Observation[] = [];
        const cosObservations: Observation[] = [];

        for (let multiple = -16; multiple <= 16; multiple++) {
            const centerRaw = encodeFixed(HALF_PI * BigInt(multiple));
            const inputs = multiple === 0
                ? [centerRaw]
                : [adjacentBinary128(centerRaw)[0], centerRaw, adjacentBinary128(centerRaw)[1]];

            for (const inputRaw of inputs) {
                const input = binary128ToFixed(inputRaw);
                const reference = oracleSinCos(input);
                sinObservations.push(observation(inputRaw, await harness.sin(inputRaw), reference.sin));
                cosObservations.push(observation(inputRaw, await harness.cos(inputRaw), reference.cos));
            }
        }

        const sinResult = characterize(sinObservations);
        const cosResult = characterize(cosObservations);
        const edgeCeiling = decimalFixed("0.0000000000005"); // 5e-13.

        printCharacterization("sin near k*pi/2", sinResult);
        printCharacterization("cos near k*pi/2", cosResult);

        expect(sinResult.maxAbsolute.absError).to.be.lte(edgeCeiling);
        expect(cosResult.maxAbsolute.absError).to.be.lte(edgeCeiling);
    });
});
