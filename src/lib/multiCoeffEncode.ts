import { resizeBilinear } from './resize';
import { rgbToYCbCr, ycbcrToRgb } from './color';
import { dct8x8, idct8x8, embedBitInCoeffs, extractBitFromCoeffs, makeBlock, type CoeffPos, type Block8 } from './dct';
import { prepareTxBits, resolveRxBits } from './payloadCodec';
import {
  CANONICAL_SIZE,
  BLOCK_COUNT_PER_SIDE,
  TOTAL_BLOCKS,
  DEFAULT_SEED,
  splitChannels,
  mergeChannels,
  computeAvgCoeffDifference,
  type RgbaImage,
  type DecodeResult,
  type CoeffDifferenceReport,
} from './imageStego';

export interface CoeffPair {
  coeff1: CoeffPos;
  coeff2: CoeffPos;
}

export interface MultiCoeffEncodeOptions {
  strength?: number;
  seed?: number;
  coeffPairs: CoeffPair[]; // e.g. 3 pairs -> 6 coefficients modified per block, one DCT/IDCT pass
}

export interface MultiCoeffEncodeResult {
  image: RgbaImage;
  stats: {
    repeats: number;
    bitsEmbedded: number;
    strength: number;
    seed: number;
    pairsPerBlock: number;
  };
}

/**
 * Single-pass multi-coefficient-pair encode: for each block, the SAME bit is
 * embedded redundantly into every coefficient pair supplied (e.g. 3 pairs =
 * 6 coefficients modified) within one DCT -> modify -> IDCT round, then the
 * usual downsample/delta/upsample pipeline runs exactly once for the whole
 * image - not once per pair. This trades a fixed extra cost per block
 * (a few more coefficient writes) for zero extra resize/delta pipeline
 * passes, unlike cascaded multi-layer encoding which reruns the full
 * pipeline once per layer.
 */
export function encodeImageMultiCoeff(
  input: RgbaImage,
  secret8: string,
  opts: MultiCoeffEncodeOptions
): MultiCoeffEncodeResult {
  if (secret8.length !== 8) throw new Error('Secret message must be exactly 8 characters');
  if (opts.coeffPairs.length === 0) throw new Error('At least one coefficient pair is required');

  const strength = opts.strength ?? 120;
  const seed = opts.seed ?? DEFAULT_SEED;
  const pairs = opts.coeffPairs;

  const { R, G, B, A } = splitChannels(input);
  const R256 = resizeBilinear(R, input.width, input.height, CANONICAL_SIZE, CANONICAL_SIZE);
  const G256 = resizeBilinear(G, input.width, input.height, CANONICAL_SIZE, CANONICAL_SIZE);
  const B256 = resizeBilinear(B, input.width, input.height, CANONICAL_SIZE, CANONICAL_SIZE);
  const { Y, Cb, Cr } = rgbToYCbCr(R256, G256, B256);
  const Yprime = Float64Array.from(Y);

  const { txBits, repeats } = prepareTxBits(secret8, TOTAL_BLOCKS, seed);

  for (let blockIdx = 0; blockIdx < txBits.length && blockIdx < TOTAL_BLOCKS; blockIdx++) {
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

    let F = dct8x8(block);
    const bit = txBits[blockIdx] as 0 | 1;

    // Apply all N coefficient pairs' embedding within this single DCT
    // representation before running IDCT once.
    for (const { coeff1, coeff2 } of pairs) {
      F = embedBitInCoeffs(F, bit, coeff1, coeff2, strength);
    }

    const newBlock = idct8x8(F);
    for (let y = 0; y < 8; y++) {
      for (let x = 0; x < 8; x++) {
        Yprime[(by + y) * CANONICAL_SIZE + (bx + x)] = newBlock[y][x];
      }
    }
  }

  const { R: R256p, G: G256p, B: B256p } = ycbcrToRgb(Yprime, Cb, Cr);

  const deltaR256 = new Float64Array(CANONICAL_SIZE * CANONICAL_SIZE);
  const deltaG256 = new Float64Array(CANONICAL_SIZE * CANONICAL_SIZE);
  const deltaB256 = new Float64Array(CANONICAL_SIZE * CANONICAL_SIZE);
  for (let i = 0; i < deltaR256.length; i++) {
    deltaR256[i] = R256p[i] - R256[i];
    deltaG256[i] = G256p[i] - G256[i];
    deltaB256[i] = B256p[i] - B256[i];
  }

  const deltaRFull = resizeBilinear(deltaR256, CANONICAL_SIZE, CANONICAL_SIZE, input.width, input.height);
  const deltaGFull = resizeBilinear(deltaG256, CANONICAL_SIZE, CANONICAL_SIZE, input.width, input.height);
  const deltaBFull = resizeBilinear(deltaB256, CANONICAL_SIZE, CANONICAL_SIZE, input.width, input.height);

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
    stats: { repeats, bitsEmbedded: txBits.length, strength, seed, pairsPerBlock: pairs.length },
  };
}

export interface MultiCoeffDecodeOptions {
  seed?: number;
  coeffPairs: CoeffPair[];
}

/**
 * Decode: for each block, extract one raw bit PER coefficient pair, then
 * majority-vote across those N intra-block votes into a single consensus
 * bit before handing off to the existing BCH repeat/majority-vote pipeline
 * unchanged. This is the payoff of the multi-pair approach: each block's
 * bit is now backed by N independent readings instead of one.
 */
export function decodeImageMultiCoeff(input: RgbaImage, opts: MultiCoeffDecodeOptions): DecodeResult {
  const seed = opts.seed ?? DEFAULT_SEED;
  const pairs = opts.coeffPairs;

  const { R, G, B } = splitChannels(input);
  const R256 = resizeBilinear(R, input.width, input.height, CANONICAL_SIZE, CANONICAL_SIZE);
  const G256 = resizeBilinear(G, input.width, input.height, CANONICAL_SIZE, CANONICAL_SIZE);
  const B256 = resizeBilinear(B, input.width, input.height, CANONICAL_SIZE, CANONICAL_SIZE);
  const { Y } = rgbToYCbCr(R256, G256, B256);

  const rxBits: number[] = [];
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

    let ones = 0;
    for (const { coeff1, coeff2 } of pairs) {
      ones += extractBitFromCoeffs(F, coeff1, coeff2);
    }
    rxBits.push(ones * 2 >= pairs.length ? 1 : 0);
  }

  return resolveRxBits(rxBits, seed);
}

export interface PerPairCoeffDifference extends CoeffDifferenceReport {
  coeff1: CoeffPos;
  coeff2: CoeffPos;
}

/** Same average-coefficient-difference diagnostic, computed per pair for multi-coeff mode. */
export function computeAvgCoeffDifferencesMulti(input: RgbaImage, coeffPairs: CoeffPair[]): PerPairCoeffDifference[] {
  return coeffPairs.map(({ coeff1, coeff2 }) => ({
    coeff1,
    coeff2,
    ...computeAvgCoeffDifference(input, coeff1, coeff2),
  }));
}
