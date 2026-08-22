import { resizeBilinear } from './resize';
import { rgbToYCbCr, ycbcrToRgb } from './color';
import {
  dct8x8,
  idct8x8,
  embedBitInCoeffs,
  extractBitFromCoeffs,
  makeBlock,
  type CoeffPos,
  type Block8,
} from './dct';
import { prepareTxBits, resolveRxBits } from './payloadCodec';
import { prepareTxBitsRS, resolveRxBitsRS } from './payloadCodecRS';

export type CodecKind = 'bch' | 'rs';

/** Seeded Fisher-Yates shuffle producing a fixed permutation of [0..n-1]. */
function seededPermutation(n: number, seed: number): number[] {
  const arr = Array.from({ length: n }, (_, i) => i);
  let state = seed >>> 0;
  const rand = () => {
    state |= 0;
    state = (state + 0x6d2b79f5) | 0;
    let t = Math.imul(state ^ (state >>> 15), 1 | state);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  for (let i = n - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}

export const CANONICAL_SIZE = 256;
export const BLOCK_COUNT_PER_SIDE = CANONICAL_SIZE / 8; // 32
export const TOTAL_BLOCKS = BLOCK_COUNT_PER_SIDE * BLOCK_COUNT_PER_SIDE; // 1024
export const DEFAULT_SEED = 0x5eed_c0de;
export const DEFAULT_SECRET = 'SECRET01';
export const DEFAULT_STRENGTH = 120;
export const MAX_STRENGTH = 2000;
export const DEFAULT_COEFF_1: CoeffPos = { u: 2, v: 3 };
export const DEFAULT_COEFF_2: CoeffPos = { u: 3, v: 4 };

export interface RgbaImage {
  width: number;
  height: number;
  data: Uint8ClampedArray; // RGBA, length = width*height*4
}

export function splitChannels(img: RgbaImage): { R: Float64Array; G: Float64Array; B: Float64Array; A: Float64Array } {
  const n = img.width * img.height;
  const R = new Float64Array(n);
  const G = new Float64Array(n);
  const B = new Float64Array(n);
  const A = new Float64Array(n);
  for (let i = 0; i < n; i++) {
    R[i] = img.data[i * 4];
    G[i] = img.data[i * 4 + 1];
    B[i] = img.data[i * 4 + 2];
    A[i] = img.data[i * 4 + 3];
  }
  return { R, G, B, A };
}

export function mergeChannels(R: Float64Array, G: Float64Array, B: Float64Array, A: Float64Array, width: number, height: number): RgbaImage {
  const data = new Uint8ClampedArray(width * height * 4);
  for (let i = 0; i < width * height; i++) {
    data[i * 4] = R[i];
    data[i * 4 + 1] = G[i];
    data[i * 4 + 2] = B[i];
    data[i * 4 + 3] = A[i];
  }
  return { width, height, data };
}

export interface EncodeOptions {
  strength?: number;
  seed?: number;
  coeff1?: CoeffPos;
  coeff2?: CoeffPos;
  codec?: CodecKind;
  interleave?: boolean;
}

export interface EncodeResult {
  image: RgbaImage; // same width/height as input
  stats: {
    repeats: number;
    bitsEmbedded: number;
    strength: number;
    seed: number;
  };
}

/**
 * Encode an 8-character secret into any-resolution RGBA image.
 * Output has identical width/height to input.
 */
export function encodeImage(input: RgbaImage, secret8: string, opts: EncodeOptions = {}): EncodeResult {
  if (secret8.length !== 8) throw new Error('Secret message must be exactly 8 characters');

  const strength = Math.min(MAX_STRENGTH, Math.max(0, opts.strength ?? DEFAULT_STRENGTH));
  const seed = opts.seed ?? DEFAULT_SEED;
  const coeff1 = opts.coeff1 ?? DEFAULT_COEFF_1;
  const coeff2 = opts.coeff2 ?? DEFAULT_COEFF_2;
  const codec = opts.codec ?? 'bch';
  const interleave = opts.interleave ?? false;

  const { R, G, B, A } = splitChannels(input);

  // 1. Downsample each channel to the 256x256 canonical grid.
  const R256 = resizeBilinear(R, input.width, input.height, CANONICAL_SIZE, CANONICAL_SIZE);
  const G256 = resizeBilinear(G, input.width, input.height, CANONICAL_SIZE, CANONICAL_SIZE);
  const B256 = resizeBilinear(B, input.width, input.height, CANONICAL_SIZE, CANONICAL_SIZE);

  // 2. RGB -> YCbCr on the canonical grid.
  const { Y, Cb, Cr } = rgbToYCbCr(R256, G256, B256);
  const Yprime = Float64Array.from(Y);

  // 3. Prepare the protected bitstream to embed (BCH or RS, matched overhead).
  const prepared =
    codec === 'rs' ? prepareTxBitsRS(secret8, TOTAL_BLOCKS, seed) : prepareTxBits(secret8, TOTAL_BLOCKS, seed);
  const { txBits, repeats } = prepared;

  // Optional interleaving: scatter each codeword's consecutive bits across
  // spatially distant blocks, so a spatially-localized bad region (e.g. from
  // perspective distortion) only ever corrupts a few symbols of any given
  // codeword instead of wiping the whole codeword out at once.
  const permutation = interleave ? seededPermutation(TOTAL_BLOCKS, seed ^ 0x9e3779b9) : null;

  // 4. Per 8x8 block: DCT, embed 1 bit via coefficient-pair ordering, IDCT.
  for (let bitIdx = 0; bitIdx < txBits.length && bitIdx < TOTAL_BLOCKS; bitIdx++) {
    const blockIdx = permutation ? permutation[bitIdx] : bitIdx;
    const blockRow = Math.floor(blockIdx / BLOCK_COUNT_PER_SIDE);
    const blockCol = blockIdx % BLOCK_COUNT_PER_SIDE;
    const by = blockRow * 8;
    const bx = blockCol * 8;

    const block: Block8 = makeBlock();
    for (let y = 0; y < 8; y++) {
      for (let x = 0; x < 8; x++) {
        block[y][x] = Y[(by + y) * CANONICAL_SIZE + (bx + x)];
      }
    }

    const F = dct8x8(block);
    const bit = txBits[bitIdx] as 0 | 1;
    const F2 = embedBitInCoeffs(F, bit, coeff1, coeff2, strength);
    const newBlock = idct8x8(F2);

    for (let y = 0; y < 8; y++) {
      for (let x = 0; x < 8; x++) {
        Yprime[(by + y) * CANONICAL_SIZE + (bx + x)] = newBlock[y][x];
      }
    }
  }

  // 5. YCbCr' -> RGB' on the canonical grid.
  const { R: R256p, G: G256p, B: B256p } = ycbcrToRgb(Yprime, Cb, Cr);

  // 6. Residual delta at canonical resolution.
  const deltaR256 = new Float64Array(CANONICAL_SIZE * CANONICAL_SIZE);
  const deltaG256 = new Float64Array(CANONICAL_SIZE * CANONICAL_SIZE);
  const deltaB256 = new Float64Array(CANONICAL_SIZE * CANONICAL_SIZE);
  for (let i = 0; i < deltaR256.length; i++) {
    deltaR256[i] = R256p[i] - R256[i];
    deltaG256[i] = G256p[i] - G256[i];
    deltaB256[i] = B256p[i] - B256[i];
  }

  // 7. Upscale delta back to native resolution.
  const deltaRFull = resizeBilinear(deltaR256, CANONICAL_SIZE, CANONICAL_SIZE, input.width, input.height);
  const deltaGFull = resizeBilinear(deltaG256, CANONICAL_SIZE, CANONICAL_SIZE, input.width, input.height);
  const deltaBFull = resizeBilinear(deltaB256, CANONICAL_SIZE, CANONICAL_SIZE, input.width, input.height);

  // 8. Superimpose onto the original native-resolution image.
  const n = input.width * input.height;
  const Rout = new Float64Array(n);
  const Gout = new Float64Array(n);
  const Bout = new Float64Array(n);
  for (let i = 0; i < n; i++) {
    Rout[i] = Math.min(255, Math.max(0, R[i] + deltaRFull[i]));
    Gout[i] = Math.min(255, Math.max(0, G[i] + deltaGFull[i]));
    Bout[i] = Math.min(255, Math.max(0, B[i] + deltaBFull[i]));
  }

  const image = mergeChannels(Rout, Gout, Bout, A, input.width, input.height);

  return {
    image,
    stats: { repeats, bitsEmbedded: txBits.length, strength, seed },
  };
}

export interface RawExtraction {
  rxBits: number[];
}

/** Extract the raw per-block bits (before any BCH/RS decoding). Used both by decodeImage() and by the BER diagnostic. */
export function extractRawBits(
  input: RgbaImage,
  opts: { seed?: number; coeff1?: CoeffPos; coeff2?: CoeffPos; interleave?: boolean } = {}
): RawExtraction {
  const seed = opts.seed ?? DEFAULT_SEED;
  const coeff1 = opts.coeff1 ?? DEFAULT_COEFF_1;
  const coeff2 = opts.coeff2 ?? DEFAULT_COEFF_2;
  const interleave = opts.interleave ?? false;

  const { R, G, B } = splitChannels(input);
  const R256 = resizeBilinear(R, input.width, input.height, CANONICAL_SIZE, CANONICAL_SIZE);
  const G256 = resizeBilinear(G, input.width, input.height, CANONICAL_SIZE, CANONICAL_SIZE);
  const B256 = resizeBilinear(B, input.width, input.height, CANONICAL_SIZE, CANONICAL_SIZE);
  const { Y } = rgbToYCbCr(R256, G256, B256);

  const permutation = interleave ? seededPermutation(TOTAL_BLOCKS, seed ^ 0x9e3779b9) : null;

  const rxBits: number[] = [];
  for (let bitIdx = 0; bitIdx < TOTAL_BLOCKS; bitIdx++) {
    const blockIdx = permutation ? permutation[bitIdx] : bitIdx;
    const blockRow = Math.floor(blockIdx / BLOCK_COUNT_PER_SIDE);
    const blockCol = blockIdx % BLOCK_COUNT_PER_SIDE;
    const by = blockRow * 8;
    const bx = blockCol * 8;

    const block: Block8 = makeBlock();
    for (let y = 0; y < 8; y++) {
      for (let x = 0; x < 8; x++) {
        block[y][x] = Y[(by + y) * CANONICAL_SIZE + (bx + x)];
      }
    }
    const F = dct8x8(block);
    rxBits.push(extractBitFromCoeffs(F, coeff1, coeff2));
  }

  return { rxBits };
}

export interface CoeffDifferenceReport {
  averageDifference: number;
  minDifference: number;
  maxDifference: number;
  blocksCompared: number;
}

/**
 * Average |F(coeff1) - F(coeff2)| across all 1024 canonical blocks, for a
 * given coefficient pair. This is a print/scan calibration diagnostic, not
 * a decode-correctness check: it measures how much raw coefficient
 * separation actually survives in the physical image regardless of what
 * bit each block was "supposed" to encode, which is exactly the kind of
 * printer/scanner margin question this metric is meant to answer - a
 * higher average means more headroom before noise flips a block's bit.
 */
export function computeAvgCoeffDifference(input: RgbaImage, coeff1: CoeffPos, coeff2: CoeffPos): CoeffDifferenceReport {
  const { R, G, B } = splitChannels(input);
  const R256 = resizeBilinear(R, input.width, input.height, CANONICAL_SIZE, CANONICAL_SIZE);
  const G256 = resizeBilinear(G, input.width, input.height, CANONICAL_SIZE, CANONICAL_SIZE);
  const B256 = resizeBilinear(B, input.width, input.height, CANONICAL_SIZE, CANONICAL_SIZE);
  const { Y } = rgbToYCbCr(R256, G256, B256);

  let sum = 0;
  let min = Infinity;
  let max = -Infinity;

  for (let blockIdx = 0; blockIdx < TOTAL_BLOCKS; blockIdx++) {
    const blockRow = Math.floor(blockIdx / BLOCK_COUNT_PER_SIDE);
    const blockCol = blockIdx % BLOCK_COUNT_PER_SIDE;
    const by = blockRow * 8;
    const bx = blockCol * 8;

    const block: Block8 = makeBlock();
    for (let y = 0; y < 8; y++) {
      for (let x = 0; x < 8; x++) {
        block[y][x] = Y[(by + y) * CANONICAL_SIZE + (bx + x)];
      }
    }
    const F = dct8x8(block);
    const diff = Math.abs(F[coeff1.u][coeff1.v] - F[coeff2.u][coeff2.v]);
    sum += diff;
    if (diff < min) min = diff;
    if (diff > max) max = diff;
  }

  return {
    averageDifference: sum / TOTAL_BLOCKS,
    minDifference: min,
    maxDifference: max,
    blocksCompared: TOTAL_BLOCKS,
  };
}


/** Resolve a final decode result from already-extracted raw bits (avoids re-running DCT extraction). */
export function resolveFromRawBits(rxBits: number[], seed: number, codec: CodecKind = 'bch'): DecodeResult {
  return codec === 'rs'
    ? (() => {
        const r = resolveRxBitsRS(rxBits, seed);
        return { message: r.message, validCopies: r.validCopies, totalCopies: r.totalCopies, totalBitErrorsCorrected: r.totalSymbolErrorsCorrected };
      })()
    : resolveRxBits(rxBits, seed);
}

export interface DecodeOptions {
  seed?: number;
  coeff1?: CoeffPos;
  coeff2?: CoeffPos;
  codec?: CodecKind;
  interleave?: boolean;
}

export interface DecodeResult {
  message: string | null;
  validCopies: number;
  totalCopies: number;
  totalBitErrorsCorrected: number;
}

/** Decode: any-resolution RGBA in -> downsample to canonical grid -> extract + BCH/RS-recover. */
export function decodeImage(input: RgbaImage, opts: DecodeOptions = {}): DecodeResult {
  const seed = opts.seed ?? DEFAULT_SEED;
  const codec = opts.codec ?? 'bch';
  const { rxBits } = extractRawBits(input, opts);
  return resolveFromRawBits(rxBits, seed, codec);
}
