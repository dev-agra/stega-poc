import { stringToBits, bitsToString } from './dct';
import { generateMaskBits, xorBits } from './prng';
import { buildRsCode, rsEncode, rsDecode, type RsCode } from './rs';

export const RS_M = 6; // GF(2^6), matches BCH's field
export const RS_K = 6; // message symbols per half (36 bits, same as BCH's k)
export const RS_T = 3; // corrects up to 3 SYMBOL errors (up to 18 bits if clustered) per half

let cachedCode: RsCode | null = null;
export function getRsCode(): RsCode {
  if (!cachedCode) cachedCode = buildRsCode(RS_M, RS_K, RS_T);
  return cachedCode;
}

function bitsToSymbols(bits: number[], symbolBits: number): number[] {
  const symbols: number[] = [];
  for (let i = 0; i < bits.length; i += symbolBits) {
    let sym = 0;
    for (let b = 0; b < symbolBits; b++) sym = (sym << 1) | (bits[i + b] ?? 0);
    symbols.push(sym);
  }
  return symbols;
}

function symbolsToBits(symbols: number[], symbolBits: number): number[] {
  const bits: number[] = [];
  for (const sym of symbols) {
    for (let b = symbolBits - 1; b >= 0; b--) bits.push((sym >> b) & 1);
  }
  return bits;
}

export interface PreparedPayloadRS {
  txBits: number[];
  repeats: number;
  unitLen: number;
}

/**
 * message8 -> 64 bits -> two RS(12,6,t=3) codewords (one per 32-bit half,
 * padded to 36 bits = 6 symbols) -> 144-bit unit -> repeated to fill
 * `capacity` -> PRNG-masked with `seed`. Same overall shape as the BCH
 * codec (payloadCodec.ts) so the two are a fair, matched comparison.
 */
export function prepareTxBitsRS(message8: string, capacity: number, seed: number): PreparedPayloadRS {
  const code = getRsCode();
  const bits64 = stringToBits(message8, 8);
  const half1Bits = [...bits64.slice(0, 32), 0, 0, 0, 0]; // 36 bits = 6 symbols
  const half2Bits = [...bits64.slice(32, 64), 0, 0, 0, 0];

  const sym1 = bitsToSymbols(half1Bits, RS_M);
  const sym2 = bitsToSymbols(half2Bits, RS_M);

  const cw1 = rsEncode(code, sym1); // 12 symbols
  const cw2 = rsEncode(code, sym2);

  const cw1Bits = symbolsToBits(cw1, RS_M); // 72 bits
  const cw2Bits = symbolsToBits(cw2, RS_M);
  const unit = [...cw1Bits, ...cw2Bits]; // 144 bits
  const unitLen = unit.length;

  const repeats = Math.max(1, Math.floor(capacity / unitLen));
  const raw: number[] = [];
  for (let r = 0; r < repeats; r++) raw.push(...unit);

  const mask = generateMaskBits(seed, raw.length);
  const txBits = xorBits(raw, mask);

  return { txBits, repeats, unitLen };
}

export interface ResolvedPayloadRS {
  message: string | null;
  validCopies: number;
  totalCopies: number;
  totalSymbolErrorsCorrected: number;
}

export function resolveRxBitsRS(rxBits: number[], seed: number): ResolvedPayloadRS {
  const code = getRsCode();
  const cwBitsLen = code.n * RS_M; // 72
  const unitLen = cwBitsLen * 2; // 144
  const repeats = Math.floor(rxBits.length / unitLen);

  const mask = generateMaskBits(seed, repeats * unitLen);
  const demasked = xorBits(rxBits.slice(0, repeats * unitLen), mask);

  const half1Votes: number[][] = Array.from({ length: 32 }, () => []);
  const half2Votes: number[][] = Array.from({ length: 32 }, () => []);
  let validCopies = 0;
  let totalSymbolErrorsCorrected = 0;

  for (let r = 0; r < repeats; r++) {
    const unit = demasked.slice(r * unitLen, (r + 1) * unitLen);
    const cw1Bits = unit.slice(0, cwBitsLen);
    const cw2Bits = unit.slice(cwBitsLen);
    const cw1 = bitsToSymbols(cw1Bits, RS_M);
    const cw2 = bitsToSymbols(cw2Bits, RS_M);

    const d1 = rsDecode(code, cw1);
    const d2 = rsDecode(code, cw2);

    if (d1.success && d2.success && d1.message && d2.message) {
      validCopies++;
      totalSymbolErrorsCorrected += Math.max(d1.errorsFound, 0) + Math.max(d2.errorsFound, 0);
      const bits1 = symbolsToBits(d1.message, RS_M).slice(0, 32);
      const bits2 = symbolsToBits(d2.message, RS_M).slice(0, 32);
      for (let i = 0; i < 32; i++) {
        half1Votes[i].push(bits1[i]);
        half2Votes[i].push(bits2[i]);
      }
    }
  }

  if (validCopies === 0) {
    return { message: null, validCopies: 0, totalCopies: repeats, totalSymbolErrorsCorrected: 0 };
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
    totalSymbolErrorsCorrected,
  };
}
