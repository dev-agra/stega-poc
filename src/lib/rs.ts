import { GF, GF64_PRIMITIVE_POLY } from './gf';

// Reed-Solomon over GF(2^m). Unlike binary BCH, symbols are GF(2^m)
// elements (not single bits), and an error can be ANY nonzero magnitude in
// that field, not just a flip -- so decoding needs Forney's algorithm on
// top of Berlekamp-Massey + Chien search to recover error *values*, not
// just locations.

export interface RsCode {
  gf: GF;
  n: number; // codeword length in symbols
  k: number; // message length in symbols
  t: number; // guaranteed correctable symbol errors
  generator: number[]; // GF(2^m) elements, high-degree-first, length n-k+1
}

/** Build a systematic RS code: n = k + 2t, generator = product (x - alpha^i) for i=1..2t. */
export function buildRsCode(m: number, k: number, t: number): RsCode {
  const gf = new GF(m, GF64_PRIMITIVE_POLY);
  const n = k + 2 * t;
  if (n > gf.n) throw new Error(`n=${n} exceeds field size ${gf.n}`);

  // generator polynomial, coefficients in GF(2^m), high-degree-first
  let gen = [1];
  for (let i = 1; i <= 2 * t; i++) {
    const root = gf.exp(i);
    // multiply gen by (x - root) = (x + root) since GF(2^m) char 2
    const next = new Array(gen.length + 1).fill(0);
    for (let j = 0; j < gen.length; j++) {
      next[j] = gf.add(next[j], gen[j]); // x * gen shifts index
      next[j + 1] = gf.add(next[j + 1], gf.mul(gen[j], root));
    }
    gen = next;
  }

  return { gf, n, k, t, generator: gen };
}

/** Evaluate a GF polynomial (high-degree-first coeffs) at point x. */
function evalPoly(gf: GF, poly: number[], x: number): number {
  let result = 0;
  for (const coef of poly) {
    result = gf.add(gf.mul(result, x), coef);
  }
  return result;
}

/** Systematic encode: codeword = [message..., parity...], parity = message(x)*x^(n-k) mod g(x). */
export function rsEncode(code: RsCode, message: number[]): number[] {
  const { gf, n, k, generator } = code;
  if (message.length !== k) throw new Error(`Expected ${k} symbols, got ${message.length}`);

  const shifted = [...message, ...new Array(n - k).fill(0)];
  // polynomial division over GF(2^m): remainder of shifted / generator
  const rem = shifted.slice();
  const genDeg = generator.length - 1;
  for (let i = 0; i < k; i++) {
    const coef = rem[i];
    if (coef === 0) continue;
    for (let j = 0; j <= genDeg; j++) {
      rem[i + j] = gf.add(rem[i + j], gf.mul(coef, generator[j]));
    }
  }
  const parity = rem.slice(k); // last n-k entries
  return [...message, ...parity];
}

export interface RsDecodeResult {
  success: boolean;
  corrected: number[] | null;
  message: number[] | null;
  errorsFound: number;
}

/** Decode a received n-symbol codeword, correcting up to t symbol errors via BM + Chien + Forney. */
export function rsDecode(code: RsCode, received: number[]): RsDecodeResult {
  const { gf, n, k, t } = code;
  if (received.length !== n) throw new Error(`Expected ${n} symbols, got ${received.length}`);

  // received(x) as high-degree-first poly matching our [message...,parity] symbol order:
  // treat received[0] as coefficient of x^(n-1), received[n-1] as x^0.
  const recvPoly = received;

  const syndromes: number[] = new Array(2 * t + 1).fill(0);
  let anyNonZero = false;
  for (let i = 1; i <= 2 * t; i++) {
    const s = evalPoly(gf, recvPoly, gf.exp(i));
    syndromes[i] = s;
    if (s !== 0) anyNonZero = true;
  }

  if (!anyNonZero) {
    return { success: true, corrected: received.slice(), message: received.slice(0, k), errorsFound: 0 };
  }

  // Berlekamp-Massey over GF(2^m) to find error locator sigma(x), low-degree-first, sigma[0]=1
  let sigma = [1];
  let prevSigma = [1];
  let l = 0;
  let mShift = 1;
  let b = 1;

  for (let r = 1; r <= 2 * t; r++) {
    let delta = syndromes[r] ?? 0;
    for (let i = 1; i <= l; i++) {
      delta = gf.add(delta, gf.mul(sigma[i] ?? 0, syndromes[r - i] ?? 0));
    }

    if (delta === 0) {
      mShift += 1;
    } else if (2 * l >= r) {
      const coef = gf.div(delta, b);
      const newSigma = sigma.slice();
      for (let i = 0; i < prevSigma.length; i++) {
        const idx = i + mShift;
        newSigma[idx] = gf.add(newSigma[idx] ?? 0, gf.mul(coef, prevSigma[i]));
      }
      sigma = newSigma;
      mShift += 1;
    } else {
      const coef = gf.div(delta, b);
      const newSigma = new Array(Math.max(sigma.length, prevSigma.length + mShift)).fill(0);
      for (let i = 0; i < sigma.length; i++) newSigma[i] = sigma[i];
      for (let i = 0; i < prevSigma.length; i++) {
        const idx = i + mShift;
        newSigma[idx] = gf.add(newSigma[idx] ?? 0, gf.mul(coef, prevSigma[i]));
      }
      prevSigma = sigma;
      sigma = newSigma;
      l = r - l;
      b = delta;
      mShift = 1;
    }
  }

  const degSigma = (() => {
    for (let d = sigma.length - 1; d >= 0; d--) if (sigma[d] !== 0) return d;
    return 0;
  })();

  if (degSigma > t) {
    return { success: false, corrected: null, message: null, errorsFound: -1 };
  }

  // Chien search: roots of sigma(x) at alpha^-i => error at codeword position i
  // (position i means coefficient of x^(n-1-i) in our high-degree-first array)
  const errorPositions: number[] = [];
  const errorLocatorInverses: number[] = []; // alpha^i values (X_l) for Forney
  for (let i = 0; i < n; i++) {
    const xInv = gf.exp(-i);
    let val = 0;
    for (let deg = 0; deg < sigma.length; deg++) {
      if (sigma[deg] === 0) continue;
      val = gf.add(val, gf.mul(sigma[deg], gf.pow(xInv, deg)));
    }
    if (val === 0) {
      errorPositions.push(n - 1 - i);
      errorLocatorInverses.push(gf.exp(i)); // X_l = alpha^i
    }
  }

  if (errorPositions.length !== degSigma || errorPositions.length > t) {
    return { success: false, corrected: null, message: null, errorsFound: -1 };
  }
  if (errorPositions.length === 0) {
    // syndromes nonzero but no roots found -> uncorrectable
    return { success: false, corrected: null, message: null, errorsFound: -1 };
  }

  // Error evaluator polynomial: Omega(x) = [S(x) * sigma(x)] mod x^(2t+1), S(x) = sum S_i x^i (low-degree-first, S_0 implied 0/unused)
  // Build S(x) low-degree-first using syndromes[1..2t]
  const Slow: number[] = new Array(2 * t).fill(0);
  for (let i = 1; i <= 2 * t; i++) Slow[i - 1] = syndromes[i];

  // sigma is stored low-degree-first already (sigma[0..]); multiply S(x)*sigma(x), truncate to degree < 2t
  const omega: number[] = new Array(2 * t).fill(0);
  for (let i = 0; i < Slow.length; i++) {
    if (Slow[i] === 0) continue;
    for (let j = 0; j < sigma.length; j++) {
      if (sigma[j] === 0) continue;
      const deg = i + j;
      if (deg >= 2 * t) continue;
      omega[deg] = gf.add(omega[deg], gf.mul(Slow[i], sigma[j]));
    }
  }

  // sigma'(x): formal derivative (low-degree-first), over GF(2^m) char 2: derivative kills even-degree terms
  const sigmaDeriv: number[] = [];
  for (let deg = 1; deg < sigma.length; deg++) {
    sigmaDeriv.push(deg % 2 === 1 ? sigma[deg] : 0);
  }

  const corrected = received.slice();
  for (let l = 0; l < errorPositions.length; l++) {
    const Xl = errorLocatorInverses[l]; // alpha^i
    const XlInv = gf.inv(Xl);

    // Omega(Xl^-1)
    let omegaVal = 0;
    for (let deg = 0; deg < omega.length; deg++) {
      if (omega[deg] === 0) continue;
      omegaVal = gf.add(omegaVal, gf.mul(omega[deg], gf.pow(XlInv, deg)));
    }
    // sigma'(Xl^-1)
    let sigmaDerivVal = 0;
    for (let deg = 0; deg < sigmaDeriv.length; deg++) {
      if (sigmaDeriv[deg] === 0) continue;
      sigmaDerivVal = gf.add(sigmaDerivVal, gf.mul(sigmaDeriv[deg], gf.pow(XlInv, deg)));
    }

    if (sigmaDerivVal === 0) {
      return { success: false, corrected: null, message: null, errorsFound: -1 };
    }

    // Forney: error magnitude e_l = Omega(Xl^-1) / sigma'(Xl^-1)
    // (sign is irrelevant here since we're in characteristic 2, so -a = a)
    const errMagnitude = gf.div(omegaVal, sigmaDerivVal);

    const pos = errorPositions[l];
    if (pos < 0 || pos >= n) {
      return { success: false, corrected: null, message: null, errorsFound: -1 };
    }
    corrected[pos] = gf.add(corrected[pos], errMagnitude);
  }

  // verify: recompute syndromes on corrected codeword, must all be zero
  for (let i = 1; i <= 2 * t; i++) {
    if (evalPoly(gf, corrected, gf.exp(i)) !== 0) {
      return { success: false, corrected: null, message: null, errorsFound: -1 };
    }
  }

  return {
    success: true,
    corrected,
    message: corrected.slice(0, k),
    errorsFound: errorPositions.length,
  };
}
