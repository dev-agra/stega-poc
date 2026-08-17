import QRCode from 'qrcode';
import {
  dct8x8,
  idct8x8,
  embedBitInCoeffs,
  extractBitFromCoeffs,
  makeBlock,
  stringToBits,
  bitsToString,
  type CoeffPos,
  type Block8,
} from './dct';
import { generateMaskBits, xorBits } from './prng';
import { buildBchCode, bchEncode, bchDecode, type BchCode } from './bch';

// ---- Fixed shared parameters (encoder + decoder must agree on all of these) ----
export const PX_PER_MODULE = 8; // 1 QR module = 1 DCT block, exactly
export const QR_VERSION = 5; // 37x37 modules
export const QR_EC_LEVEL: 'L' | 'M' | 'Q' | 'H' = 'M';
export const PRNG_SEED = 0x5eed_c0de;
export const COEFF_1: CoeffPos = { u: 3, v: 1 }; // mid-frequency pair
export const COEFF_2: CoeffPos = { u: 1, v: 3 };
export const BCH_M = 6; // GF(2^6) -> n = 63
export const BCH_T = 5; // corrects up to 5 errors per 63-bit codeword -> k=36
export const DEFAULT_STRENGTH = 40; // must be well within QR module contrast tolerance

export interface BuildResult {
  size: number; // canonical grid size in px (= modules * PX_PER_MODULE)
  moduleCount: number;
  dataModuleIndices: number[]; // linear module indices (row*size+col) usable for embedding, in scan order
  bchCode: BchCode;
  txBits: number[]; // final masked+coded bit stream actually embedded (length = repeats * n)
  repeats: number;
}

/** Build the BCH code + PRNG mask once; shared by encode and decode. */
export function getBchCode(): BchCode {
  return buildBchCode(BCH_M, BCH_T);
}

/**
 * Prepare the full bit-stream that gets embedded: message -> BCH (2 halves) -> repeat -> PRNG mask.
 */
export function prepareTxBits(message8: string, dataModuleCount: number): {
  txBits: number[];
  bchCode: BchCode;
  repeats: number;
} {
  const bchCode = getBchCode(); // n=63, k=36
  const bits64 = stringToBits(message8, 8); // 64 bits
  const half1 = bits64.slice(0, 32);
  const half2 = bits64.slice(32, 64);
  // pad each 32-bit half to k=36 with 4 zero bits
  const padded1 = [...half1, 0, 0, 0, 0];
  const padded2 = [...half2, 0, 0, 0, 0];

  const cw1 = bchEncode(bchCode, padded1); // 63 bits
  const cw2 = bchEncode(bchCode, padded2); // 63 bits
  const block = [...cw1, ...cw2]; // 126 bits, one "unit"

  const repeats = Math.max(1, Math.floor(dataModuleCount / block.length));
  const raw: number[] = [];
  for (let r = 0; r < repeats; r++) raw.push(...block);

  const mask = generateMaskBits(PRNG_SEED, raw.length);
  const txBits = xorBits(raw, mask);

  return { txBits, bchCode, repeats };
}

/** Reverse of prepareTxBits: unmask, split into 126-bit units, BCH-decode each, majority vote across valid decodes. */
export function resolveRxBits(
  rxBits: number[]
): { message: string | null; validCopies: number; totalCopies: number; totalBitErrorsCorrected: number } {
  const bchCode = getBchCode();
  const unitLen = bchCode.n * 2; // 126
  const repeats = Math.floor(rxBits.length / unitLen);

  const mask = generateMaskBits(PRNG_SEED, repeats * unitLen);
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

/** Generate the base QR module matrix + which modules are safe to embed into (non-reserved). */
export async function buildQrModules(qrText: string): Promise<{
  size: number;
  data: Uint8Array; // 0/1 per module, row-major
  reserved: Uint8Array; // 1 = function pattern, do not touch
  dataModuleIndices: number[]; // row-major linear indices of non-reserved modules, in scan order
}> {
  const qr = QRCode.create(qrText, { errorCorrectionLevel: QR_EC_LEVEL, version: QR_VERSION });
  const size = qr.modules.size;
  const data = new Uint8Array(qr.modules.data);
  const reserved = new Uint8Array(qr.modules.reservedBit ?? new Uint8Array(size * size));

  const dataModuleIndices: number[] = [];
  for (let row = 0; row < size; row++) {
    for (let col = 0; col < size; col++) {
      const idx = row * size + col;
      if (!reserved[idx]) dataModuleIndices.push(idx);
    }
  }

  return { size, data, reserved, dataModuleIndices };
}

/** Render module matrix (0/1) to a canonical nearest-neighbor-upscaled luma grid (Uint8ClampedArray-ish Float64). */
export function modulesToCanonicalY(data: Uint8Array, size: number): Float64Array[] {
  const px = size * PX_PER_MODULE;
  const Y: Float64Array[] = Array.from({ length: px }, () => new Float64Array(px));
  for (let row = 0; row < size; row++) {
    for (let col = 0; col < size; col++) {
      const dark = data[row * size + col];
      const val = dark ? 0 : 255; // QR "1" = dark module = low luma
      for (let py = 0; py < PX_PER_MODULE; py++) {
        for (let px2 = 0; px2 < PX_PER_MODULE; px2++) {
          Y[row * PX_PER_MODULE + py][col * PX_PER_MODULE + px2] = val;
        }
      }
    }
  }
  return Y;
}

export interface EncodeResult {
  canonicalSize: number;
  luma: Float64Array[]; // final watermarked luma grid, canonicalSize x canonicalSize
  moduleSize: number;
  stats: {
    totalDataModules: number;
    bitsEmbedded: number;
    repeats: number;
    strength: number;
  };
}

/**
 * Full encode pipeline: build QR modules -> upscale to canonical luma grid ->
 * embed BCH+masked bits into non-reserved module blocks via DCT coefficient ordering.
 */
export async function encodeMarker(
  qrText: string,
  secretMessage8: string,
  strength: number = DEFAULT_STRENGTH
): Promise<EncodeResult> {
  if (secretMessage8.length !== 8) {
    throw new Error('Secret message must be exactly 8 characters');
  }

  const { size, data, dataModuleIndices } = await buildQrModules(qrText);
  const luma = modulesToCanonicalY(data, size);

  const { txBits, repeats } = prepareTxBits(secretMessage8, dataModuleIndices.length);

  for (let i = 0; i < txBits.length && i < dataModuleIndices.length; i++) {
    const moduleIdx = dataModuleIndices[i];
    const row = Math.floor(moduleIdx / size);
    const col = moduleIdx % size;
    const by = row * PX_PER_MODULE;
    const bx = col * PX_PER_MODULE;

    const block: Block8 = makeBlock();
    for (let y = 0; y < PX_PER_MODULE; y++) {
      for (let x = 0; x < PX_PER_MODULE; x++) {
        block[y][x] = luma[by + y][bx + x];
      }
    }

    const F = dct8x8(block);
    const bit = txBits[i] as 0 | 1;
    const F2 = embedBitInCoeffs(F, bit, COEFF_1, COEFF_2, strength);
    const newBlock = idct8x8(F2);

    for (let y = 0; y < PX_PER_MODULE; y++) {
      for (let x = 0; x < PX_PER_MODULE; x++) {
        luma[by + y][bx + x] = Math.min(255, Math.max(0, newBlock[y][x]));
      }
    }
  }

  return {
    canonicalSize: size * PX_PER_MODULE,
    luma,
    moduleSize: size,
    stats: {
      totalDataModules: dataModuleIndices.length,
      bitsEmbedded: txBits.length,
      repeats,
      strength,
    },
  };
}

export interface DecodeResult {
  message: string | null;
  validCopies: number;
  totalCopies: number;
  totalBitErrorsCorrected: number;
  moduleSize: number;
}

/**
 * Decode: given a canonical (already aligned, moduleSize*PX_PER_MODULE square)
 * luma grid and the known QR text used at encode time (needed to know which
 * modules are non-reserved, exactly mirroring the encoder's module layout),
 * extract bits from each data-module block and run BCH majority-vote recovery.
 *
 * NOTE: the decoder needs the *same* reserved/data module map as the encoder.
 * Since QR function-pattern layout depends only on version+size (not on the
 * payload text), we recompute it from a dummy QR of the same version.
 */
export async function decodeMarker(
  luma: Float64Array[],
  moduleSize: number
): Promise<DecodeResult> {
  const { reserved } = await buildQrModules('0'.repeat(20)); // same version/size -> same function pattern layout
  const dataModuleIndices: number[] = [];
  for (let row = 0; row < moduleSize; row++) {
    for (let col = 0; col < moduleSize; col++) {
      const idx = row * moduleSize + col;
      if (!reserved[idx]) dataModuleIndices.push(idx);
    }
  }

  const rxBits: number[] = [];
  for (const moduleIdx of dataModuleIndices) {
    const row = Math.floor(moduleIdx / moduleSize);
    const col = moduleIdx % moduleSize;
    const by = row * PX_PER_MODULE;
    const bx = col * PX_PER_MODULE;

    const block: Block8 = makeBlock();
    for (let y = 0; y < PX_PER_MODULE; y++) {
      for (let x = 0; x < PX_PER_MODULE; x++) {
        block[y][x] = luma[by + y][bx + x];
      }
    }
    const F = dct8x8(block);
    rxBits.push(extractBitFromCoeffs(F, COEFF_1, COEFF_2));
  }

  const { message, validCopies, totalCopies, totalBitErrorsCorrected } = resolveRxBits(rxBits);

  return { message, validCopies, totalCopies, totalBitErrorsCorrected, moduleSize };
}
