import { PNG } from 'pngjs';
import { readFileSync } from 'fs';
import { encodeImage, decodeImage, type RgbaImage, type CodecKind } from '../src/lib/imageStego';
import { warpQuadToSquare, computeHomography, applyHomography, type Point } from '../src/lib/homography';
import jsQR from 'jsqr';

function pngToRgba(png: PNG): RgbaImage {
  return { width: png.width, height: png.height, data: new Uint8ClampedArray(png.data) };
}

function distortAndDetect(
  enc: { image: RgbaImage },
  qrWidth: number,
  skewFactor: number
): { canvas: RgbaImage; detected: ReturnType<typeof jsQR> } {
  const canvasSize = Math.round(qrWidth * (1 + 0.6 * skewFactor));
  const canvas: RgbaImage = {
    width: canvasSize,
    height: canvasSize,
    data: new Uint8ClampedArray(canvasSize * canvasSize * 4).fill(200),
  };
  const distortedQuad: Point[] = [
    { x: 60 * skewFactor, y: 40 * skewFactor },
    { x: canvasSize - 30 * skewFactor, y: 70 * skewFactor },
    { x: canvasSize - 60 * skewFactor, y: canvasSize - 50 * skewFactor },
    { x: 40 * skewFactor, y: canvasSize - 30 * skewFactor },
  ];
  const cleanQuad: Point[] = [
    { x: 0, y: 0 },
    { x: enc.image.width - 1, y: 0 },
    { x: enc.image.width - 1, y: enc.image.height - 1 },
    { x: 0, y: enc.image.height - 1 },
  ];
  const Hback = computeHomography(distortedQuad, cleanQuad);
  for (let y = 0; y < canvasSize; y++) {
    for (let x = 0; x < canvasSize; x++) {
      const sp = applyHomography(Hback, { x, y });
      if (sp.x >= 0 && sp.x < enc.image.width - 1 && sp.y >= 0 && sp.y < enc.image.height - 1) {
        const sx = Math.round(sp.x);
        const sy = Math.round(sp.y);
        const srcIdx = (sy * enc.image.width + sx) * 4;
        const dstIdx = (y * canvasSize + x) * 4;
        canvas.data[dstIdx] = enc.image.data[srcIdx];
        canvas.data[dstIdx + 1] = enc.image.data[srcIdx + 1];
        canvas.data[dstIdx + 2] = enc.image.data[srcIdx + 2];
        canvas.data[dstIdx + 3] = 255;
      }
    }
  }
  const detected = jsQR(canvas.data, canvas.width, canvas.height);
  return { canvas, detected };
}

function runOne(codec: CodecKind, strength: number, secret: string, qrImg: RgbaImage, skewFactor: number, interleave: boolean) {
  const enc = encodeImage(qrImg, secret, { strength, codec, interleave });
  const { canvas, detected } = distortAndDetect(enc, qrImg.width, skewFactor);
  if (!detected) return { qrDetected: false, ok: false, validCopies: 0, totalCopies: 0 };

  const { topLeftCorner, topRightCorner, bottomRightCorner, bottomLeftCorner } = detected.location;
  const warped = warpQuadToSquare(canvas, [topLeftCorner, topRightCorner, bottomRightCorner, bottomLeftCorner], 320);
  const dec = decodeImage(warped, { codec, interleave });
  return { qrDetected: true, ok: dec.message === secret, validCopies: dec.validCopies, totalCopies: dec.totalCopies };
}

async function main() {
  const qrPng = PNG.sync.read(readFileSync('/tmp/test-qr-nomargin.png'));
  const qrImg = pngToRgba(qrPng);
  const secret = 'SECRET01';

  // Step 1: find a strength where jsQR reliably detects post-distortion for BOTH codecs,
  // at the baseline skew=1.0 severity, before comparing anything else.
  console.log('=== Step 1: find max strength where QR still detects after distortion ===\n');
  for (const strength of [50, 100, 150, 200, 300]) {
    const bch = runOne('bch', strength, secret, qrImg, 1.0, false);
    const rs = runOne('rs', strength, secret, qrImg, 1.0, false);
    console.log(
      `strength=${strength.toString().padStart(3)} | BCH qrDetected=${bch.qrDetected} decode=${bch.ok} (${bch.validCopies}/${bch.totalCopies}) | RS qrDetected=${rs.qrDetected} decode=${rs.ok} (${rs.validCopies}/${rs.totalCopies})`
    );
  }

  console.log('\n=== Step 2: SAME test, but WITH interleaving enabled ===\n');
  for (const strength of [50, 100, 150, 200, 300]) {
    const bch = runOne('bch', strength, secret, qrImg, 1.0, true);
    const rs = runOne('rs', strength, secret, qrImg, 1.0, true);
    console.log(
      `strength=${strength.toString().padStart(3)} | BCH qrDetected=${bch.qrDetected} decode=${bch.ok} (${bch.validCopies}/${bch.totalCopies}) | RS qrDetected=${rs.qrDetected} decode=${rs.ok} (${rs.validCopies}/${rs.totalCopies})`
    );
  }

  console.log('\n=== Step 3: distortion severity sweep, strength=100, WITH interleaving, 3 trials each ===\n');
  const strength = 100;
  for (const skewFactor of [1.0, 1.3, 1.6, 2.0, 2.4]) {
    const bchRuns: ReturnType<typeof runOne>[] = [];
    const rsRuns: ReturnType<typeof runOne>[] = [];
    for (let trial = 0; trial < 3; trial++) {
      const jitter = skewFactor + (trial - 1) * 0.02;
      bchRuns.push(runOne('bch', strength, secret, qrImg, jitter, true));
      rsRuns.push(runOne('rs', strength, secret, qrImg, jitter, true));
    }
    const summarize = (runs: ReturnType<typeof runOne>[]) => {
      const detected = runs.filter((r) => r.qrDetected).length;
      const passed = runs.filter((r) => r.ok).length;
      const avgValid = runs.reduce((s, r) => s + r.validCopies, 0) / runs.length;
      const avgTotal = runs.reduce((s, r) => s + r.totalCopies, 0) / runs.length;
      return `qrDetected ${detected}/3, decoded correctly ${passed}/3, avg valid copies ${avgValid.toFixed(1)}/${avgTotal.toFixed(1)}`;
    };
    console.log(`skew=${skewFactor.toFixed(1)}`);
    console.log(`  BCH: ${summarize(bchRuns)}`);
    console.log(`  RS:  ${summarize(rsRuns)}`);
  }
}

main().catch(console.error);
