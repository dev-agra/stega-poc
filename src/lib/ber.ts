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

export interface BerReport {
  ber: number;
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
  codec: CodecKind = 'bch'
): BerReport {
  const prepared =
    codec === 'rs' ? prepareTxBitsRS(secret8, TOTAL_BLOCKS, seed) : prepareTxBits(secret8, TOTAL_BLOCKS, seed);
  const reference = prepared.txBits;

  const len = Math.min(reference.length, scannedBits.length);
  const refSlice = reference.slice(0, len);
  const scannedSlice = scannedBits.slice(0, len);

  const ber = computeBER(refSlice, scannedSlice);
  let mismatches = 0;
  for (let i = 0; i < len; i++) if (refSlice[i] !== scannedSlice[i]) mismatches++;

  return { ber, bitsCompared: len, mismatches };
}
