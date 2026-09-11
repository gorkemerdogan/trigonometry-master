// SPDX-License-Identifier: MIT
import {expect} from "chai";
import {ethers} from "hardhat";
import type {BaseContract, ContractFactory} from "ethers";
import {Harness, measureTransactionGas} from "./test-utils";

type Workload = "pair" | "tanLike" | "cotLike" | "asinNewton3";

type Variant = {
    name: string;
    contract: BaseContract;
    deploymentGas: bigint;
    runtimeBytes: number;
};

type GasSummary = {
    average: bigint;
    minimum: bigint;
    maximum: bigint;
};

const ANGLES = [
    {label: "-3", raw: "0xc0008000000000000000000000000000"},
    {label: "-1", raw: "0xbfff0000000000000000000000000000"},
    {label: "-0", raw: "0x80000000000000000000000000000000"},
    {label: "+0", raw: "0x00000000000000000000000000000000"},
    {label: "0.25", raw: "0x3ffd0000000000000000000000000000"},
    {label: "1", raw: "0x3fff0000000000000000000000000000"},
    {label: "pi/2", raw: "0x3fff921fb54442d18469898cc51701b8"},
    {label: "2", raw: "0x40000000000000000000000000000000"},
    {label: "pi", raw: "0x4000921fb54442d18469898cc51701b8"},
] as const;

const NEWTON_CASES = [
    {
        label: "target=-0.5, seed=-0.5",
        target: "0xbffe0000000000000000000000000000",
        initial: "0xbffe0000000000000000000000000000",
    },
    {
        label: "target=0.25, seed=0.25",
        target: "0x3ffd0000000000000000000000000000",
        initial: "0x3ffd0000000000000000000000000000",
    },
    {
        label: "target=0.5, seed=0.5",
        target: "0x3ffe0000000000000000000000000000",
        initial: "0x3ffe0000000000000000000000000000",
    },
] as const;

async function deploymentReceiptGas(contract: BaseContract, label: string): Promise<bigint> {
    const transaction = contract.deploymentTransaction();
    if (transaction === null) throw new Error(`No deployment transaction for ${label}`);
    const receipt = await transaction.wait();
    if (receipt === null || receipt.status !== 1) throw new Error(`Deployment failed for ${label}`);
    return receipt.gasUsed;
}

async function deployVariant(name: string, factory: ContractFactory): Promise<Variant> {
    const contract = await factory.deploy();
    const deploymentGas = await deploymentReceiptGas(contract, name);
    const runtimeCode = await ethers.provider.getCode(await contract.getAddress());
    expect(runtimeCode, `${name} runtime code`).not.to.equal("0x");
    return {
        name,
        contract,
        deploymentGas,
        runtimeBytes: (runtimeCode.length - 2) / 2,
    };
}

function summarize(samples: bigint[]): GasSummary {
    expect(samples.length).to.be.greaterThan(0);
    return {
        average: samples.reduce((sum, value) => sum + value, 0n) / BigInt(samples.length),
        minimum: samples.reduce((a, b) => a < b ? a : b),
        maximum: samples.reduce((a, b) => a > b ? a : b),
    };
}

function percentSaved(baseline: bigint, candidate: bigint): string {
    return ((1 - Number(candidate) / Number(baseline)) * 100).toFixed(1);
}

describe("Shared sincos A/B gas characterization", function () {
    this.timeout(120_000);

    let mathLibDeploymentGas: bigint;
    let separate: Variant;
    let shared: Variant;

    before(async function () {
        const MathLibFactory = await ethers.getContractFactory("MathLib");
        const mathLib = await MathLibFactory.deploy();
        mathLibDeploymentGas = await deploymentReceiptGas(mathLib, "MathLib");
        const libraries = {MathLib: await mathLib.getAddress()};

        separate = await deployVariant(
            "separate production sin+cos",
            await ethers.getContractFactory("SeparateSinCosBenchmarkHarness", {libraries})
        );
        shared = await deployVariant(
            "shared sincos",
            await ethers.getContractFactory("SharedSinCosBenchmarkHarness", {libraries})
        );
    });

    it("requires bit-identical pair, tan-like, cot-like, and Newton outputs", async function () {
        const separateCalls = separate.contract as unknown as Harness;
        const sharedCalls = shared.contract as unknown as Harness;

        for (const angle of ANGLES) {
            const separatePair = await separateCalls.pair(angle.raw);
            const sharedPair = await sharedCalls.pair(angle.raw);
            expect(sharedPair[0], `sin at ${angle.label}`).to.equal(separatePair[0]);
            expect(sharedPair[1], `cos at ${angle.label}`).to.equal(separatePair[1]);

            for (const workload of ["tanLike", "cotLike"] as const) {
                const expected = await separateCalls[workload](angle.raw);
                const actual = await sharedCalls[workload](angle.raw);
                expect(actual, `${workload} at ${angle.label}`).to.equal(expected);
            }
        }

        for (const testCase of NEWTON_CASES) {
            const expected = await separateCalls.asinNewton3(testCase.target, testCase.initial);
            const actual = await sharedCalls.asinNewton3(testCase.target, testCase.initial);
            expect(actual, `asinNewton3 ${testCase.label}`).to.equal(expected);
        }
    });

    it("reports transaction receipt gas and deployment impact", async function () {
        const measurements = new Map<string, Record<Workload, GasSummary>>();

        for (const variant of [separate, shared]) {
            const calls = variant.contract as unknown as Harness;
            const byWorkload = {} as Record<Workload, GasSummary>;

            for (const workload of ["pair", "tanLike", "cotLike"] as const) {
                const samples: bigint[] = [];
                for (const angle of ANGLES) {
                    samples.push(await measureTransactionGas(calls, workload, [angle.raw]));
                }
                byWorkload[workload] = summarize(samples);
            }

            const newtonSamples: bigint[] = [];
            for (const testCase of NEWTON_CASES) {
                newtonSamples.push(await measureTransactionGas(
                    calls,
                    "asinNewton3",
                    [testCase.target, testCase.initial]
                ));
            }
            byWorkload.asinNewton3 = summarize(newtonSamples);
            measurements.set(variant.name, byWorkload);
        }

        const baseline = measurements.get(separate.name)!;
        const candidate = measurements.get(shared.name)!;

        console.log("------------------------------------------------------------");
        console.log("SHARED SINCOS A/B: TRANSACTION RECEIPT GAS");
        console.log("------------------------------------------------------------");
        console.log("Angle workloads use nine deterministic values across signs, quadrants, zero, and exact poles.");
        console.log("Newton uses three deterministic cases with three refinements each.");
        console.log("Receipt values include intrinsic and calldata gas; failures are not suppressed.");
        console.log("workload       separate avg [min,max]       shared avg [min,max]         saved avg (%)");
        for (const workload of ["pair", "tanLike", "cotLike", "asinNewton3"] as const) {
            const before = baseline[workload];
            const after = candidate[workload];
            console.log(
                `${workload.padEnd(14)}` +
                `${`${before.average} [${before.minimum},${before.maximum}]`.padEnd(29)}` +
                `${`${after.average} [${after.minimum},${after.maximum}]`.padEnd(29)}` +
                `${before.average - after.average} (${percentSaved(before.average, after.average)}%)`
            );
        }

        console.log("------------------------------------------------------------");
        console.log("DEPLOYED RUNTIME SIZE AND DEPLOYMENT RECEIPT GAS");
        console.log("------------------------------------------------------------");
        console.log(`MathLib shared deployment: ${mathLibDeploymentGas} gas (reported separately)`);
        console.log("strategy                         runtime bytes   deployment gas");
        for (const variant of [separate, shared]) {
            console.log(
                `${variant.name.padEnd(32)} ${String(variant.runtimeBytes).padEnd(15)} ${variant.deploymentGas}`
            );
        }
        console.log(
            `shared-minus-separate: runtime ${shared.runtimeBytes - separate.runtimeBytes} bytes | ` +
            `deployment ${shared.deploymentGas - separate.deploymentGas} gas`
        );
    });
});
