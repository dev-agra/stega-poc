/**
 * Deterministic seedable PRNG (mulberry32).
 * NOT cryptographically secure — used only to decorrelate the repeated
 * codeword pattern before embedding, and to reverse that on decode.
 * Same seed on encoder + decoder => identical mask bits.
 */
export function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return function () {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Generate `length` pseudo-random bits (0/1) from a fixed integer seed. */
export function generateMaskBits(seed: number, length: number): number[] {
  const rand = mulberry32(seed);
  const bits = new Array<number>(length);
  for (let i = 0; i < length; i++) {
    bits[i] = rand() < 0.5 ? 1 : 0;
  }
  return bits;
}

/** XOR two equal-length bit arrays. */
export function xorBits(a: number[], b: number[]): number[] {
  const out = new Array<number>(a.length);
  for (let i = 0; i < a.length; i++) out[i] = a[i] ^ b[i % b.length];
  return out;
}
