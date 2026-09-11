// SPDX-License-Identifier: MIT
import {expect} from "chai";
import {ethers} from "hardhat";
import type {BaseContract, ContractFactory} from "ethers";
import {Harness, measureTransactionGas} from "./test-utils";

type TrigMethod = "sin" | "cos" | "tan" | "cot" | "asin" | "acos" | "atan";
type Variant = {name: string; contract: BaseContract; deploymentGas: bigint; runtimeBytes: number};
type Summary = {average: bigint; minimum: bigint; maximum: bigint};

const EIP170_LIMIT = 24_576;
const PROJECT_LIMIT = 23_000;
const ZERO = "0x00000000000000000000000000000000";
const NEG_ZERO = "0x80000000000000000000000000000000";
const QUARTER = "0x3ffd0000000000000000000000000000";
const HALF = "0x3ffe0000000000000000000000000000";
const NEG_HALF = "0xbffe0000000000000000000000000000";
const THREE_QUARTERS = "0x3ffe8000000000000000000000000000";
const NEG_THREE_QUARTERS = "0xbffe8000000000000000000000000000";
const ONE = "0x3fff0000000000000000000000000000";
const NEG_ONE = "0xbfff0000000000000000000000000000";
const TWO = "0x40000000000000000000000000000000";
const THREE = "0x40008000000000000000000000000000";
const NEG_THREE = "0xc0008000000000000000000000000000";
const HALF_PI = "0x3fff921fb54442d18469898cc51701b8";
const PI = "0x4000921fb54442d18469898cc51701b8";
const MAX_ARGUMENT = "0x401f0000000000000000000000000000";
const ABOVE_MAX_ARGUMENT = "0x401f0000000000000000000000000001";
const NAN = "0x7fff8000000000000000000000000000";
const POSITIVE_INFINITY = "0x7fff0000000000000000000000000000";
const NEGATIVE_INFINITY = "0xffff0000000000000000000000000000";

const DIRECT_INPUTS = [NEG_THREE, NEG_ONE, NEG_ZERO, ZERO, QUARTER, ONE, HALF_PI, TWO, PI, MAX_ARGUMENT];
const INVERSE_INPUTS: Record<"asin" | "acos" | "atan", string[]> = {
    asin: [NEG_ONE, NEG_THREE_QUARTERS, NEG_HALF, NEG_ZERO, ZERO, QUARTER, HALF, THREE_QUARTERS, ONE, TWO, NAN, POSITIVE_INFINITY],
    acos: [NEG_ONE, NEG_THREE_QUARTERS, NEG_HALF, NEG_ZERO, ZERO, QUARTER, HALF, THREE_QUARTERS, ONE, TWO, NAN, POSITIVE_INFINITY],
    atan: [NEGATIVE_INFINITY, NEG_THREE, NEG_ONE, NEG_ZERO, ZERO, QUARTER, ONE, THREE, POSITIVE_INFINITY, NAN],
};

async function deploymentGas(contract: BaseContract, label: string): Promise<bigint> {
    const transaction = contract.deploymentTransaction();
    if (transaction === null) throw new Error(`No deployment transaction for ${label}`);
    const receipt = await transaction.wait();
    if (receipt === null || receipt.status !== 1) throw new Error(`Deployment failed for ${label}`);
    return receipt.gasUsed;
}

async function deploy(name: string, factory: ContractFactory): Promise<Variant> {
    const contract = await factory.deploy();
    const gas = await deploymentGas(contract, name);
    const code = await ethers.provider.getCode(await contract.getAddress());
    expect(code, `${name} runtime code`).not.to.equal("0x");
    return {name, contract, deploymentGas: gas, runtimeBytes: (code.length - 2) / 2};
}

function summarize(values: bigint[]): Summary {
    return {
        average: values.reduce((sum, value) => sum + value, 0n) / BigInt(values.length),
        minimum: values.reduce((a, b) => a < b ? a : b),
        maximum: values.reduce((a, b) => a > b ? a : b),
    };
}

function percentSaved(before: bigint, after: bigint): string {
    return ((1 - Number(after) / Number(before)) * 100).toFixed(1);
}

describe("Production-shaped linked MathLib vs internal ABDK characterization", function () {
    this.timeout(180_000);

    let mathLibGas: bigint;
    let linked: Variant;
    let inlined: Variant;
    let linkedPaired: Variant;
    let inlinedPaired: Variant;

    before(async function () {
        const mathLib = await (await ethers.getContractFactory("MathLib")).deploy();
        mathLibGas = await deploymentGas(mathLib, "MathLib");
        const libraries = {MathLib: await mathLib.getAddress()};

        linked = await deploy(
            "frozen pre-inlining linked facet",
            await ethers.getContractFactory("LinkedTrigonometryFacetShape", {libraries})
        );
        inlined = await deploy(
            "production inlined facet",
            await ethers.getContractFactory("TrigonometryFacet")
        );
        linkedPaired = await deploy(
            "linked facet plus sincos",
            await ethers.getContractFactory("LinkedTrigonometryInliningBenchmarkHarness", {libraries})
        );
        inlinedPaired = await deploy(
            "inlined facet plus sincos",
            await ethers.getContractFactory("InlinedTrigonometryBenchmarkHarness")
        );
    });

    it("requires raw bit-identical results and matching direct-function range failures", async function () {
        const linkedCalls = linked.contract as unknown as Harness;
        const inlinedCalls = inlined.contract as unknown as Harness;

        for (const method of ["sin", "cos", "tan", "cot"] as const) {
            for (const input of DIRECT_INPUTS) {
                expect(await inlinedCalls[method](input), `${method} at ${input}`)
                    .to.equal(await linkedCalls[method](input));
            }
            await expect(linkedCalls[method](ABOVE_MAX_ARGUMENT)).to.be.revertedWith("TRIG_ARGUMENT_OUT_OF_RANGE");
            await expect(inlinedCalls[method](ABOVE_MAX_ARGUMENT)).to.be.revertedWith("TRIG_ARGUMENT_OUT_OF_RANGE");
            await expect(linkedCalls[method](NAN)).to.be.revertedWith("TRIG_NAN_ANGLE");
            await expect(inlinedCalls[method](NAN)).to.be.revertedWith("TRIG_NAN_ANGLE");
            await expect(linkedCalls[method](POSITIVE_INFINITY)).to.be.revertedWith("TRIG_INFINITE_ANGLE");
            await expect(inlinedCalls[method](POSITIVE_INFINITY)).to.be.revertedWith("TRIG_INFINITE_ANGLE");
        }

        for (const method of ["asin", "acos", "atan"] as const) {
            for (const input of INVERSE_INPUTS[method]) {
                expect(await inlinedCalls[method](input), `${method} at ${input}`)
                    .to.equal(await linkedCalls[method](input));
            }
        }

        const linkedPairCalls = linkedPaired.contract as unknown as Harness;
        const inlinedPairCalls = inlinedPaired.contract as unknown as Harness;
        for (const input of DIRECT_INPUTS) {
            const expected = await linkedPairCalls.sincos(input);
            const actual = await inlinedPairCalls.sincos(input);
            expect(actual[0], `sincos.sin at ${input}`).to.equal(expected[0]);
            expect(actual[1], `sincos.cos at ${input}`).to.equal(expected[1]);
        }
    });

    it("reports per-entry receipt gas and the exact production-shape size delta", async function () {
        const linkedCalls = linked.contract as unknown as Harness;
        const inlinedCalls = inlined.contract as unknown as Harness;
        const results = new Map<TrigMethod | "sincos", {linked: Summary; inlined: Summary}>();

        for (const method of ["sin", "cos", "tan", "cot", "asin", "acos", "atan"] as const) {
            const inputs = method === "asin" || method === "acos" || method === "atan"
                ? INVERSE_INPUTS[method]
                : DIRECT_INPUTS;
            const linkedSamples: bigint[] = [];
            const inlinedSamples: bigint[] = [];
            for (const input of inputs) {
                linkedSamples.push(await measureTransactionGas(linkedCalls, method, [input]));
                inlinedSamples.push(await measureTransactionGas(inlinedCalls, method, [input]));
            }
            results.set(method, {linked: summarize(linkedSamples), inlined: summarize(inlinedSamples)});
        }

        const linkedPairCalls = linkedPaired.contract as unknown as Harness;
        const inlinedPairCalls = inlinedPaired.contract as unknown as Harness;
        const linkedPairSamples: bigint[] = [];
        const inlinedPairSamples: bigint[] = [];
        for (const input of DIRECT_INPUTS) {
            linkedPairSamples.push(await measureTransactionGas(linkedPairCalls, "sincos", [input]));
            inlinedPairSamples.push(await measureTransactionGas(inlinedPairCalls, "sincos", [input]));
        }
        results.set("sincos", {linked: summarize(linkedPairSamples), inlined: summarize(inlinedPairSamples)});

        console.log("------------------------------------------------------------");
        console.log("PRODUCTION-SHAPED LINKED VS INLINED ABDK: RECEIPT GAS");
        console.log("------------------------------------------------------------");
        console.log("Values include intrinsic/calldata gas. Reverts are checked separately and never omitted as samples.");
        console.log("method   linked avg [min,max]          inlined avg [min,max]         saved avg (%)");
        for (const method of ["sin", "cos", "tan", "cot", "asin", "acos", "atan", "sincos"] as const) {
            const result = results.get(method)!;
            console.log(
                `${method.padEnd(9)}` +
                `${`${result.linked.average} [${result.linked.minimum},${result.linked.maximum}]`.padEnd(30)}` +
                `${`${result.inlined.average} [${result.inlined.minimum},${result.inlined.maximum}]`.padEnd(30)}` +
                `${result.linked.average - result.inlined.average} (${percentSaved(result.linked.average, result.inlined.average)}%)`
            );
        }

        const projectLinkedHeadroom = PROJECT_LIMIT - linked.runtimeBytes;
        const projectInlinedHeadroom = PROJECT_LIMIT - inlined.runtimeBytes;
        const eipLinkedHeadroom = EIP170_LIMIT - linked.runtimeBytes;
        const eipInlinedHeadroom = EIP170_LIMIT - inlined.runtimeBytes;
        console.log("------------------------------------------------------------");
        console.log("EXACT SEVEN-SELECTOR FACET SIZE / DEPLOYMENT");
        console.log("------------------------------------------------------------");
        console.log(`MathLib deployment (linked architecture, separate): ${mathLibGas} gas`);
        console.log(`linked : runtime=${linked.runtimeBytes} | deploy=${linked.deploymentGas} | project_headroom=${projectLinkedHeadroom} | eip170_headroom=${eipLinkedHeadroom}`);
        console.log(`inline : runtime=${inlined.runtimeBytes} | deploy=${inlined.deploymentGas} | project_headroom=${projectInlinedHeadroom} | eip170_headroom=${eipInlinedHeadroom}`);
        console.log(`inline-minus-linked: runtime=${inlined.runtimeBytes - linked.runtimeBytes} | deploy=${inlined.deploymentGas - linked.deploymentGas}`);
        console.log(`paired benchmark shapes: linked=${linkedPaired.runtimeBytes} bytes/${linkedPaired.deploymentGas} gas | inline=${inlinedPaired.runtimeBytes} bytes/${inlinedPaired.deploymentGas} gas`);

        expect(linked.runtimeBytes).to.equal(21_814);
        expect(inlined.runtimeBytes).to.be.lessThanOrEqual(PROJECT_LIMIT);
        expect(inlined.runtimeBytes).to.be.lessThanOrEqual(EIP170_LIMIT);
    });
});
