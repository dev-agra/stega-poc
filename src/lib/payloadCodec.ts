import { stringToBits, bitsToString } from './dct';
import { generateMaskBits, xorBits } from './prng';
import { buildBchCode, bchEncode, bchDecode, type BchCode } from './bch';

export const BCH_M = 6;
export const BCH_T = 5; // corrects up to 5 errors per 63-bit codeword, k=36

let cachedCode: BchCode | null = null;
export function getBchCode(): BchCode {
  if (!cachedCode) cachedCode = buildBchCode(BCH_M, BCH_T);
  return cachedCode;
}

export interface PreparedPayload {
  txBits: number[];
  bchCode: BchCode;
  repeats: number;
  unitLen: number;
}

/**
 * message8 -> 64 bits -> two BCH(63,36,t=5) codewords (126-bit unit) ->
 * repeated to fill `capacity` slots -> PRNG-masked with `seed`.
 */
export function prepareTxBits(message8: string, capacity: number, seed: number): PreparedPayload {
  const bchCode = getBchCode();
  const bits64 = stringToBits(message8, 8);
  const half1 = [...bits64.slice(0, 32), 0, 0, 0, 0];
  const half2 = [...bits64.slice(32, 64), 0, 0, 0, 0];

  const cw1 = bchEncode(bchCode, half1);
  const cw2 = bchEncode(bchCode, half2);
  const unit = [...cw1, ...cw2];
  const unitLen = unit.length;

  const repeats = Math.max(1, Math.floor(capacity / unitLen));
  const raw: number[] = [];
  for (let r = 0; r < repeats; r++) raw.push(...unit);

  const mask = generateMaskBits(seed, raw.length);
  const txBits = xorBits(raw, mask);

  return { txBits, bchCode, repeats, unitLen };
}

export interface ResolvedPayload {
  message: string | null;
  validCopies: number;
  totalCopies: number;
  totalBitErrorsCorrected: number;
}

/** Reverse of prepareTxBits: unmask, split into 126-bit units, BCH-decode, majority-vote valid copies. */
export function resolveRxBits(rxBits: number[], seed: number): ResolvedPayload {
  const bchCode = getBchCode();
  const unitLen = bchCode.n * 2;
  const repeats = Math.floor(rxBits.length / unitLen);

  const mask = generateMaskBits(seed, repeats * unitLen);
  const demasked = xorBits(rxBits.slice(0, repeats * unitLen), mask);

  const half1Votes: number[][] = Array.from({ length: 32 }, () => []);
  const half2Votes: number[][] = Array.from({ length: 32 }, () => []);
  let validCopies = 0;
  let totalBitErrorsCorrected = 0;

  for (let r = 0; r < repeats; r++) {
    const unit = demasked.slice(r * unitLen, (r + 1) * unitLen);
    const cw1 = unit.slice(0, bchCode.n);
    const cw2 = unit.slice(bchCode.n);
    const d1 = bchDecode(bchCode, cw1);
    const d2 = bchDecode(bchCode, cw2);

    if (d1.success && d2.success && d1.message && d2.message) {
      validCopies++;
      totalBitErrorsCorrected += Math.max(d1.errorsFound, 0) + Math.max(d2.errorsFound, 0);
      for (let i = 0; i < 32; i++) {
        half1Votes[i].push(d1.message[i]);
        half2Votes[i].push(d2.message[i]);
      }
    }
  }

  if (validCopies === 0) {
    return { message: null, validCopies: 0, totalCopies: repeats, totalBitErrorsCorrected: 0 };
  }

  const majority = (votes: number[]) => {
    const ones = votes.filter((v) => v === 1).length;
    return ones * 2 >= votes.length ? 1 : 0;
  };

  const bits64: number[] = [];
  for (let i = 0; i < 32; i++) bits64.push(majority(half1Votes[i]));
  for (let i = 0; i < 32; i++) bits64.push(majority(half2Votes[i]));

  return {
    message: bitsToString(bits64, 8),
    validCopies,
    totalCopies: repeats,
    totalBitErrorsCorrected,
  };
}
