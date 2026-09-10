import { ethers } from "hardhat";
import type { FunctionFragment, Interface } from "ethers";

type ContractWithInterface = { interface: Interface };
type DeploymentContract = {
  deploymentTransaction(): {
    wait(): Promise<{ gasUsed: bigint; status: number | null } | null>;
  } | null;
};

function selectorsOf(contract: ContractWithInterface): string[] {
  const selectors: string[] = [];
  for (const fragment of contract.interface.fragments) {
    if (fragment.type === "function") {
      selectors.push((fragment as FunctionFragment).selector);
    }
  }
  return selectors;
}

async function deploymentReceiptGas(contract: DeploymentContract, label: string): Promise<bigint> {
  const transaction = contract.deploymentTransaction();
  if (transaction === null) throw new Error(`No deployment transaction for ${label}`);

  const receipt = await transaction.wait();
  if (receipt === null || receipt.status !== 1) {
    throw new Error(`Deployment failed for ${label}`);
  }
  return receipt.gasUsed;
}

async function main() {
  const [deployer] = await ethers.getSigners();
  const owner = await deployer.getAddress();
  console.log("Deploying TrigonometryMaster with account:", owner);

  const MathLibFactory = await ethers.getContractFactory("MathLib");
  const mathLib = await MathLibFactory.deploy();
  console.log("MathLib deployed at:", await mathLib.getAddress());

  const DiamondCutFacetFactory = await ethers.getContractFactory("DiamondCutFacet");
  const diamondCutFacet = await DiamondCutFacetFactory.deploy();
  console.log("DiamondCutFacet deployed at:", await diamondCutFacet.getAddress());

  const TrigonometryMasterFactory = await ethers.getContractFactory("TrigonometryMaster");
  const trigonometryMaster = await TrigonometryMasterFactory.deploy(owner, await diamondCutFacet.getAddress());
  console.log("TrigonometryMaster deployed at:", await trigonometryMaster.getAddress());

  const OwnershipFacetFactory = await ethers.getContractFactory("OwnershipFacet");
  const ownershipFacet = await OwnershipFacetFactory.deploy();
  console.log("OwnershipFacet deployed at:", await ownershipFacet.getAddress());

  const DiamondLoupeFacetFactory = await ethers.getContractFactory("DiamondLoupeFacet");
  const diamondLoupeFacet = await DiamondLoupeFacetFactory.deploy();
  console.log("DiamondLoupeFacet deployed at:", await diamondLoupeFacet.getAddress());

  const TrigonometryFacetFactory = await ethers.getContractFactory("TrigonometryFacet", {
    libraries: { MathLib: await mathLib.getAddress() },
  });
  const trigonometryFacet = await TrigonometryFacetFactory.deploy();
  console.log("TrigonometryFacet deployed at:", await trigonometryFacet.getAddress());

  const diamondCut = await ethers.getContractAt("IDiamondCut", await trigonometryMaster.getAddress());
  const cut = [
    {
      facetAddress: await ownershipFacet.getAddress(),
      action: 0,
      functionSelectors: selectorsOf(ownershipFacet),
    },
    {
      facetAddress: await diamondLoupeFacet.getAddress(),
      action: 0,
      functionSelectors: selectorsOf(diamondLoupeFacet),
    },
    {
      facetAddress: await trigonometryFacet.getAddress(),
      action: 0,
      functionSelectors: selectorsOf(trigonometryFacet),
    },
  ];
  const installation = await diamondCut.diamondCut(cut, ethers.ZeroAddress, "0x");
  const installationReceipt = await installation.wait();
  if (installationReceipt === null || installationReceipt.status !== 1) {
    throw new Error("Facet installation failed");
  }

  console.log("------------------------------------------------------------");
  console.log("DEPLOYMENT RECEIPT GAS");
  console.log("------------------------------------------------------------");
  console.log("MathLib:", await deploymentReceiptGas(mathLib, "MathLib"));
  console.log("DiamondCutFacet:", await deploymentReceiptGas(diamondCutFacet, "DiamondCutFacet"));
  console.log("TrigonometryMaster:", await deploymentReceiptGas(trigonometryMaster, "TrigonometryMaster"));
  console.log("OwnershipFacet:", await deploymentReceiptGas(ownershipFacet, "OwnershipFacet"));
  console.log("DiamondLoupeFacet:", await deploymentReceiptGas(diamondLoupeFacet, "DiamondLoupeFacet"));
  console.log("TrigonometryFacet:", await deploymentReceiptGas(trigonometryFacet, "TrigonometryFacet"));
  console.log("diamondCut installation:", installationReceipt.gasUsed);
  console.log("TrigonometryMaster initialized with ownership, loupe, and trigonometry facets.");
}

main().catch((error: unknown) => {
  console.error(error);
  process.exitCode = 1;
});
