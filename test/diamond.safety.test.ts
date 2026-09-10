// SPDX-License-Identifier: MIT
import { expect } from "chai";
import { ethers } from "hardhat";

async function deployDiamond() {
    const [owner, other] = await ethers.getSigners();
    const DiamondCutFacetFactory = await ethers.getContractFactory("DiamondCutFacet");
    const diamondCutFacet = await DiamondCutFacetFactory.deploy();
    await diamondCutFacet.waitForDeployment();

    const DiamondFactory = await ethers.getContractFactory("TrigonometryMaster");
    const diamond = await DiamondFactory.deploy(
        await owner.getAddress(),
        await diamondCutFacet.getAddress()
    );
    await diamond.waitForDeployment();

    const diamondCut = await ethers.getContractAt("IDiamondCut", await diamond.getAddress());
    return { owner, other, diamond, diamondCut, diamondCutFacet };
}

describe("TrigonometryMaster diamond safety", function () {
    it("rejects a zero owner during construction", async function () {
        const DiamondCutFacetFactory = await ethers.getContractFactory("DiamondCutFacet");
        const diamondCutFacet = await DiamondCutFacetFactory.deploy();
        await diamondCutFacet.waitForDeployment();
        const DiamondFactory = await ethers.getContractFactory("TrigonometryMaster");

        await expect(
            DiamondFactory.deploy(ethers.ZeroAddress, await diamondCutFacet.getAddress())
        ).to.be.revertedWith("TrigonometryMaster: owner is zero");
    });

    it("rejects transferring ownership to the zero address", async function () {
        const { diamond, diamondCut } = await deployDiamond();
        const OwnershipFacetFactory = await ethers.getContractFactory("OwnershipFacet");
        const ownershipFacet = await OwnershipFacetFactory.deploy();
        await ownershipFacet.waitForDeployment();
        const transferSelector = ownershipFacet.interface.getFunction("transferOwnership")!.selector;

        await diamondCut.diamondCut([{
            facetAddress: await ownershipFacet.getAddress(),
            action: 0,
            functionSelectors: [transferSelector],
        }], ethers.ZeroAddress, "0x");

        const ownership = await ethers.getContractAt("OwnershipFacet", await diamond.getAddress());
        await expect(ownership.transferOwnership(ethers.ZeroAddress))
            .to.be.revertedWith("OwnershipFacet: new owner is zero");
    });

    it("rejects EOA facet addresses for add and replace", async function () {
        const { other, diamondCut } = await deployDiamond();
        const eoa = await other.getAddress();
        const OwnershipFacetFactory = await ethers.getContractFactory("OwnershipFacet");
        const ownershipFacet = await OwnershipFacetFactory.deploy();
        await ownershipFacet.waitForDeployment();
        const ownerSelector = ownershipFacet.interface.getFunction("owner")!.selector;

        await expect(diamondCut.diamondCut([{
            facetAddress: eoa,
            action: 0,
            functionSelectors: [ownerSelector],
        }], ethers.ZeroAddress, "0x")).to.be.revertedWith("LibTrigMaster: facet has no code");

        await diamondCut.diamondCut([{
            facetAddress: await ownershipFacet.getAddress(),
            action: 0,
            functionSelectors: [ownerSelector],
        }], ethers.ZeroAddress, "0x");

        await expect(diamondCut.diamondCut([{
            facetAddress: eoa,
            action: 1,
            functionSelectors: [ownerSelector],
        }], ethers.ZeroAddress, "0x")).to.be.revertedWith("LibTrigMaster: facet has no code");
    });

    it("rejects an EOA initializer", async function () {
        const { other, diamondCut } = await deployDiamond();
        await expect(
            diamondCut.diamondCut([], await other.getAddress(), "0x")
        ).to.be.revertedWith("LibTrigMaster: init has no code");
    });

    it("rejects empty selector cuts before creating facet state", async function () {
        const { diamondCut } = await deployDiamond();
        const OwnershipFacetFactory = await ethers.getContractFactory("OwnershipFacet");
        const ownershipFacet = await OwnershipFacetFactory.deploy();
        await ownershipFacet.waitForDeployment();

        for (const action of [0, 1, 2]) {
            await expect(diamondCut.diamondCut([{
                facetAddress: action === 2 ? ethers.ZeroAddress : await ownershipFacet.getAddress(),
                action,
                functionSelectors: [],
            }], ethers.ZeroAddress, "0x")).to.be.revertedWith("LibTrigMaster: no selectors");
        }
    });

    it("requires the zero facet address for removals", async function () {
        const { diamondCut } = await deployDiamond();
        const OwnershipFacetFactory = await ethers.getContractFactory("OwnershipFacet");
        const ownershipFacet = await OwnershipFacetFactory.deploy();
        await ownershipFacet.waitForDeployment();
        const ownerSelector = ownershipFacet.interface.getFunction("owner")!.selector;
        const facetAddress = await ownershipFacet.getAddress();

        await diamondCut.diamondCut([{
            facetAddress,
            action: 0,
            functionSelectors: [ownerSelector],
        }], ethers.ZeroAddress, "0x");

        await expect(diamondCut.diamondCut([{
            facetAddress,
            action: 2,
            functionSelectors: [ownerSelector],
        }], ethers.ZeroAddress, "0x"))
            .to.be.revertedWith("LibTrigMaster: remove facet must be zero");

        await expect(diamondCut.diamondCut([{
            facetAddress: ethers.ZeroAddress,
            action: 2,
            functionSelectors: [ownerSelector],
        }], ethers.ZeroAddress, "0x")).to.not.be.reverted;
    });
});
