// SPDX-License-Identifier: MIT
import {ethers} from "hardhat";
import type {Contract} from "ethers";
import {
    createTransactionFailureCounts,
    measureTransactionGas,
    printBlockRegular,
    printTransactionFailureSummary,
} from "./test-utils";

// ------------------------------------------------------------
// Types
// ------------------------------------------------------------

type TrigHarness = Contract & {
    fromFloat(x: bigint): Promise<string>;
    toFloat(q: string): Promise<bigint>;

    sin(x: string): Promise<string>;
    cos(x: string): Promise<string>;
    tan(x: string): Promise<string>;
    cot(x: string): Promise<string>;

    asin(x: string): Promise<string>;
    acos(x: string): Promise<string>;
    atan(x: string): Promise<string>;

    add(a: string, b: string): Promise<string>;
    benchmarkIdentity(x: string): Promise<string>;

    QPI(): Promise<string>;
    QHALF_PI(): Promise<string>;
    isNaN(x: string): Promise<boolean>;
};

// ------------------------------------------------------------
// Constants & Helpers
// ------------------------------------------------------------

const SCALE = 1e12;
const EXECUTION_MODEL = "transaction_plus_call_result";
const EXECUTION_PATH = "harness_direct";
const GAS_MEASUREMENT = "transaction_receipt_gas (callback-free)";
const RESULT_EXECUTION = "eth_call_result";
const HARNESS_SCOPE = "Harness-direct receipt gas excludes TrigonometryFacet, Diamond fallback routing, deployment, diamond-cut installation, and MathLib deployment costs.";

async function toQuad(h: TrigHarness, x: number): Promise<string> {
    return h.fromFloat(BigInt(Math.round(x * SCALE)));
}

async function fromQuad(h: TrigHarness, q: string): Promise<number> {
    const scaled = await h.toFloat(q);
    return Number(scaled) / SCALE;
}

function fmt(x: number): string {
    if (Number.isNaN(x)) return "NaN";
    if (!Number.isFinite(x)) return String(x);
    return x.toFixed(12);
}

function avgBigInt(values: bigint[]): bigint {
    if (values.length === 0) return 0n;
    return values.reduce((a, b) => a + b, 0n) / BigInt(values.length);
}

function minBigInt(values: bigint[]): bigint {
    if (values.length === 0) return 0n;
    return values.reduce((a, b) => (a < b ? a : b));
}

function maxBigInt(values: bigint[]): bigint {
    if (values.length === 0) return 0n;
    return values.reduce((a, b) => (a > b ? a : b));
}

async function qHalfPiMinusEpsilon(
    h: TrigHarness,
    qhalfPi: string,
    epsilonRad: number
): Promise<string> {
    const qNegEps = await h.fromFloat(BigInt(Math.round(-epsilonRad * SCALE)));
    return await h.add(qhalfPi, qNegEps);
}

/**
 * Uses Math.PI for general degree-to-radian conversion, but injects exact
 * quad constants at critical angles so that special-case fast paths can be observed.
 */
async function degreeToQuadWithExactCriticalAngles(
    h: TrigHarness,
    deg: number,
    qpi: string,
    qhalfPi: string
): Promise<string> {
    if (deg === 0) return await toQuad(h, 0);
    if (deg === 90) return qhalfPi;
    if (deg === 180) return qpi;
    if (deg === 270) return await h.add(qpi, qhalfPi);
    if (deg === 360) return await h.add(qpi, qpi);

    const rad = (deg * Math.PI) / 180;
    return await toQuad(h, rad);
}

// ------------------------------------------------------------
// Test Suite
// ------------------------------------------------------------

describe("Trigonometry - Gas Growth Tests", function () {
    let harness: TrigHarness;

    let QPI: string;
    let QHALF_PI: string;

    before(async () => {
        const MathLibFactory = await ethers.getContractFactory("MathLib");
        const math = await MathLibFactory.deploy();
        await math.waitForDeployment();

        const HF = await ethers.getContractFactory("TrigonometryHarness", {
            libraries: {
                "contracts/libraries/MathLib.sol:MathLib": await math.getAddress(),
            },
        });

        harness = (await HF.deploy()) as unknown as TrigHarness;
        await harness.waitForDeployment();

        QPI = await harness.QPI();
        QHALF_PI = await harness.QHALF_PI();
    });

    it("reports a direct-harness transaction/calldata baseline without subtracting it", async function () {
        const counts = createTransactionFailureCounts();
        const input = await toQuad(harness, Math.PI / 4);
        const calldata = harness.interface.encodeFunctionData("benchmarkIdentity", [input]);
        const baselineGas = await measureTransactionGas(harness, "benchmarkIdentity", [input], counts);

        console.log("------------------------------------------------------------");
        console.log("DIRECT-HARNESS TRANSACTION/CALLDATA BASELINE");
        console.log("------------------------------------------------------------");
        console.log(`Execution path: ${EXECUTION_PATH}; gas metric: ${GAS_MEASUREMENT}.`);
        console.log(HARNESS_SCOPE);
        console.log(`Method: benchmarkIdentity(bytes16); calldata bytes: ${(calldata.length - 2) / 2}.`);
        console.log(`Baseline receipt gas: ${baselineGas}. This baseline is reported separately and is not subtracted from trig receipt gas.`);
        printTransactionFailureSummary("Direct-harness baseline", counts);
    });

    // ------------------------------------------------------------
    // Section 1: Gas Sensitivity to Input Magnitude
    // ------------------------------------------------------------

    describe("Section 1: Gas Sensitivity to Input Magnitude", function () {
        let testNo = 0;
        const counts = createTransactionFailureCounts();

        after(function () {
            console.log(`Section 1 scope: ${HARNESS_SCOPE}`);
            printTransactionFailureSummary("Section 1", counts);
        });

        const INV_CASES: number[] = Array.from({ length: 2001 }, (_, i) =>
            Number((-1 + i * 0.001).toFixed(3))
        );

        function buildPiecewiseRange(
            start: number,
            end: number,
            step: number
        ): number[] {
            const values: number[] = [];
            for (let x = start; x <= end + 1e-12; x += step) {
                values.push(Number(x.toFixed(6)));
            }
            return values;
        }

        function uniqueSorted(values: number[]): number[] {
            return Array.from(new Set(values.map(v => Number(v.toFixed(6))))).sort((a, b) => a - b);
        }

        const DIRECT_CASES: number[] = uniqueSorted([
            ...buildPiecewiseRange(-1000, -100, 10),
            ...buildPiecewiseRange(-99, -10, 1),
            ...buildPiecewiseRange(-9.9, -1, 0.1),
            ...buildPiecewiseRange(-0.99, 1, 0.01),
            ...buildPiecewiseRange(1.01, 10, 0.1),
            ...buildPiecewiseRange(11, 100, 1),
            ...buildPiecewiseRange(110, 1000, 10),
            0
        ]);

        const ATAN_CASES: number[] = uniqueSorted([
            ...buildPiecewiseRange(-1000, -100, 10),
            ...buildPiecewiseRange(-99, -10, 1),
            ...buildPiecewiseRange(-9.9, -1, 0.1),
            ...buildPiecewiseRange(-0.99, 1, 0.01),
            ...buildPiecewiseRange(1.01, 10, 0.1),
            ...buildPiecewiseRange(11, 100, 1),
            ...buildPiecewiseRange(110, 1000, 10),
            0
        ]);

        const DIRECT_METHODS: Array<{ method: "sin" | "cos" | "tan" | "cot"; label: string }> = [
            {method: "sin", label: "sin"},
            {method: "cos", label: "cos"},
            {method: "tan", label: "tan"},
            {method: "cot", label: "cot"},
        ];

        const INV_METHODS: Array<{ method: "asin" | "acos"; label: string }> = [
            {method: "asin", label: "asin"},
            {method: "acos", label: "acos"},
        ];

        for (const m of DIRECT_METHODS) {
            for (const x of DIRECT_CASES) {
                const t = `1.${++testNo}`;

                it(`Test ${t}: ${m.label} gas sensitivity for x=${x}`, async function () {
                    const qx = await toQuad(harness, x);

                    const gas = await measureTransactionGas(harness, m.method, [qx], counts);

                    const out =
                        m.method === "sin" ? await harness.sin(qx) :
                            m.method === "cos" ? await harness.cos(qx) :
                                m.method === "tan" ? await harness.tan(qx) :
                                    await harness.cot(qx);

                    const isNan = await harness.isNaN(out);

                    printBlockRegular({
                        t: `${t}`,
                        method: m.label,
                        explanation: `Gas sensitivity to input magnitude using x=${x}; result is read separately by eth_call.`,
                        gas: gas.toString(),
                        executionModel: EXECUTION_MODEL,
                        executionPath: EXECUTION_PATH,
                        gasMeasurement: GAS_MEASUREMENT,
                        resultExecution: RESULT_EXECUTION,
                        inHex: `x=${x}`,
                        expectedHex: "N/A",
                        outHex: out,
                        expectedDec: "N/A",
                        outDec: isNan ? "NaN" : fmt(await fromQuad(harness, out)),
                    });
                });
            }
        }

        for (const m of INV_METHODS) {
            for (const x of INV_CASES) {
                const t = `1.${++testNo}`;

                it(`Test ${t}: ${m.label} gas sensitivity for x=${x}`, async function () {
                    const qx = await toQuad(harness, x);

                    const gas = await measureTransactionGas(harness, m.method, [qx], counts);

                    const out =
                        m.method === "asin"
                            ? await harness.asin(qx)
                            : await harness.acos(qx);

                    const isNan = await harness.isNaN(out);

                    printBlockRegular({
                        t: `${t}`,
                        method: m.label,
                        explanation: `Gas sensitivity to input magnitude using x=${x}; result is read separately by eth_call.`,
                        gas: gas.toString(),
                        executionModel: EXECUTION_MODEL,
                        executionPath: EXECUTION_PATH,
                        gasMeasurement: GAS_MEASUREMENT,
                        resultExecution: RESULT_EXECUTION,
                        inHex: `x=${x}`,
                        expectedHex: "N/A",
                        outHex: out,
                        expectedDec: "N/A",
                        outDec: isNan ? "NaN" : fmt(await fromQuad(harness, out)),
                    });
                });
            }
        }

        for (const x of ATAN_CASES) {
            const t = `1.${++testNo}`;

            it(`Test ${t}: atan gas sensitivity for x=${x}`, async function () {
                const qx = await toQuad(harness, x);

                const gas = await measureTransactionGas(harness, "atan", [qx], counts);

                const out = await harness.atan(qx);
                const isNan = await harness.isNaN(out);

                printBlockRegular({
                    t: `${t}`,
                    method: "atan",
                    explanation: `Gas sensitivity to input magnitude using x=${x}; result is read separately by eth_call.`,
                    gas: gas.toString(),
                    executionModel: EXECUTION_MODEL,
                    executionPath: EXECUTION_PATH,
                    gasMeasurement: GAS_MEASUREMENT,
                    resultExecution: RESULT_EXECUTION,
                    inHex: `x=${x}`,
                    expectedHex: "N/A",
                    outHex: out,
                    expectedDec: "N/A",
                    outDec: isNan ? "NaN" : fmt(await fromQuad(harness, out)),
                });
            });
        }
    });

    // ------------------------------------------------------------
    // Section 2: Gas Sensitivity to Critical Region for Tangent
    // ------------------------------------------------------------

    describe("Section 2: Gas Sensitivity to Critical Region for Tangent", function () {
        let testNo = 0;
        const counts = createTransactionFailureCounts();

        after(function () {
            console.log(`Section 2 scope: ${HARNESS_SCOPE}`);
            printTransactionFailureSummary("Section 2", counts);
        });

        const EPSILON = 1e-6;

        const TAN_CRITICAL_CASES: Array<{
            label: string;
            buildInput: () => Promise<string>;
        }> = [
            {
                label: "0",
                buildInput: async () => await toQuad(harness, 0),
            },
            {
                label: "π/4",
                buildInput: async () => await toQuad(harness, Math.PI / 4),
            },
            {
                label: "π/3",
                buildInput: async () => await toQuad(harness, Math.PI / 3),
            },
            {
                label: "π/2-ε",
                buildInput: async () => await qHalfPiMinusEpsilon(harness, QHALF_PI, EPSILON),
            },
        ];

        for (const c of TAN_CRITICAL_CASES) {
            const t = `2.${++testNo}`;

            it(`Test ${t}: tan gas sensitivity at critical region ${c.label}`, async function () {
                const qx = await c.buildInput();

                const gas = await measureTransactionGas(harness, "tan", [qx], counts);

                const out = await harness.tan(qx);
                const isNan = await harness.isNaN(out);

                printBlockRegular({
                    t,
                    method: "tan",
                    explanation: `Gas sensitivity to critical region using x=${c.label}; result is read separately by eth_call.`,
                    gas: gas.toString(),
                    executionModel: EXECUTION_MODEL,
                    executionPath: EXECUTION_PATH,
                    gasMeasurement: GAS_MEASUREMENT,
                    resultExecution: RESULT_EXECUTION,
                    inHex: `x=${c.label}`,
                    expectedHex: "N/A",
                    outHex: out,
                    expectedDec: "N/A",
                    outDec: isNan ? "NaN" : fmt(await fromQuad(harness, out)),
                });
            });
        }
    });

    // ------------------------------------------------------------
    // Section 3: Full-Domain Receipt-Gas Consistency Check (1 degree resolution)
    // ------------------------------------------------------------

    describe("Section 3: Full-Domain Receipt-Gas Consistency Check", function () {
        let testNo = 0;
        const counts = createTransactionFailureCounts();

        // Duplicate submissions check deterministic local receipt gas only. They are
        // not independent statistical samples, and a completed transaction cannot
        // warm EVM access state for any later transaction.
        const IDENTICAL_TRANSACTION_COUNT = 5;

        after(function () {
            printTransactionFailureSummary("Section 3", counts);
        });

        it("Test 3.1: sin & cos receipt gas over [0°, 360°] with duplicate transaction consistency checks", async function () {
            const startDeg = 0;
            const endDeg = 360;

            let totalSin = 0n;
            let totalCos = 0n;

            let minSin = 10n ** 18n;
            let maxSin = 0n;

            let minCos = 10n ** 18n;
            let maxCos = 0n;

            for (let deg = startDeg; deg <= endDeg; deg++) {
                const qx = await degreeToQuadWithExactCriticalAngles(harness, deg, QPI, QHALF_PI);

                const sinGasRuns: bigint[] = [];
                const cosGasRuns: bigint[] = [];

                let lastSinOut = "";
                let lastCosOut = "";
                let lastSinVal = 0;
                let lastCosVal = 0;

                for (let run = 1; run <= IDENTICAL_TRANSACTION_COUNT; run++) {
                    // ---- sin ----
                    const sinGas = await measureTransactionGas(harness, "sin", [qx], counts);
                    const sinOut = await harness.sin(qx);
                    const sinVal = await fromQuad(harness, sinOut);

                    sinGasRuns.push(sinGas);
                    lastSinOut = sinOut;
                    lastSinVal = sinVal;

                    // ---- cos ----
                    const cosGas = await measureTransactionGas(harness, "cos", [qx], counts);
                    const cosOut = await harness.cos(qx);
                    const cosVal = await fromQuad(harness, cosOut);

                    cosGasRuns.push(cosGas);
                    lastCosOut = cosOut;
                    lastCosVal = cosVal;
                }

                const sinAvgGas = avgBigInt(sinGasRuns);
                const cosAvgGas = avgBigInt(cosGasRuns);

                totalSin += sinAvgGas;
                totalCos += cosAvgGas;

                if (sinAvgGas < minSin) minSin = sinAvgGas;
                if (sinAvgGas > maxSin) maxSin = sinAvgGas;

                if (cosAvgGas < minCos) minCos = cosAvgGas;
                if (cosAvgGas > maxCos) maxCos = cosAvgGas;

                const t = `3.${++testNo}`;

                printBlockRegular({
                    t,
                    method: "sin",
                    explanation: `Arithmetic mean of ${IDENTICAL_TRANSACTION_COUNT} duplicate receipt transactions at ${deg}° (determinism check, not an independent sample; result read separately by eth_call).`,
                    gas: `${sinAvgGas}`,
                    executionModel: EXECUTION_MODEL,
                    executionPath: EXECUTION_PATH,
                    gasMeasurement: GAS_MEASUREMENT,
                    resultExecution: RESULT_EXECUTION,
                    inHex: `deg=${deg}`,
                    expectedHex: "N/A",
                    outHex: lastSinOut,
                    expectedDec: "N/A",
                    outDec: fmt(lastSinVal),
                });

                printBlockRegular({
                    t: `${t}-cos`,
                    method: "cos",
                    explanation: `Arithmetic mean of ${IDENTICAL_TRANSACTION_COUNT} duplicate receipt transactions at ${deg}° (determinism check, not an independent sample; result read separately by eth_call).`,
                    gas: `${cosAvgGas}`,
                    executionModel: EXECUTION_MODEL,
                    executionPath: EXECUTION_PATH,
                    gasMeasurement: GAS_MEASUREMENT,
                    resultExecution: RESULT_EXECUTION,
                    inHex: `deg=${deg}`,
                    expectedHex: "N/A",
                    outHex: lastCosOut,
                    expectedDec: "N/A",
                    outDec: fmt(lastCosVal),
                });
            }

            const sampleCount = BigInt(endDeg - startDeg + 1);
            const avgSin = totalSin / sampleCount;
            const avgCos = totalCos / sampleCount;

            console.log("------------------------------------------------------------");
            console.log("FULL DOMAIN RECEIPT-GAS CONSISTENCY SUMMARY");
            console.log("------------------------------------------------------------");
            console.log(
                `Execution model: ${EXECUTION_MODEL}; execution path: ${EXECUTION_PATH}; gas metric: ${GAS_MEASUREMENT}; result metric: ${RESULT_EXECUTION}. Input generation: Math.PI for general angles, exact quad constants for 0°, 90°, 180°, 270°, 360°. Each angle used ${IDENTICAL_TRANSACTION_COUNT} separate, identical transactions; their arithmetic mean is a deterministic consistency check, not a statistical estimate. EVM warm-access state resets between transactions.`
            );
            console.log(HARNESS_SCOPE);
            console.log(`sin -> representative mean: ${avgSin} | min: ${minSin} | max: ${maxSin}`);
            console.log(`cos -> representative mean: ${avgCos} | min: ${minCos} | max: ${maxCos}`);
        });
    });
});
