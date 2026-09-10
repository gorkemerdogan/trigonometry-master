// SPDX-License-Identifier: MIT
import { expect } from "chai";
import { ethers } from "hardhat";
import type { Contract } from "ethers";
import {
    createTransactionFailureCounts,
    estimateGas,
    Harness,
    measureTransactionGas,
} from "./test-utils";

type TrigonometryHarness = Contract & {
    fromFloat(x: bigint): Promise<string>;
};

const QNAN = "0x7fff8000000000000000000000000000";

describe("Benchmark utility execution semantics", function () {
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

    it("distinguishes estimateGas from transaction receipt gas", async function () {
        const zero = await harness.fromFloat(0n);
        const benchmarkHarness = harness as unknown as Harness;
        const counts = createTransactionFailureCounts();

        const estimate = await estimateGas(benchmarkHarness, "sin", [zero]);
        const receiptGas = await measureTransactionGas(benchmarkHarness, "sin", [zero], counts);

        expect(estimate).to.be.greaterThan(0n);
        expect(receiptGas).to.be.greaterThan(0n);
        expect(counts).to.deep.equal({successful: 1, reverted: 0, outOfGas: 0, other: 0});
    });

    it("propagates failed estimates and transactions instead of hiding them", async function () {
        const benchmarkHarness = harness as unknown as Harness;
        const counts = createTransactionFailureCounts();

        await expect(estimateGas(benchmarkHarness, "sin", [QNAN]))
            .to.be.revertedWith("TRIG_NAN_ANGLE");
        await expect(measureTransactionGas(benchmarkHarness, "sin", [QNAN], counts))
            .to.be.revertedWith("TRIG_NAN_ANGLE");
        expect(counts).to.deep.equal({successful: 0, reverted: 1, outOfGas: 0, other: 0});
    });
});
