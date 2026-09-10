// SPDX-License-Identifier: MIT
import { expect } from "chai";
import { ethers } from "hardhat";

const POSITIVE_ZERO = "0x00000000000000000000000000000000";
const NEGATIVE_ZERO = "0x80000000000000000000000000000000";
const POSITIVE_ONE = "0x3fff0000000000000000000000000000";
const NEGATIVE_ONE = "0xbfff0000000000000000000000000000";
const POSITIVE_INFINITY = "0x7fff0000000000000000000000000000";
const NEGATIVE_INFINITY = "0xffff0000000000000000000000000000";
const QNAN = "0x7fff8000000000000000000000000000";

describe("MathLib special-value behavior", function () {
    it("matches documented ABDK division-by-zero semantics", async function () {
        const MathLibFactory = await ethers.getContractFactory("MathLib");
        const mathLib = await MathLibFactory.deploy();
        await mathLib.waitForDeployment();

        expect(await mathLib.div(POSITIVE_ONE, POSITIVE_ZERO)).to.equal(POSITIVE_INFINITY);
        expect(await mathLib.div(POSITIVE_ONE, NEGATIVE_ZERO)).to.equal(NEGATIVE_INFINITY);
        expect(await mathLib.div(NEGATIVE_ONE, POSITIVE_ZERO)).to.equal(NEGATIVE_INFINITY);
        expect(await mathLib.div(POSITIVE_ZERO, POSITIVE_ZERO)).to.equal(QNAN);
        expect(await mathLib.floorQuad(NEGATIVE_ZERO)).to.equal(NEGATIVE_ZERO);
        expect(await mathLib.floorInt(NEGATIVE_ZERO)).to.equal(0n);
    });
});
