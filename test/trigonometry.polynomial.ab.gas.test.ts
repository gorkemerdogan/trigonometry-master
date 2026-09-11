// SPDX-License-Identifier: MIT
import {expect} from "chai";
import {ethers} from "hardhat";
import type {BaseContract, ContractFactory} from "ethers";
import {Harness, measureTransactionGas} from "./test-utils";

type CoreMethod = "sinCore" | "cosCore";

type DeployedVariant = {
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

const INPUTS = [
    {label: "-pi/4", raw: "0xbffe921fb54442d18469898cc51701b8"},
    {label: "-pi/8", raw: "0xbffd921fb54442d18469898cc51701b8"},
    {label: "zero", raw: "0x00000000000000000000000000000000"},
    {label: "+pi/8", raw: "0x3ffd921fb54442d18469898cc51701b8"},
    {label: "+pi/4", raw: "0x3ffe921fb54442d18469898cc51701b8"},
] as const;

const SIN_COEFFICIENTS = [
    {denominator: 6n, negative: true, raw: "0xbffc5555555555555555555555555555"},
    {denominator: 120n, negative: false, raw: "0x3ff81111111111111111111111111111"},
    {denominator: 5040n, negative: true, raw: "0xbff2a01a01a01a01a01a01a01a01a01a"},
    {denominator: 362880n, negative: false, raw: "0x3fec71de3a556c7338faac1c88e50017"},
    {denominator: 39916800n, negative: true, raw: "0xbfe5ae64567f544e38fe747e4b837dc7"},
    {denominator: 6227020800n, negative: false, raw: "0x3fde6124613a86d097ca38331d23af68"},
] as const;

const COS_COEFFICIENTS = [
    {denominator: 2n, negative: true, raw: "0xbffe0000000000000000000000000000"},
    {denominator: 24n, negative: false, raw: "0x3ffa5555555555555555555555555555"},
    {denominator: 720n, negative: true, raw: "0xbff56c16c16c16c16c16c16c16c16c16"},
    {denominator: 40320n, negative: false, raw: "0x3fefa01a01a01a01a01a01a01a01a01a"},
    {denominator: 3628800n, negative: true, raw: "0xbfe927e4fb7789f5c72ef016d3ea6678"},
    {denominator: 479001600n, negative: false, raw: "0x3fe21eed8eff8d897b544da987acfe84"},
] as const;

async function deploymentReceiptGas(contract: BaseContract, label: string): Promise<bigint> {
    const transaction = contract.deploymentTransaction();
    if (transaction === null) throw new Error(`No deployment transaction for ${label}`);
    const receipt = await transaction.wait();
    if (receipt === null || receipt.status !== 1) throw new Error(`Deployment failed for ${label}`);
    return receipt.gasUsed;
}

async function deployVariant(name: string, factory: ContractFactory): Promise<DeployedVariant> {
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

function percentChange(baseline: bigint, candidate: bigint): string {
    return (((Number(candidate) / Number(baseline)) - 1) * 100).toFixed(1);
}

describe("Sin/cos core polynomial A/B gas characterization", function () {
    this.timeout(120_000);

    let mathLib: BaseContract;
    let mathLibDeploymentGas: bigint;
    let variants: DeployedVariant[];
    let productionReference: BaseContract;

    before(async function () {
        const MathLibFactory = await ethers.getContractFactory("MathLib");
        mathLib = await MathLibFactory.deploy();
        mathLibDeploymentGas = await deploymentReceiptGas(mathLib, "MathLib");
        const libraries = {MathLib: await mathLib.getAddress()};

        variants = [
            await deployVariant(
                "linked/runtime coefficients",
                await ethers.getContractFactory("LinkedRuntimePolynomialHarness", {libraries})
            ),
            await deployVariant(
                "linked/raw constants",
                await ethers.getContractFactory("LinkedConstantPolynomialHarness", {libraries})
            ),
            await deployVariant(
                "internal/runtime coefficients",
                await ethers.getContractFactory("InternalRuntimePolynomialHarness")
            ),
            await deployVariant(
                "internal/raw constants",
                await ethers.getContractFactory("InternalConstantPolynomialHarness")
            ),
        ];

        const ReferenceFactory = await ethers.getContractFactory(
            "TrigonometryHighResolutionHarness",
            {libraries}
        );
        productionReference = await ReferenceFactory.deploy();
        await deploymentReceiptGas(productionReference, "TrigonometryHighResolutionHarness");
    });

    it("audits every raw constant against MathLib runtime construction", async function () {
        const callableMathLib = mathLib as unknown as Harness;
        const one = await callableMathLib.fromUInt(1n);
        expect(one).to.equal("0x3fff0000000000000000000000000000");

        for (const [family, coefficients] of [
            ["sin", SIN_COEFFICIENTS],
            ["cos", COS_COEFFICIENTS],
        ] as const) {
            for (const coefficient of coefficients) {
                const denominator = await callableMathLib.fromUInt(coefficient.denominator);
                let constructed = await callableMathLib.div(one, denominator);
                if (coefficient.negative) constructed = await callableMathLib.neg(constructed);
                expect(
                    constructed,
                    `${family} coefficient 1/${coefficient.denominator}`
                ).to.equal(coefficient.raw);
            }
        }
    });

    it("requires bit-identical outputs and verifies the production-style baseline", async function () {
        const baseline = variants[0].contract as unknown as Harness;
        const callableReference = productionReference as unknown as Harness;

        for (const input of INPUTS) {
            for (const method of ["sinCore", "cosCore"] as const) {
                const expected = await baseline[method](input.raw);
                const production = await callableReference[method](input.raw);
                expect(production, `${method} production parity at ${input.label}`).to.equal(expected);

                // Nonnegative core inputs take the identity reduction path, so the
                // public production entry point must match the prior runtime-
                // coefficient baseline bit-for-bit as well. Negative inputs retain
                // the separate modulo-reduction coverage in the accuracy suites.
                if (!input.label.startsWith("-")) {
                    const publicMethod = method === "sinCore" ? "sin" : "cos";
                    const publicOutput = await callableReference[publicMethod](input.raw);
                    expect(
                        publicOutput,
                        `${publicMethod} public production parity at ${input.label}`
                    ).to.equal(expected);
                }

                for (const variant of variants.slice(1)) {
                    const actual = await (variant.contract as unknown as Harness)[method](input.raw);
                    expect(actual, `${method} ${variant.name} at ${input.label}`).to.equal(expected);
                }
            }
        }
    });

    it("reports receipt gas, deployed runtime size, and deployment receipt gas", async function () {
        const gas = new Map<string, Record<CoreMethod, GasSummary>>();

        for (const variant of variants) {
            const byMethod = {} as Record<CoreMethod, GasSummary>;
            for (const method of ["sinCore", "cosCore"] as const) {
                const samples: bigint[] = [];
                for (const input of INPUTS) {
                    samples.push(await measureTransactionGas(
                        variant.contract as Harness,
                        method,
                        [input.raw]
                    ));
                }
                byMethod[method] = summarize(samples);
            }
            gas.set(variant.name, byMethod);
        }

        console.log("------------------------------------------------------------");
        console.log("SIN/COS CORE POLYNOMIAL A/B: TRANSACTION RECEIPT GAS");
        console.log("------------------------------------------------------------");
        console.log("Five inputs: -pi/4, -pi/8, 0, +pi/8, +pi/4. Values include intrinsic and calldata gas.");
        console.log("strategy                         sin avg [min,max]       cos avg [min,max]");
        for (const variant of variants) {
            const result = gas.get(variant.name)!;
            console.log(
                `${variant.name.padEnd(32)} ` +
                `${result.sinCore.average} [${result.sinCore.minimum},${result.sinCore.maximum}]`.padEnd(24) +
                `${result.cosCore.average} [${result.cosCore.minimum},${result.cosCore.maximum}]`
            );
        }

        const linkedRuntime = gas.get("linked/runtime coefficients")!;
        const linkedConstants = gas.get("linked/raw constants")!;
        const internalRuntime = gas.get("internal/runtime coefficients")!;
        const internalConstants = gas.get("internal/raw constants")!;
        console.log("------------------------------------------------------------");
        console.log("AVERAGE RECEIPT-GAS CHANGE (negative means less gas)");
        console.log(
            `linked constants vs linked runtime: sin ${percentChange(linkedRuntime.sinCore.average, linkedConstants.sinCore.average)}% | ` +
            `cos ${percentChange(linkedRuntime.cosCore.average, linkedConstants.cosCore.average)}%`
        );
        console.log(
            `internal runtime vs linked runtime: sin ${percentChange(linkedRuntime.sinCore.average, internalRuntime.sinCore.average)}% | ` +
            `cos ${percentChange(linkedRuntime.cosCore.average, internalRuntime.cosCore.average)}%`
        );
        console.log(
            `internal constants vs linked constants: sin ${percentChange(linkedConstants.sinCore.average, internalConstants.sinCore.average)}% | ` +
            `cos ${percentChange(linkedConstants.cosCore.average, internalConstants.cosCore.average)}%`
        );

        console.log("------------------------------------------------------------");
        console.log("DEPLOYED RUNTIME SIZE AND DEPLOYMENT RECEIPT GAS");
        console.log("------------------------------------------------------------");
        console.log(`MathLib shared deployment: ${mathLibDeploymentGas} gas (reported separately)`);
        console.log("strategy                         runtime bytes   deployment gas");
        for (const variant of variants) {
            console.log(
                `${variant.name.padEnd(32)} ${String(variant.runtimeBytes).padEnd(15)} ${variant.deploymentGas}`
            );
        }
        console.log("Linked harness rows exclude the one-time shared MathLib deployment.");
    });
});
