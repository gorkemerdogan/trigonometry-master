import { Contract, Signer } from "ethers";
import { ethers } from "hardhat";

/**
 * A generalized interface for the contract harness, ensuring it has required Ethers methods.
 * It extends Contract to get Ethers' standard properties (like interface and getAddress).
 */
export interface Harness extends Contract {
    // Allows dynamic access to method names for estimateGas fallback check
    [key: string]: any; 
}

// ------------------------------------------------------------
//  Transaction Gas Measurement Utilities
// ------------------------------------------------------------

export type TransactionFailureCounts = {
    successful: number;
    reverted: number;
    outOfGas: number;
    other: number;
};

export function createTransactionFailureCounts(): TransactionFailureCounts {
    return {successful: 0, reverted: 0, outOfGas: 0, other: 0};
}

function recordTransactionFailure(error: unknown, counts: TransactionFailureCounts): void {
    const message = error instanceof Error ? error.message.toLowerCase() : String(error).toLowerCase();
    if (message.includes("out of gas") || message.includes("outofgas")) {
        counts.outOfGas++;
    } else if (message.includes("revert") || message.includes("execution reverted") || message.includes("failed with status")) {
        counts.reverted++;
    } else {
        counts.other++;
    }
}

/** Prints failures observed before they were rethrown by benchmark measurements. */
export function printTransactionFailureSummary(label: string, counts: TransactionFailureCounts): void {
    console.log(
        `${label} transaction outcomes: successful=${counts.successful} | reverted=${counts.reverted} | out_of_gas=${counts.outOfGas} | other_failures=${counts.other}`
    );
}

/**
 * @notice        Executes a transaction and returns the gas used by its receipt.
 * @dev           This measures `transaction_receipt_gas`; it is not an estimate. Failures
 *                intentionally propagate so benchmark samples cannot silently omit reverts.
 * @param harness The contract harness instance.
 * @param method  The name of the contract method to call.
 * @param args    The arguments for the contract method.
 * @returns       Gas used by the mined transaction receipt.
 */
export async function measureTransactionGas(
    harness: Harness,
    method: string,
    args: unknown[],
    counts?: TransactionFailureCounts
): Promise<bigint> {
    try {
        const data: string = harness.interface.encodeFunctionData(method, args);
        const [signer]: Signer[] = await ethers.getSigners();
        const to: string = await harness.getAddress();
        const tx = await signer.sendTransaction({to, data});
        const receipt = await tx.wait();

        if (receipt === null) {
            throw new Error(`No transaction receipt for ${method}`);
        }
        if (receipt.status !== 1) {
            throw new Error(`Transaction for ${method} failed with status ${receipt.status}`);
        }

        if (counts) counts.successful++;
        return receipt.gasUsed;
    } catch (error) {
        if (counts) recordTransactionFailure(error, counts);
        throw error;
    }
}

/**
 * @notice        Estimates gas for a transaction simulation.
 * @dev           This returns an `estimateGas` result, not receipt gas. Failures intentionally
 *                propagate to the caller instead of being represented as a string value.
 * @param harness Contract harness instance.
 * @param method  Name of the contract method to call.
 * @param args    Arguments for the contract method.
 * @returns       Estimated transaction gas.
 */
export async function estimateGas(harness: Harness, method: string, args: unknown[]): Promise<bigint> {
    const contractMethod = harness[method];
    if (contractMethod && contractMethod.estimateGas) {
        return await contractMethod.estimateGas(...args);
    }

    const data: string = harness.interface.encodeFunctionData(method, args);
    const [signer]: Signer[] = await ethers.getSigners();
    const to: string = await harness.getAddress();
    return await signer.estimateGas({to, data});
}

// ------------------------------------------------------------
//  Block Printing Interface
// ------------------------------------------------------------

/// Interface for the data block to be printed.
interface PrintBlockMatrixData {
    t: number | string;
    method: string;
    explanation: string;
    gas: string;
    executionModel: string;
    executionPath: string;
    gasMeasurement: string;
    resultExecution: string;
    shapeIn?: string;
    shapeOut?: string;
    inHex?: string;
    outHex?: string;
}

/**
 * @notify     Prints a standardized, formatted block of information for a matrix test case.
 *             Uses object destructuring and template literals for clean output generation.
 * @param data The structured data to print.
 */
export function printBlockMatrix({t, method, explanation, gas, executionModel, executionPath, gasMeasurement, resultExecution, shapeIn = "-", shapeOut = "-", inHex = "-", outHex = "-"}: PrintBlockMatrixData): void {
    
    const sep: string = "-".repeat(60); // Separator
    
    const logLines: string[] = [
        sep,
        `Test: ${t}`,
        `Method: ${method}`,
        `Explanation: ${explanation}`,
        `Execution Model: ${executionModel}`,
        `Execution Path: ${executionPath}`,
        `Gas Measurement: ${gasMeasurement}`,
        `Gas Used: ${gas}`,
        `Result Execution: ${resultExecution}`,
        `Shape In: ${shapeIn}`,
        `Shape Out: ${shapeOut}`,
        `Input (Hex): ${inHex}`,
        `Output (Hex): ${outHex}`,
        sep,
    ];

    console.log(logLines.join("\n"));
}

interface PrintBlockRegularData {
    t: number | string;
    method: string;
    explanation: string;
    gas: string;
    executionModel: string;
    executionPath: string;
    gasMeasurement: string;
    resultExecution: string;
    inHex?: string;
    expectedHex?: string;
    outHex?: string;
    expectedDec?: string;
    outDec?: string;
}

/**
 * @notify     Prints a standardized, formatted block of information for a test case.
 *             Uses object destructuring and template literals for clean output generation.
 * @param data The structured data to print.
 */
export function printBlockRegular({t, method, explanation, gas, executionModel, executionPath, gasMeasurement, resultExecution, inHex = "-", expectedHex = "-", outHex = "-", expectedDec = "-", outDec = "-"}: PrintBlockRegularData): void {
    
    const sep: string = "-".repeat(60); // Separator
    
    const logLines: string[] = [
        sep,
        `Test: ${t}`,
        `Method: ${method}`,
        `Explanation: ${explanation}`,
        `Execution Model: ${executionModel}`,
        `Execution Path: ${executionPath}`,
        `Gas Measurement: ${gasMeasurement}`,
        `Gas Used: ${gas}`,
        `Result Execution: ${resultExecution}`,
        `Input: ${inHex}`,
        `Expected Output (hex): ${expectedHex}`,
        `Output (hex): ${outHex}`,
        `Expected Output (dec): ${expectedDec}`,
        `Output (dec): ${outDec}`,
        sep,
    ];

    console.log(logLines.join("\n"));
}

interface printBlockOptimizationData {
    outDec?: string;
    t: string; 
    method: string; 
    explanation: string; 
    gas: bigint | number | string; 
    executionModel: string;
    executionPath: string;
    gasMeasurement: string;
    resultExecution: string;
    x0?: string;
    xFinal?: string;
    gx?: string;
    status?: string;
    iters?: string;
    extra?: string;
}

export function printBlockOptimization({t, method, explanation, gas, executionModel, executionPath, gasMeasurement, resultExecution, x0 = "-", xFinal = "-", gx = "-", status = "-", iters = "-", extra = "-"}: printBlockOptimizationData): void {
    const sep = "-".repeat(60);
    const logLines = [
        sep,
        `Test: ${t}`,
        `Method: ${method}`,
        `Explanation: ${explanation}`,
        `Execution Model: ${executionModel}`,
        `Execution Path: ${executionPath}`,
        `Gas Measurement: ${gasMeasurement}`,
        `Gas Used: ${gas}`,
        `Result Execution: ${resultExecution}`,
        `Initial x: ${x0}`,
        `Final x: ${xFinal}`,
        `g(x_final): ${gx}`,
        `Status: ${status}`,
        `Iterations: ${iters}`,
        `Extra: ${extra}`,
        sep,
    ];
    console.log(logLines.join("\n"));
}

/**
 * @notice Formats a fixed-point BigInt into a human-readable decimal string.
 * @dev    Splits the value into integer and fractional parts. If the scale input is 0, 
 *         it defaults to 10^12. Uses padStart to preserve leading zeros in decimals.
 *         Example: 
 *          Input: 1050000000000n (with SCALE = 10**12)
 *          Output: "1.050000000000"
 * @param  v The BigInt value to be formatted (supports positive and negative).
 * @param s The SCALE/denominator to use. If 0, defaults to 10**12.
 * @return Formatted decimal string with 12 decimal places.
 */
export function fmt(v: bigint, s?: bigint): string {
    const SCALE = !s || s === 0n ? 10n ** 12n : s; // default -> 10^12
    // Determine the number of decimal places for padding based on the SCALE
    const decimals = SCALE.toString().length - 1;

    const neg = v < 0n;
    const a = neg ? -v : v;

    const integerPart = a / SCALE;
    const fractionalPart = a % SCALE;

    return `${neg ? "-" : ""}${integerPart}.${fractionalPart.toString().padStart(decimals, "0")}`;
}
