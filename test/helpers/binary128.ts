const SIGN_BIT = 1n << 127n;
const VALUE_MASK = (1n << 128n) - 1n;
const EXPONENT_MASK = 0x7fffn;
const FRACTION_MASK = (1n << 112n) - 1n;

function rawBits(value: string): bigint {
    const raw = BigInt(value);
    if (raw < 0n || raw > VALUE_MASK) throw new Error(`Invalid binary128 encoding: ${value}`);
    return raw;
}

function rawHex(value: bigint): string {
    return `0x${value.toString(16).padStart(32, "0")}`;
}

export function isNaNBinary128(value: string): boolean {
    const raw = rawBits(value);
    return ((raw >> 112n) & EXPONENT_MASK) === EXPONENT_MASK && (raw & FRACTION_MASK) !== 0n;
}

export function isFiniteBinary128(value: string): boolean {
    return ((rawBits(value) >> 112n) & EXPONENT_MASK) !== EXPONENT_MASK;
}

/** Maps IEEE sign-magnitude encodings into monotonically increasing integer ranks. */
export function orderedBinary128(value: string): bigint {
    const raw = rawBits(value);
    if (isNaNBinary128(value)) throw new Error(`ULP ordering is undefined for NaN: ${value}`);
    return (raw & SIGN_BIT) !== 0n ? VALUE_MASK - raw : raw + SIGN_BIT;
}

export function ulpDistance(a: string, b: string): bigint {
    const orderedA = orderedBinary128(a);
    const orderedB = orderedBinary128(b);
    return orderedA >= orderedB ? orderedA - orderedB : orderedB - orderedA;
}

export function nextUpBinary128(value: string): string {
    const raw = rawBits(value);
    if (isNaNBinary128(value)) throw new Error("nextUp is undefined for NaN");
    if (raw === 0x7fff0000000000000000000000000000n) return value.toLowerCase();
    if ((raw & (SIGN_BIT - 1n)) === 0n) return rawHex(1n);
    return rawHex((raw & SIGN_BIT) !== 0n ? raw - 1n : raw + 1n);
}

export function nextDownBinary128(value: string): string {
    const raw = rawBits(value);
    if (isNaNBinary128(value)) throw new Error("nextDown is undefined for NaN");
    if (raw === 0xffff0000000000000000000000000000n) return value.toLowerCase();
    if ((raw & (SIGN_BIT - 1n)) === 0n) return rawHex(SIGN_BIT + 1n);
    return rawHex((raw & SIGN_BIT) !== 0n ? raw + 1n : raw - 1n);
}

export function compareFiniteBinary128(a: string, b: string): number {
    if (!isFiniteBinary128(a) || !isFiniteBinary128(b)) {
        throw new Error("compareFiniteBinary128 requires finite operands");
    }
    const orderedA = orderedBinary128(a);
    const orderedB = orderedBinary128(b);
    return orderedA < orderedB ? -1 : orderedA > orderedB ? 1 : 0;
}
