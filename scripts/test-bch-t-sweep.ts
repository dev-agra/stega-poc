import { PNG } from 'pngjs';
import { readFileSync } from 'fs';
import { buildBchCode, bchEncode, bchDecode } from '../src/lib/bch';
import { generateMaskBits, xorBits } from '../src/lib/prng';
import { stringToBits, bitsToString, dct8x8, idct8x8, embedBitInCoeffs, extractBitFromCoeffs, makeBlock } from '../src/lib/dct';
import { resizeBilinear } from '../src/lib/resize';
import { rgbToYCbCr, ycbcrToRgb } from '../src/lib/color';
import { warpQuadToSquare, computeHomography, applyHomography, type Point } from '../src/lib/homography';
import jsQR from 'jsqr';

const CANONICAL = 256;
const TOTAL_BLOCKS = 1024;
const COEFF1 = { u: 2, v: 3 };
const COEFF2 = { u: 3, v: 4 };
const SEED = 0x5eedc0de;

function encodeWithT(qrImg: { width: number; height: number; data: Uint8ClampedArray }, secret: string, t: number, strength: number) {
  const code = buildBchCode(6, t);
  const k = code.k;
  const bits64 = stringToBits(secret, 8);
  if (k < 32) return null;
  const pad = k - 32; // leading always-zero bits we can shorten away

  // Leading zeros (not trailing) so we can drop them post-encode: message
  // occupies the codeword's first k positions systematically, so forcing
  // the FIRST `pad` of those to 0 means the transmitted codeword's first
  // `pad` symbols are always 0 and never need to be sent.
  const half1Full = [...new Array(pad).fill(0), ...bits64.slice(0, 32)];
  const half2Full = [...new Array(pad).fill(0), ...bits64.slice(32, 64)];
  const cw1Full = bchEncode(code, half1Full); // length n=63, first `pad` bits are 0
  const cw2Full = bchEncode(code, half2Full);
  const cw1 = cw1Full.slice(pad); // shortened: drop the always-zero prefix
  const cw2 = cw2Full.slice(pad);

  const unit = [...cw1, ...cw2];
  const unitLen = unit.length; // 2*(n-pad), shorter than 2n
  const repeats = Math.max(1, Math.floor(TOTAL_BLOCKS / unitLen));

  const raw: number[] = [];
  for (let r = 0; r < repeats; r++) raw.push(...unit);
  const mask = generateMaskBits(SEED, raw.length);
  const txBits = xorBits(raw, mask);

  const n = qrImg.width * qrImg.height;
  const R = new Float64Array(n), G = new Float64Array(n), B = new Float64Array(n), A = new Float64Array(n);
  for (let i = 0; i < n; i++) {
    R[i] = qrImg.data[i * 4]; G[i] = qrImg.data[i * 4 + 1]; B[i] = qrImg.data[i * 4 + 2]; A[i] = qrImg.data[i * 4 + 3];
  }
  const R256 = resizeBilinear(R, qrImg.width, qrImg.height, CANONICAL, CANONICAL);
  const G256 = resizeBilinear(G, qrImg.width, qrImg.height, CANONICAL, CANONICAL);
  const B256 = resizeBilinear(B, qrImg.width, qrImg.height, CANONICAL, CANONICAL);
  const { Y, Cb, Cr } = rgbToYCbCr(R256, G256, B256);
  const Yprime = Float64Array.from(Y);

  for (let blockIdx = 0; blockIdx < txBits.length && blockIdx < TOTAL_BLOCKS; blockIdx++) {
    const row = Math.floor(blockIdx / 32), col = blockIdx % 32, by = row * 8, bx = col * 8;
    const block = makeBlock();
    for (let y = 0; y < 8; y++) for (let x = 0; x < 8; x++) block[y][x] = Y[(by + y) * CANONICAL + (bx + x)];
    const F = dct8x8(block);
    const F2 = embedBitInCoeffs(F, txBits[blockIdx] as 0 | 1, COEFF1, COEFF2, strength);
    const nb = idct8x8(F2);
    for (let y = 0; y < 8; y++) for (let x = 0; x < 8; x++) Yprime[(by + y) * CANONICAL + (bx + x)] = nb[y][x];
  }

  const { R: Rp, G: Gp, B: Bp } = ycbcrToRgb(Yprime, Cb, Cr);
  const deltaR = new Float64Array(CANONICAL * CANONICAL), deltaG = new Float64Array(CANONICAL * CANONICAL), deltaB = new Float64Array(CANONICAL * CANONICAL);
  for (let i = 0; i < deltaR.length; i++) { deltaR[i] = Rp[i] - R256[i]; deltaG[i] = Gp[i] - G256[i]; deltaB[i] = Bp[i] - B256[i]; }
  const dRFull = resizeBilinear(deltaR, CANONICAL, CANONICAL, qrImg.width, qrImg.height);
  const dGFull = resizeBilinear(deltaG, CANONICAL, CANONICAL, qrImg.width, qrImg.height);
  const dBFull = resizeBilinear(deltaB, CANONICAL, CANONICAL, qrImg.width, qrImg.height);

  const outData = new Uint8ClampedArray(qrImg.width * qrImg.height * 4);
  for (let i = 0; i < n; i++) {
    outData[i * 4] = Math.min(255, Math.max(0, R[i] + dRFull[i]));
    outData[i * 4 + 1] = Math.min(255, Math.max(0, G[i] + dGFull[i]));
    outData[i * 4 + 2] = Math.min(255, Math.max(0, B[i] + dBFull[i]));
    outData[i * 4 + 3] = 255;
  }

  return { image: { width: qrImg.width, height: qrImg.height, data: outData }, code, k, pad, repeats, unitLen };
}

function distortAndUnwarp(image: { width: number; height: number; data: Uint8ClampedArray }, skewFactor: number) {
  const canvasSize = Math.round(image.width * (1 + 0.6 * skewFactor));
  const canvas = { width: canvasSize, height: canvasSize, data: new Uint8ClampedArray(canvasSize * canvasSize * 4).fill(200) };
  const distortedQuad: Point[] = [
    { x: 60 * skewFactor, y: 40 * skewFactor },
    { x: canvasSize - 30 * skewFactor, y: 70 * skewFactor },
    { x: canvasSize - 60 * skewFactor, y: canvasSize - 50 * skewFactor },
    { x: 40 * skewFactor, y: canvasSize - 30 * skewFactor },
  ];
  const cleanQuad: Point[] = [{ x: 0, y: 0 }, { x: image.width - 1, y: 0 }, { x: image.width - 1, y: image.height - 1 }, { x: 0, y: image.height - 1 }];
  const Hback = computeHomography(distortedQuad, cleanQuad);
  for (let y = 0; y < canvasSize; y++) {
    for (let x = 0; x < canvasSize; x++) {
      const sp = applyHomography(Hback, { x, y });
      if (sp.x >= 0 && sp.x < image.width - 1 && sp.y >= 0 && sp.y < image.height - 1) {
        const sx = Math.round(sp.x), sy = Math.round(sp.y);
        const srcIdx = (sy * image.width + sx) * 4, dstIdx = (y * canvasSize + x) * 4;
        canvas.data[dstIdx] = image.data[srcIdx]; canvas.data[dstIdx + 1] = image.data[srcIdx + 1]; canvas.data[dstIdx + 2] = image.data[srcIdx + 2]; canvas.data[dstIdx + 3] = 255;
      }
    }
  }
  const detected = jsQR(canvas.data, canvas.width, canvas.height);
  if (!detected) return null;
  const { topLeftCorner, topRightCorner, bottomRightCorner, bottomLeftCorner } = detected.location;
  return warpQuadToSquare(canvas, [topLeftCorner, topRightCorner, bottomRightCorner, bottomLeftCorner], 320);
}

function decodeWithT(warped: { width: number; height: number; data: Uint8ClampedArray }, code: ReturnType<typeof buildBchCode>, repeats: number, unitLen: number, pad: number) {
  const n = warped.width * warped.height;
  const R = new Float64Array(n), G = new Float64Array(n), B = new Float64Array(n);
  for (let i = 0; i < n; i++) { R[i] = warped.data[i * 4]; G[i] = warped.data[i * 4 + 1]; B[i] = warped.data[i * 4 + 2]; }
  const R256 = resizeBilinear(R, warped.width, warped.height, CANONICAL, CANONICAL);
  const G256 = resizeBilinear(G, warped.width, warped.height, CANONICAL, CANONICAL);
  const B256 = resizeBilinear(B, warped.width, warped.height, CANONICAL, CANONICAL);
  const { Y } = rgbToYCbCr(R256, G256, B256);

  const rxBits: number[] = [];
  for (let blockIdx = 0; blockIdx < TOTAL_BLOCKS; blockIdx++) {
    const row = Math.floor(blockIdx / 32), col = blockIdx % 32, by = row * 8, bx = col * 8;
    const block = makeBlock();
    for (let y = 0; y < 8; y++) for (let x = 0; x < 8; x++) block[y][x] = Y[(by + y) * CANONICAL + (bx + x)];
    const F = dct8x8(block);
    rxBits.push(extractBitFromCoeffs(F, COEFF1, COEFF2));
  }

  const mask = generateMaskBits(SEED, repeats * unitLen);
  const demasked = xorBits(rxBits.slice(0, repeats * unitLen), mask);

  const shortN = code.n - pad;
  const half1Votes: number[][] = Array.from({ length: 32 }, () => []);
  const half2Votes: number[][] = Array.from({ length: 32 }, () => []);
  let validCopies = 0;
  for (let r = 0; r < repeats; r++) {
    const unit = demasked.slice(r * unitLen, (r + 1) * unitLen);
    const cw1Short = unit.slice(0, shortN);
    const cw2Short = unit.slice(shortN);
    // reconstruct the always-zero prefix that was never transmitted
    const cw1 = [...new Array(pad).fill(0), ...cw1Short];
    const cw2 = [...new Array(pad).fill(0), ...cw2Short];
    const d1 = bchDecode(code, cw1);
    const d2 = bchDecode(code, cw2);
    if (d1.success && d2.success && d1.message && d2.message) {
      validCopies++;
      // message[] is the full k-length array; real bits are the last 32
      for (let i = 0; i < 32; i++) { half1Votes[i].push(d1.message[pad + i]); half2Votes[i].push(d2.message[pad + i]); }
      if (process.env.DEBUG_COPIES) {
        console.log(`    repeat ${r}: d1.errorsFound=${d1.errorsFound} d2.errorsFound=${d2.errorsFound} half1=${d1.message.slice(pad).join('')} half2=${d2.message.slice(pad).join('')}`);
      }
    }
  }
  if (validCopies === 0) return { message: null, validCopies, totalCopies: repeats };
  const majority = (v: number[]) => (v.filter((x) => x === 1).length * 2 >= v.length ? 1 : 0);
  const bits64: number[] = [];
  for (let i = 0; i < 32; i++) bits64.push(majority(half1Votes[i]));
  for (let i = 0; i < 32; i++) bits64.push(majority(half2Votes[i]));
  return { message: bitsToString(bits64, 8), validCopies, totalCopies: repeats };
}

async function main() {
  const qrPng = PNG.sync.read(readFileSync('/tmp/test-qr-nomargin.png'));
  const qrImg = { width: qrPng.width, height: qrPng.height, data: new Uint8ClampedArray(qrPng.data) };
  const secret = 'SECRET01';
  const strength = 150;

  console.log('=== BCH t sweep (with shortening for more repeats): real distorted capture ===\n');
  console.log('Testing 3 skew severities x 2 trials each per t, to average out per-pattern jsQR luck\n');

  for (const t of [1, 2, 3, 4, 5, 6, 7, 8]) {
    const encResult = encodeWithT(qrImg, secret, t, strength);
    if (!encResult) {
      console.log(`t=${t}: skipped (k < 32)`);
      continue;
    }
    const { image, code, repeats, unitLen, pad } = encResult;

    let qrDetectedCount = 0;
    let passCount = 0;
    let totalTrials = 0;
    let sumValidCopies = 0;

    for (const skew of [1.0, 1.5, 2.0]) {
      for (const jitter of [-0.03, 0.03]) {
        totalTrials++;
        const warped = distortAndUnwarp(image, skew + jitter);
        if (!warped) continue;
        qrDetectedCount++;
        const dec = decodeWithT(warped, code, repeats, unitLen, pad);
        sumValidCopies += dec.validCopies;
        if (dec.message === secret) passCount++;
      }
    }

    console.log(
      `t=${t} | n=${code.n} k=${code.k} shortN=${code.n - pad} repeats=${repeats} | ` +
        `qrDetected ${qrDetectedCount}/${totalTrials} | decoded correctly ${passCount}/${totalTrials} | ` +
        `avg valid copies ${(sumValidCopies / totalTrials).toFixed(2)}/${repeats}`
    );
  }

  console.log('\n=== Stress test: t=1 (winner) under MUCH harsher distortion severities ===\n');
  const encResult1 = encodeWithT(qrImg, secret, 1, strength);
  if (encResult1) {
    const { image, code, repeats, unitLen, pad } = encResult1;
    for (const skew of [1.0, 2.0, 3.0, 4.0, 5.0, 6.0]) {
      let qrDetectedCount = 0;
      let passCount = 0;
      let totalTrials = 0;
      let sumValidCopies = 0;
      for (const jitter of [-0.05, 0, 0.05]) {
        totalTrials++;
        const warped = distortAndUnwarp(image, skew + jitter);
        if (!warped) continue;
        qrDetectedCount++;
        const dec = decodeWithT(warped, code, repeats, unitLen, pad);
        sumValidCopies += dec.validCopies;
        if (dec.message === secret) passCount++;
      }
      console.log(
        `skew=${skew.toFixed(1)} | qrDetected ${qrDetectedCount}/${totalTrials} | decoded correctly ${passCount}/${totalTrials} | avg valid copies ${(sumValidCopies / totalTrials).toFixed(2)}/${repeats}`
      );
    }
  }

  console.log('\n=== Compare t=1 vs t=5 at higher strength (since t=1 has less error tolerance, does more strength margin help it too?) ===\n');
  for (const strength2 of [100, 150, 200]) {
    const enc1 = encodeWithT(qrImg, secret, 1, strength2);
    const enc5 = encodeWithT(qrImg, secret, 5, strength2);
    if (!enc1 || !enc5) continue;
    let pass1 = 0, pass5 = 0, detected1 = 0, detected5 = 0, trials = 0;
    for (const skew of [1.0, 2.0, 3.0]) {
      trials++;
      const w1 = distortAndUnwarp(enc1.image, skew);
      if (w1) { detected1++; if (decodeWithT(w1, enc1.code, enc1.repeats, enc1.unitLen, enc1.pad).message === secret) pass1++; }
      const w5 = distortAndUnwarp(enc5.image, skew);
      if (w5) { detected5++; if (decodeWithT(w5, enc5.code, enc5.repeats, enc5.unitLen, enc5.pad).message === secret) pass5++; }
    }
    console.log(`strength=${strength2} | t=1: qrDetected ${detected1}/${trials} pass ${pass1}/${trials} | t=5: qrDetected ${detected5}/${trials} pass ${pass5}/${trials}`);
  }
}

main().catch(console.error);
