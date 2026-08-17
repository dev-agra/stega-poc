// 8x8 2D DCT-II / inverse DCT, used for per-block frequency-domain embedding.

const N = 8;

// Precompute cos table: COS[u][x] = cos((2x+1)*u*PI/16)
const COS_TABLE: number[][] = Array.from({ length: N }, (_, u) =>
  Array.from({ length: N }, (_, x) => Math.cos(((2 * x + 1) * u * Math.PI) / 16))
);

// Normalization constants C(0) = 1/sqrt(2), C(u>0) = 1
const C: number[] = Array.from({ length: N }, (_, u) => (u === 0 ? 1 / Math.sqrt(2) : 1));

export type Block8 = Float64Array[]; // 8 rows x 8 cols

export function makeBlock(): Block8 {
  return Array.from({ length: N }, () => new Float64Array(N));
}

/** Forward 2D DCT-II on an 8x8 block. */
export function dct8x8(block: Block8): Block8 {
  const F = makeBlock();
  for (let u = 0; u < N; u++) {
    for (let v = 0; v < N; v++) {
      let sum = 0;
      for (let x = 0; x < N; x++) {
        for (let y = 0; y < N; y++) {
          sum += block[x][y] * COS_TABLE[u][x] * COS_TABLE[v][y];
        }
      }
      F[u][v] = 0.25 * C[u] * C[v] * sum;
    }
  }
  return F;
}

/** Inverse 2D DCT on an 8x8 coefficient block. */
export function idct8x8(F: Block8): Block8 {
  const f = makeBlock();
  for (let x = 0; x < N; x++) {
    for (let y = 0; y < N; y++) {
      let sum = 0;
      for (let u = 0; u < N; u++) {
        for (let v = 0; v < N; v++) {
          sum += C[u] * C[v] * F[u][v] * COS_TABLE[u][x] * COS_TABLE[v][y];
        }
      }
      f[x][y] = 0.25 * sum;
    }
  }
  return f;
}

export interface CoeffPos {
  u: number;
  v: number;
}

/**
 * Embed a single bit into a block by forcing the relative order of two
 * mid-frequency coefficients: bit=1 => F(c1) > F(c2), bit=0 => F(c1) < F(c2).
 * Operates on the already-DCT'd block F, mutating a copy and returning it.
 */
export function embedBitInCoeffs(
  F: Block8,
  bit: 0 | 1,
  c1: CoeffPos,
  c2: CoeffPos,
  strength: number
): Block8 {
  const out = F.map((row) => Float64Array.from(row));
  const avg = (out[c1.u][c1.v] + out[c2.u][c2.v]) / 2;
  if (bit === 1) {
    out[c1.u][c1.v] = avg + strength / 2;
    out[c2.u][c2.v] = avg - strength / 2;
  } else {
    out[c1.u][c1.v] = avg - strength / 2;
    out[c2.u][c2.v] = avg + strength / 2;
  }
  return out;
}

/** Extract a bit from a DCT'd block by comparing the coefficient pair. */
export function extractBitFromCoeffs(F: Block8, c1: CoeffPos, c2: CoeffPos): 0 | 1 {
  return F[c1.u][c1.v] > F[c2.u][c2.v] ? 1 : 0;
}

/** ASCII string (exactly N chars) -> bit array, MSB first per char. */
export function stringToBits(str: string, chars = 8): number[] {
  const bits: number[] = [];
  for (let i = 0; i < chars; i++) {
    const code = i < str.length ? str.charCodeAt(i) : 32;
    for (let b = 7; b >= 0; b--) bits.push((code >> b) & 1);
  }
  return bits;
}

export function bitsToString(bits: number[], chars = 8): string {
  let str = '';
  for (let i = 0; i < chars; i++) {
    let code = 0;
    for (let b = 0; b < 8; b++) code = (code << 1) | bits[i * 8 + b];
    str += String.fromCharCode(code);
  }
  return str;
}
