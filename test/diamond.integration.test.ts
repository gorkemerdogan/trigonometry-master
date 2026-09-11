// SPDX-License-Identifier: MIT
import { expect } from "chai";
import { ethers } from "hardhat";
import type { BaseContract, Signer } from "ethers";

const ONE = "0x3fff0000000000000000000000000000";

function selectors(contract: BaseContract, names: string[]): string[] {
    return names.map((name) => contract.interface.getFunction(name)!.selector);
}

async function deployConfiguredDiamond() {
    const [owner, nextOwner, outsider] = await ethers.getSigners();

    const cutFacet = await (await ethers.getContractFactory("DiamondCutFacet")).deploy();
    await cutFacet.waitForDeployment();
    const diamond = await (await ethers.getContractFactory("TrigonometryMaster")).deploy(
        await owner.getAddress(),
        await cutFacet.getAddress()
    );
    await diamond.waitForDeployment();

    const ownershipFacet = await (await ethers.getContractFactory("OwnershipFacet")).deploy();
    const loupeFacet = await (await ethers.getContractFactory("DiamondLoupeFacet")).deploy();
    const trigFacet = await (await ethers.getContractFactory("TrigonometryFacet")).deploy();
    await Promise.all([
        ownershipFacet.waitForDeployment(),
        loupeFacet.waitForDeployment(),
        trigFacet.waitForDeployment(),
    ]);

    const ownershipSelectors = selectors(ownershipFacet, ["owner", "transferOwnership"]);
    const loupeSelectors = selectors(loupeFacet, [
        "facets",
        "facetFunctionSelectors",
        "facetAddresses",
        "facetAddress",
    ]);
    const trigSelectors = selectors(trigFacet, ["sin", "cos", "tan", "cot", "asin", "acos", "atan"]);

    const diamondCut = await ethers.getContractAt("IDiamondCut", await diamond.getAddress());
    await diamondCut.diamondCut([
        { facetAddress: await ownershipFacet.getAddress(), action: 0, functionSelectors: ownershipSelectors },
        { facetAddress: await loupeFacet.getAddress(), action: 0, functionSelectors: loupeSelectors },
        { facetAddress: await trigFacet.getAddress(), action: 0, functionSelectors: trigSelectors },
    ], ethers.ZeroAddress, "0x");

    return {
        owner,
        nextOwner,
        outsider,
        diamond,
        cutFacet,
        ownershipFacet,
        loupeFacet,
        trigFacet,
        ownershipSelectors,
        loupeSelectors,
        trigSelectors,
        diamondCut,
    };
}

function sorted(values: readonly string[]): string[] {
    return [...values].map((value) => value.toLowerCase()).sort();
}

describe("TrigonometryMaster Diamond integration", function () {
    it("installs selectors, reports exact loupe state, and routes all trigonometry selectors", async function () {
        const deployment = await deployConfiguredDiamond();
        const diamondAddress = await deployment.diamond.getAddress();
        const loupe = await ethers.getContractAt("IDiamondLoupe", diamondAddress);
        const proxyTrig = await ethers.getContractAt("TrigonometryFacet", diamondAddress);

        const expectedFacets = [
            await deployment.cutFacet.getAddress(),
            await deployment.ownershipFacet.getAddress(),
            await deployment.loupeFacet.getAddress(),
            await deployment.trigFacet.getAddress(),
        ];
        expect(sorted(await loupe.facetAddresses())).to.deep.equal(sorted(expectedFacets));

        expect(sorted(await loupe.facetFunctionSelectors(await deployment.ownershipFacet.getAddress())))
            .to.deep.equal(sorted(deployment.ownershipSelectors));
        expect(sorted(await loupe.facetFunctionSelectors(await deployment.loupeFacet.getAddress())))
            .to.deep.equal(sorted(deployment.loupeSelectors));
        expect(sorted(await loupe.facetFunctionSelectors(await deployment.trigFacet.getAddress())))
            .to.deep.equal(sorted(deployment.trigSelectors));

        for (const selector of deployment.trigSelectors) {
            expect(await loupe.facetAddress(selector)).to.equal(await deployment.trigFacet.getAddress());
        }

        const facetRows = await loupe.facets();
        const rowByAddress = new Map(
            facetRows.map((row) => [row.facetAddress.toLowerCase(), sorted(row.functionSelectors)])
        );
        expect(rowByAddress.get((await deployment.trigFacet.getAddress()).toLowerCase()))
            .to.deep.equal(sorted(deployment.trigSelectors));

        for (const name of ["sin", "cos", "tan", "cot", "asin", "acos", "atan"] as const) {
            expect(await proxyTrig[name](ONE), `${name} proxy result`)
                .to.equal(await deployment.trigFacet[name](ONE));
        }
    });

    it("enforces owner-only upgrades and ownership changes through the proxy", async function () {
        const deployment = await deployConfiguredDiamond();
        const diamondAddress = await deployment.diamond.getAddress();
        const ownership = await ethers.getContractAt("OwnershipFacet", diamondAddress);
        const loupe = await ethers.getContractAt("IDiamondLoupe", diamondAddress);
        const sinSelector = deployment.trigFacet.interface.getFunction("sin")!.selector;

        const emptyCut: Array<{ facetAddress: string; action: number; functionSelectors: string[] }> = [];
        await expect(deployment.diamondCut.connect(deployment.outsider as Signer)
            .diamondCut(emptyCut, ethers.ZeroAddress, "0x"))
            .to.be.revertedWith("LibTrigMaster: Must be contract owner");
        await expect(ownership.connect(deployment.outsider as Signer)
            .transferOwnership(await deployment.outsider.getAddress()))
            .to.be.revertedWith("LibTrigMaster: Must be contract owner");

        await ownership.transferOwnership(await deployment.nextOwner.getAddress());
        expect(await ownership.owner()).to.equal(await deployment.nextOwner.getAddress());

        await expect(deployment.diamondCut.diamondCut(emptyCut, ethers.ZeroAddress, "0x"))
            .to.be.revertedWith("LibTrigMaster: Must be contract owner");

        const replacement = await (await ethers.getContractFactory("TrigonometryFacet")).deploy();
        await replacement.waitForDeployment();
        const nextOwnerCut = deployment.diamondCut.connect(deployment.nextOwner as Signer);
        await nextOwnerCut.diamondCut([{
            facetAddress: await replacement.getAddress(),
            action: 1,
            functionSelectors: [sinSelector],
        }], ethers.ZeroAddress, "0x");

        expect(await loupe.facetAddress(sinSelector)).to.equal(await replacement.getAddress());
        const proxyTrig = await ethers.getContractAt("TrigonometryFacet", diamondAddress);
        expect(await proxyTrig.sin(ONE)).to.equal(await replacement.sin(ONE));

        await nextOwnerCut.diamondCut([{
            facetAddress: ethers.ZeroAddress,
            action: 2,
            functionSelectors: [sinSelector],
        }], ethers.ZeroAddress, "0x");

        expect(await loupe.facetAddress(sinSelector)).to.equal(ethers.ZeroAddress);
        await expect(proxyTrig.sin(ONE)).to.be.revertedWith("TrigonometryMaster: Function not found");
    });
});
