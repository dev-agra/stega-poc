import { prepareTxBits } from './payloadCodec';
import { prepareTxBitsRS } from './payloadCodecRS';
import { TOTAL_BLOCKS, type CodecKind } from './imageStego';

/**
 * BER = fraction of mismatched bits between the reference bit-pattern (what
 * was actually embedded, regenerated deterministically from secret+seed+codec)
 * and the scanned bit-pattern (what got extracted from the image's DCT
 * coefficients). Low BER -> the layer survived intact. High BER -> heavy
 * distortion (or wrong secret/seed/coeff entirely).
 */
export function computeBER(reference: number[], scanned: number[]): number {
  const len = Math.min(reference.length, scanned.length);
  if (len === 0) return 0;
  let mismatches = 0;
  for (let i = 0; i < len; i++) {
    if (reference[i] !== scanned[i]) mismatches++;
  }
  return mismatches / len;
}

/**
 * BERv2: confidence-weighted BER. Each bit's mismatch is weighted by how
 * reliable that bit's extraction was, rather than counting every bit
 * equally. Here the natural, signal-derived confidence is the magnitude of
 * separation between the two DCT coefficients used for that bit
 * (|F(coeff1) - F(coeff2)|) at decode time: a bit read from two coefficients
 * that were far apart is a confident read; one read from two coefficients
 * that were nearly equal is a coin-flip, and a mismatch there is weak
 * evidence of real distortion (as opposed to a confident bit flipping,
 * which is strong evidence).
 */
export function computeWeightedBER(reference: number[], scanned: number[], weights: number[]): number {
  const len = Math.min(reference.length, scanned.length, weights.length);
  if (len === 0) return 0;
  let num = 0;
  let den = 0;
  for (let i = 0; i < len; i++) {
    const w = weights[i];
    den += w;
    if (reference[i] !== scanned[i]) num += w;
  }
  if (den === 0) return 0;
  return num / den;
}

export interface BerReport {
  ber: number;
  berV2: number;
  bitsCompared: number;
  mismatches: number;
}

/**
 * Regenerate the reference bit-stream for a known secret+seed+codec (exactly
 * as encodeImage would have produced it) and compare against a scanned
 * extraction. This is the full "regenerate the encoding bits and compare
 * against the bits read from the image" diagnostic.
 */
export function computeBerReport(
  secret8: string,
  seed: number,
  scannedBits: number[],
  confidences: number[],
  codec: CodecKind = 'bch'
): BerReport {
  const prepared =
    codec === 'rs' ? prepareTxBitsRS(secret8, TOTAL_BLOCKS, seed) : prepareTxBits(secret8, TOTAL_BLOCKS, seed);
  const reference = prepared.txBits;

  const len = Math.min(reference.length, scannedBits.length);
  const refSlice = reference.slice(0, len);
  const scannedSlice = scannedBits.slice(0, len);
  const weightSlice = confidences.slice(0, len);

  const ber = computeBER(refSlice, scannedSlice);
  const berV2 = computeWeightedBER(refSlice, scannedSlice, weightSlice);
  let mismatches = 0;
  for (let i = 0; i < len; i++) if (refSlice[i] !== scannedSlice[i]) mismatches++;

  return { ber, berV2, bitsCompared: len, mismatches };
}
