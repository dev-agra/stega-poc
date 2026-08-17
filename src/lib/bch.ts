import { GF, GF64_PRIMITIVE_POLY } from './gf';

// Binary polynomials represented as number[] of 0/1, index 0 = highest degree
// coefficient (MSB-first), matching how we already store message bits.

function polyDegree(p: number[]): number {
  for (let i = 0; i < p.length; i++) if (p[i] === 1) return p.length - 1 - i;
  return -Infinity;
}

function polyTrim(p: number[]): number[] {
  let start = 0;
  while (start < p.length - 1 && p[start] === 0) start++;
  return p.slice(start);
}

/** Multiply two GF(2) polynomials (bit arrays, MSB-first). */
function polyMulGF2(a: number[], b: number[]): number[] {
  const res = new Array(a.length + b.length - 1).fill(0);
  for (let i = 0; i < a.length; i++) {
    if (a[i] === 0) continue;
    for (let j = 0; j < b.length; j++) {
      res[i + j] ^= a[i] & b[j];
    }
  }
  return polyTrim(res);
}

/** Polynomial division over GF(2): returns remainder of a / b (bit arrays MSB-first). */
function polyModGF2(a: number[], b: number[]): number[] {
  const bTrim = polyTrim(b);
  const bDeg = polyDegree(bTrim);
  if (bDeg < 0) throw new Error('division by zero polynomial');

  // Work on a mutable copy, indexed the same way as `a` (MSB-first, index 0 = highest degree of a).
  const rem = a.slice();
  const aDeg = a.length - 1; // degree represented by index 0

  for (let shift = aDeg - bDeg; shift >= 0; shift--) {
    const leadIdx = aDeg - (bDeg + shift); // index in rem[] of the coefficient for degree (bDeg+shift)
    if (rem[leadIdx] === 0) continue;
    for (let i = 0; i <= bDeg; i++) {
      rem[leadIdx + i] ^= bTrim[i];
    }
  }

  // remainder occupies the last bDeg coefficients (degrees bDeg-1 .. 0)
  return polyTrim(rem.slice(rem.length - bDeg));
}

/** Minimal polynomial of alpha^i over GF(2), as a GF(2) bit array (MSB-first). */
function minimalPolynomial(gf: GF, i: number): number[] {
  // Find cyclotomic coset of i: {i, 2i, 4i, ...} mod n
  const coset = new Set<number>();
  let x = i % gf.n;
  do {
    coset.add(x);
    x = (x * 2) % gf.n;
  } while (!coset.has(x));

  // minimal poly = product over coset of (x - alpha^c) = (x + alpha^c) in GF(2^m)
  // Represent poly coefficients as GF(2^m) elements first, then reduce (they'll come out as 0/1 in GF(2))
  let poly: number[] = [1]; // constant 1, representing polynomial "1" with GF elements
  for (const c of coset) {
    const root = gf.exp(c);
    // multiply poly by (x + root): new_poly[k] = poly[k-1] + root*poly[k]  (in GF(2^m))
    const newPoly = new Array(poly.length + 1).fill(0);
    for (let k = 0; k < poly.length; k++) {
      newPoly[k] = gf.add(newPoly[k], poly[k]); // x * poly shifts index by 1 -> handled below
    }
    // proper convolution: (x + root) * poly = x*poly + root*poly
    const shifted = [...poly, 0]; // x * poly
    const scaled = poly.map((coef) => gf.mul(coef, root)); // root * poly, same length as poly
    const scaledAligned = [0, ...scaled]; // align degree (shift by 0, pad front to match length)
    const result = new Array(shifted.length).fill(0);
    for (let k = 0; k < shifted.length; k++) {
      const a = shifted[k] ?? 0;
      const b = scaledAligned[k] ?? 0;
      result[k] = gf.add(a, b);
    }
    poly = result;
  }
  // poly coefficients should all be 0 or 1 (elements of GF(2)) since minimal poly has binary coeffs
  return poly.map((v) => (v === 0 ? 0 : 1));
}

export interface BchCode {
  n: number; // codeword length
  k: number; // message length
  t: number; // guaranteed correctable errors
  generator: number[]; // GF(2) bit array, MSB-first, degree n-k
  gf: GF;
}

/** Build a binary BCH code over GF(2^m) correcting up to t errors, length n = 2^m - 1. */
export function buildBchCode(m: number, t: number): BchCode {
  const gf = new GF(m, GF64_PRIMITIVE_POLY);
  const n = gf.n;

  // gather distinct minimal polynomials for i = 1, 3, 5, ..., 2t-1 (odd only; covers all cosets needed)
  const seenCosetReps = new Set<number>();
  let generator: number[] = [1];
  for (let i = 1; i <= 2 * t - 1; i += 2) {
    if (seenCosetReps.has(i)) continue;
    const mp = minimalPolynomial(gf, i);
    // mark whole coset as seen so we don't recompute/multiply duplicate factors
    let x = i;
    do {
      seenCosetReps.add(x);
      x = (x * 2) % n;
    } while (x !== i);
    generator = polyMulGF2(generator, mp);
  }

  const k = n - polyDegree(generator);
  return { n, k, t, generator, gf };
}

/** Encode a k-bit message (0/1 array, MSB-first) into an n-bit BCH codeword. */
export function bchEncode(code: BchCode, messageBits: number[]): number[] {
  if (messageBits.length !== code.k) {
    throw new Error(`Expected ${code.k} message bits, got ${messageBits.length}`);
  }
  const shifted = [...messageBits, ...new Array(code.n - code.k).fill(0)];
  const remainder = polyModGF2(shifted, code.generator);
  const remPadded = new Array(code.n - code.k).fill(0);
  // right-align remainder into remPadded
  for (let i = 0; i < remainder.length; i++) {
    remPadded[remPadded.length - remainder.length + i] = remainder[i];
  }
  const codeword = shifted.slice();
  for (let i = 0; i < remPadded.length; i++) {
    codeword[code.k + i] = remPadded[i];
  }
  return codeword;
}

export interface BchDecodeResult {
  success: boolean;
  correctedBits: number[] | null; // full n-bit corrected codeword
  message: number[] | null; // first k bits
  errorsFound: number;
}

/**
 * Decode a received n-bit array, correcting up to t errors via
 * Berlekamp-Massey + Chien search. Returns success=false if uncorrectable
 * (this is the "reject as garbage" signal).
 */
export function bchDecode(code: BchCode, receivedBits: number[]): BchDecodeResult {
  const { gf, n, t, k } = code;
  if (receivedBits.length !== n) {
    throw new Error(`Expected ${n} bits, got ${receivedBits.length}`);
  }

  // Evaluate received polynomial r(x) = sum receivedBits[i] * x^(n-1-i) at alpha^j
  // Syndromes S_j = r(alpha^j) for j = 1..2t
  const syndromes: number[] = new Array(2 * t + 1).fill(0);
  let anyNonZero = false;
  for (let j = 1; j <= 2 * t; j++) {
    let s = 0;
    for (let i = 0; i < n; i++) {
      if (receivedBits[i] === 0) continue;
      const power = n - 1 - i;
      s = gf.add(s, gf.pow(gf.exp(j), power));
    }
    syndromes[j] = s;
    if (s !== 0) anyNonZero = true;
  }

  if (!anyNonZero) {
    return {
      success: true,
      correctedBits: receivedBits.slice(),
      message: receivedBits.slice(0, k),
      errorsFound: 0,
    };
  }

  // Berlekamp-Massey to find error locator polynomial sigma(x), coefficients in GF(2^m)
  // sigma stored low-degree-first: sigma[0] = 1 (constant term)
  let sigma = [1];
  let prevSigma = [1];
  let l = 0;
  let m2 = 1;
  let b = 1;

  for (let r = 1; r <= 2 * t; r++) {
    // discrepancy
    let delta = syndromes[r] ?? 0;
    for (let i = 1; i <= l; i++) {
      delta = gf.add(delta, gf.mul(sigma[i] ?? 0, syndromes[r - i] ?? 0));
    }

    if (delta === 0) {
      m2 += 1;
    } else if (2 * l >= r) {
      // update sigma without increasing degree
      const coef = gf.div(delta, b);
      const newSigma = sigma.slice();
      for (let i = 0; i < prevSigma.length; i++) {
        const idx = i + m2;
        newSigma[idx] = gf.add(newSigma[idx] ?? 0, gf.mul(coef, prevSigma[i]));
      }
      sigma = newSigma;
      m2 += 1;
    } else {
      const coef = gf.div(delta, b);
      const newSigma = new Array(Math.max(sigma.length, prevSigma.length + m2)).fill(0);
      for (let i = 0; i < sigma.length; i++) newSigma[i] = sigma[i];
      for (let i = 0; i < prevSigma.length; i++) {
        const idx = i + m2;
        newSigma[idx] = gf.add(newSigma[idx] ?? 0, gf.mul(coef, prevSigma[i]));
      }
      prevSigma = sigma;
      sigma = newSigma;
      l = r - l;
      b = delta;
      m2 = 1;
    }
  }

  // Chien search: find roots of sigma(x) among alpha^-i for i=0..n-1 => error position i
  const errorPositions: number[] = [];
  for (let i = 0; i < n; i++) {
    // evaluate sigma at alpha^i (since sigma(x) roots are alpha^-(error position index from x^0))
    const xInv = gf.exp(-i);
    let val = 0;
    for (let deg = 0; deg < sigma.length; deg++) {
      if (sigma[deg] === 0) continue;
      val = gf.add(val, gf.mul(sigma[deg], gf.pow(xInv, deg)));
    }
    if (val === 0) {
      // error at position corresponding to x^i term => bit index (n-1-i) in MSB-first array
      errorPositions.push(n - 1 - i);
    }
  }

  const degSigma = (() => {
    for (let d = sigma.length - 1; d >= 0; d--) if (sigma[d] !== 0) return d;
    return 0;
  })();

  if (errorPositions.length !== degSigma || errorPositions.length > t) {
    return { success: false, correctedBits: null, message: null, errorsFound: -1 };
  }

  const corrected = receivedBits.slice();
  for (const pos of errorPositions) {
    if (pos < 0 || pos >= n) {
      return { success: false, correctedBits: null, message: null, errorsFound: -1 };
    }
    corrected[pos] ^= 1;
  }

  // verify: recompute syndromes on corrected word, must all be zero
  for (let j = 1; j <= 2 * t; j++) {
    let s = 0;
    for (let i = 0; i < n; i++) {
      if (corrected[i] === 0) continue;
      const power = n - 1 - i;
      s = gf.add(s, gf.pow(gf.exp(j), power));
    }
    if (s !== 0) {
      return { success: false, correctedBits: null, message: null, errorsFound: -1 };
    }
  }

  return {
    success: true,
    correctedBits: corrected,
    message: corrected.slice(0, k),
    errorsFound: errorPositions.length,
  };
}
