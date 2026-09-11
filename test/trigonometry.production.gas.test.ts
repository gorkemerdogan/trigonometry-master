// SPDX-License-Identifier: MIT
import { expect } from "chai";
import { ethers } from "hardhat";
import type { Contract } from "ethers";
import {
    createTransactionFailureCounts,
    Harness,
    measureTransactionGas,
    printTransactionFailureSummary,
} from "./test-utils";

type TrigMethod = "sin" | "cos" | "tan" | "cot";

type TrigEndpoint = Contract & {
    fromFloat?(x: bigint): Promise<string>;
    [method: string]: unknown;
};

const SCALE = 10n ** 12n;
const METHODS: TrigMethod[] = ["sin", "cos", "tan", "cot"];
const ALL_TRIG_METHODS = ["sin", "cos", "tan", "cot", "asin", "acos", "atan"] as const;

type DeploymentContract = {
    deploymentTransaction(): {
        wait(): Promise<{ gasUsed: bigint; status: number | null } | null>;
    } | null;
};

async function deploymentReceiptGas(contract: DeploymentContract, label: string): Promise<bigint> {
    const transaction = contract.deploymentTransaction();
    if (transaction === null) throw new Error(`No deployment transaction for ${label}`);
    const receipt = await transaction.wait();
    if (receipt === null || receipt.status !== 1) {
        throw new Error(`Deployment failed for ${label}`);
    }
    return receipt.gasUsed;
}

describe("Trigonometry production Diamond-route gas benchmark", function () {
    let directHarness: TrigEndpoint;
    let routedTrigonometry: TrigEndpoint;
    let deploymentGas: Record<string, bigint>;
    let harnessMathLibDeploymentGas: bigint;
    let installationGas: bigint;
    let trigonometryFacetRuntimeBytes: number;

    before(async function () {
        const [deployer] = await ethers.getSigners();

        const MathLibFactory = await ethers.getContractFactory("MathLib");
        const mathLib = await MathLibFactory.deploy();
        harnessMathLibDeploymentGas = await deploymentReceiptGas(mathLib, "MathLib");
        deploymentGas = {};

        const DiamondCutFactory = await ethers.getContractFactory("DiamondCutFacet");
        const diamondCutFacet = await DiamondCutFactory.deploy();
        deploymentGas["DiamondCutFacet"] = await deploymentReceiptGas(diamondCutFacet, "DiamondCutFacet");

        const DiamondFactory = await ethers.getContractFactory("TrigonometryMaster");
        const diamond = await DiamondFactory.deploy(await deployer.getAddress(), await diamondCutFacet.getAddress());
        deploymentGas["TrigonometryMaster"] = await deploymentReceiptGas(diamond, "TrigonometryMaster");

        const TrigonometryFacetFactory = await ethers.getContractFactory("TrigonometryFacet");
        const trigonometryFacet = await TrigonometryFacetFactory.deploy();
        deploymentGas["TrigonometryFacet"] = await deploymentReceiptGas(trigonometryFacet, "TrigonometryFacet");
        const trigonometryFacetRuntime = await ethers.provider.getCode(await trigonometryFacet.getAddress());
        trigonometryFacetRuntimeBytes = (trigonometryFacetRuntime.length - 2) / 2;

        const selectors = ALL_TRIG_METHODS.map((method) => {
            const fragment = trigonometryFacet.interface.getFunction(method);
            if (fragment === null) throw new Error(`Missing selector for ${method}`);
            return fragment.selector;
        });
        const diamondCut = await ethers.getContractAt("IDiamondCut", await diamond.getAddress());
        const installation = await diamondCut.diamondCut(
            [{facetAddress: await trigonometryFacet.getAddress(), action: 0, functionSelectors: selectors}],
            ethers.ZeroAddress,
            "0x"
        );
        const installationReceipt = await installation.wait();
        if (installationReceipt === null || installationReceipt.status !== 1) {
            throw new Error("TrigonometryFacet installation failed");
        }
        installationGas = installationReceipt.gasUsed;

        const HarnessFactory = await ethers.getContractFactory("TrigonometryHarness", {
            libraries: {MathLib: await mathLib.getAddress()},
        });
        directHarness = (await HarnessFactory.deploy()) as unknown as TrigEndpoint;
        await directHarness.waitForDeployment();
        routedTrigonometry = (await ethers.getContractAt("TrigonometryFacet", await diamond.getAddress())) as unknown as TrigEndpoint;
    });

    it("reports minimal Diamond deployment/install receipts and compares four routed calls", async function () {
        const directCounts = createTransactionFailureCounts();
        const routedCounts = createTransactionFailureCounts();
        const input = await directHarness.fromFloat!(BigInt(Math.round((Math.PI / 4) * Number(SCALE))));

        console.log("------------------------------------------------------------");
        console.log("MINIMAL PRODUCTION DIAMOND ROUTE: DEPLOYMENT/INSTALL RECEIPTS");
        console.log("------------------------------------------------------------");
        console.log(`Test-only TrigonometryHarness MathLib deployment receipt gas: ${harnessMathLibDeploymentGas}`);
        for (const [label, gas] of Object.entries(deploymentGas)) {
            console.log(`${label} deployment receipt gas: ${gas}`);
        }
        console.log(`TrigonometryFacet deployed runtime bytes: ${trigonometryFacetRuntimeBytes}`);
        console.log(`TrigonometryFacet diamond-cut installation receipt gas: ${installationGas}`);
        console.log("Production no longer deploys or links MathLib; the MathLib receipt above belongs only to the comparison harness.");
        console.log("These one-time receipts are reported separately and are not included in per-call gas.");
        console.log("The minimal route includes DiamondCutFacet + TrigonometryMaster + TrigonometryFacet; optional ownership/loupe facets are excluded.");

        console.log("------------------------------------------------------------");
        console.log("HARNESS-DIRECT VS DIAMOND-ROUTED RECEIPT GAS");
        console.log("------------------------------------------------------------");
        console.log("Both values are callback-free transaction receipts. Each output is verified separately by eth_call; routed minus direct is descriptive routing overhead, not a universal production cost.");

        for (const method of METHODS) {
            const directGas = await measureTransactionGas(
                directHarness as unknown as Harness,
                method,
                [input],
                directCounts
            );
            const routedGas = await measureTransactionGas(
                routedTrigonometry as unknown as Harness,
                method,
                [input],
                routedCounts
            );
            const directResult = await (directHarness[method] as (x: string) => Promise<string>)(input);
            const routedResult = await (routedTrigonometry[method] as (x: string) => Promise<string>)(input);

            expect(routedResult, `${method} routed result`).to.equal(directResult);
            console.log(`${method}: harness_direct=${directGas} | diamond_routed=${routedGas} | routed_minus_direct=${routedGas - directGas}`);
        }

        printTransactionFailureSummary("Harness-direct production comparison", directCounts);
        printTransactionFailureSummary("Diamond-routed production comparison", routedCounts);
    });
});
