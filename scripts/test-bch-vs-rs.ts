import { PNG } from 'pngjs';
import { readFileSync, writeFileSync } from 'fs';
import { encodeImage, decodeImage, type RgbaImage, type CodecKind } from '../src/lib/imageStego';
import { warpQuadToSquare, computeHomography, applyHomography, type Point } from '../src/lib/homography';
import jsQR from 'jsqr';

function pngToRgba(png: PNG): RgbaImage {
  return { width: png.width, height: png.height, data: new Uint8ClampedArray(png.data) };
}
function rgbaToPng(img: RgbaImage): PNG {
  const png = new PNG({ width: img.width, height: img.height });
  png.data = Buffer.from(img.data);
  return png;
}

function runScenario(codec: CodecKind, strength: number, secret: string, qrImg: RgbaImage) {
  const enc = encodeImage(qrImg, secret, { strength, codec });

  const canvasSize = Math.round(enc.image.width * 1.6);
  const canvas: RgbaImage = {
    width: canvasSize,
    height: canvasSize,
    data: new Uint8ClampedArray(canvasSize * canvasSize * 4).fill(200),
  };
  const distortedQuad: Point[] = [
    { x: 60, y: 40 },
    { x: canvasSize - 30, y: 70 },
    { x: canvasSize - 60, y: canvasSize - 50 },
    { x: 40, y: canvasSize - 30 },
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
  if (!detected) {
    console.log(`    [debug] jsQR failed to detect for codec=${codec} strength=${strength}`);
    return { ok: false, reason: 'jsQR failed to detect', validCopies: 0, totalCopies: 0 };
  }

  const { topLeftCorner, topRightCorner, bottomRightCorner, bottomLeftCorner } = detected.location;
  const warped = warpQuadToSquare(canvas, [topLeftCorner, topRightCorner, bottomRightCorner, bottomLeftCorner], 320);

  const dec = decodeImage(warped, { codec });
  return {
    ok: dec.message === secret,
    message: dec.message,
    validCopies: dec.validCopies,
    totalCopies: dec.totalCopies,
    errorsCorrected: dec.totalBitErrorsCorrected,
  };
}

async function main() {
  const qrPng = PNG.sync.read(readFileSync('/tmp/test-qr-nomargin.png'));
  const qrImg = pngToRgba(qrPng);
  const secret = 'SECRET01';

  console.log('=== A/B: BCH vs RS under identical perspective-distortion scenario ===\n');

  for (const strength of [150, 300, 600]) {
    console.log(`--- strength=${strength} ---`);
    const bchResult = runScenario('bch', strength, secret, qrImg);
    console.log(
      `BCH: ${bchResult.ok ? 'PASS' : 'FAIL'} | decoded=${JSON.stringify(bchResult.message)} | valid copies ${bchResult.validCopies}/${bchResult.totalCopies}`
    );
    const rsResult = runScenario('rs', strength, secret, qrImg);
    console.log(
      `RS:  ${rsResult.ok ? 'PASS' : 'FAIL'} | decoded=${JSON.stringify(rsResult.message)} | valid copies ${rsResult.validCopies}/${rsResult.totalCopies}`
    );
    console.log();
  }

  // Run the identical strength=150 case multiple times isn't meaningful since
  // the distortion here is deterministic (fixed quad), so instead sweep a
  // range of distortion severities by scaling how aggressive the quad skew is.
  console.log('=== Distortion severity sweep at strength=200 ===\n');
  for (const skewFactor of [1.0, 1.3, 1.6, 2.0]) {
    const w = qrImg.width;
    const canvasSize = Math.round(w * (1 + 0.6 * skewFactor));
    const distortedQuad: Point[] = [
      { x: 60 * skewFactor, y: 40 * skewFactor },
      { x: canvasSize - 30 * skewFactor, y: 70 * skewFactor },
      { x: canvasSize - 60 * skewFactor, y: canvasSize - 50 * skewFactor },
      { x: 40 * skewFactor, y: canvasSize - 30 * skewFactor },
    ];

    function runWithQuad(codec: CodecKind, strength: number) {
      const enc = encodeImage(qrImg, secret, { strength, codec });
      const canvas: RgbaImage = {
        width: canvasSize,
        height: canvasSize,
        data: new Uint8ClampedArray(canvasSize * canvasSize * 4).fill(200),
      };
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
      if (!detected) return { ok: false, validCopies: 0, totalCopies: 0, message: null };
      const { topLeftCorner, topRightCorner, bottomRightCorner, bottomLeftCorner } = detected.location;
      const warped = warpQuadToSquare(canvas, [topLeftCorner, topRightCorner, bottomRightCorner, bottomLeftCorner], 320);
      const dec = decodeImage(warped, { codec });
      return { ok: dec.message === secret, validCopies: dec.validCopies, totalCopies: dec.totalCopies, message: dec.message };
    }

    const bchR = runWithQuad('bch', 200);
    const rsR = runWithQuad('rs', 200);
    console.log(
      `skew=${skewFactor.toFixed(1)} | BCH: ${bchR.ok ? 'PASS' : 'FAIL'} (${bchR.validCopies}/${bchR.totalCopies})  |  RS: ${rsR.ok ? 'PASS' : 'FAIL'} (${rsR.validCopies}/${rsR.totalCopies})`
    );
  }

  writeFileSync('/tmp/dummy.png', PNG.sync.write(rgbaToPng(qrImg))); // keep pngjs import used
}

main().catch(console.error);
