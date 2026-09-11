// SPDX-License-Identifier: MIT
import { expect } from "chai";
import { artifacts } from "hardhat";

const EIP_170_RUNTIME_BYTE_LIMIT = 24_576;
const TRIGONOMETRY_FACET_RUNTIME_BYTE_BUDGET = 23_000;

type RuntimeTarget = {
    fullyQualifiedName: string;
    label: string;
    projectBudget?: number;
};

// These are deployable production components.  Test harnesses and benchmark-only
// contracts deliberately do not contribute to this deployment guardrail.
const RUNTIME_TARGETS: RuntimeTarget[] = [
    {
        fullyQualifiedName: "contracts/facets/TrigonometryFacet.sol:TrigonometryFacet",
        label: "TrigonometryFacet",
        projectBudget: TRIGONOMETRY_FACET_RUNTIME_BYTE_BUDGET,
    },
    {
        fullyQualifiedName: "contracts/facets/DiamondCutFacet.sol:DiamondCutFacet",
        label: "DiamondCutFacet",
    },
    {
        fullyQualifiedName: "contracts/facets/DiamondLoupeFacet.sol:DiamondLoupeFacet",
        label: "DiamondLoupeFacet",
    },
    {
        fullyQualifiedName: "contracts/facets/OwnershipFacet.sol:OwnershipFacet",
        label: "OwnershipFacet",
    },
    {
        fullyQualifiedName: "contracts/TrigonometryMaster.sol:TrigonometryMaster",
        label: "TrigonometryMaster",
    },
    {
        fullyQualifiedName: "contracts/libraries/MathLib.sol:MathLib",
        label: "MathLib",
    },
];

function runtimeByteLength(deployedBytecode: string): number {
    expect(deployedBytecode, "artifact must contain deployed runtime bytecode")
        // Unlinked external-library references are represented as Solidity
        // placeholders. They occupy the same 20-byte width as a linked address.
        .to.match(/^0x[0-9a-fA-F_$]+$/);
    return (deployedBytecode.length - 2) / 2;
}

describe("Production runtime bytecode budgets", function () {
    it("keeps production deployables within EIP-170 and the TrigonometryFacet budget", async function () {
        for (const target of RUNTIME_TARGETS) {
            const artifact = await artifacts.readArtifact(target.fullyQualifiedName);
            const runtimeBytes = runtimeByteLength(artifact.deployedBytecode);
            const eip170Headroom = EIP_170_RUNTIME_BYTE_LIMIT - runtimeBytes;

            console.log(
                `${target.label}: ${runtimeBytes} runtime bytes; ` +
                `${eip170Headroom} bytes EIP-170 headroom`
            );
            expect(runtimeBytes, `${target.label} exceeds the EIP-170 runtime bytecode limit`)
                .to.be.at.most(EIP_170_RUNTIME_BYTE_LIMIT);

            if (target.projectBudget !== undefined) {
                const budgetHeadroom = target.projectBudget - runtimeBytes;
                console.log(
                    `${target.label}: ${budgetHeadroom} bytes project-budget headroom ` +
                    `(budget ${target.projectBudget})`
                );
                expect(runtimeBytes, `${target.label} exceeds the project runtime bytecode budget`)
                    .to.be.at.most(target.projectBudget);
            }
        }
    });
});
