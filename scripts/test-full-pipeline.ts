import { PNG } from 'pngjs';
import { readFileSync, writeFileSync } from 'fs';
import { encodeImage, decodeImage, type RgbaImage } from '../src/lib/imageStego';
import { warpQuadToSquare, type Point } from '../src/lib/homography';
import jsQR from 'jsqr';

function pngToRgba(png: PNG): RgbaImage {
  return { width: png.width, height: png.height, data: new Uint8ClampedArray(png.data) };
}

function rgbaToPng(img: RgbaImage): PNG {
  const png = new PNG({ width: img.width, height: img.height });
  png.data = Buffer.from(img.data);
  return png;
}

async function main() {
  const qrPng = PNG.sync.read(readFileSync('/tmp/test-qr-nomargin.png'));
  const qrImg = pngToRgba(qrPng);
  console.log(`Loaded real QR PNG: ${qrImg.width}x${qrImg.height}`);

  const secret = 'SECRET01';
  const enc = encodeImage(qrImg, secret, { strength: 150 });
  console.log(`Encoded. Output ${enc.image.width}x${enc.image.height}, stats:`, enc.stats);
  writeFileSync('/tmp/test-qr-stego.png', PNG.sync.write(rgbaToPng(enc.image)));

  console.log('\n--- Direct decode (no distortion, simulating "upload" path) ---');
  const decDirect = decodeImage(enc.image);
  console.log('Decoded:', JSON.stringify(decDirect.message), `valid ${decDirect.validCopies}/${decDirect.totalCopies}`);

  console.log('\n--- Confirm QR itself still scans on the encoded image ---');
  const qrResult = jsQR(enc.image.data, enc.image.width, enc.image.height);
  console.log('QR scan:', qrResult ? qrResult.data : 'FAILED');

  console.log('\n--- Simulated camera capture: place the stego QR at a perspective angle on a larger canvas ---');
  const canvasSize = Math.round(enc.image.width * 1.6);
  const canvas: RgbaImage = {
    width: canvasSize,
    height: canvasSize,
    data: new Uint8ClampedArray(canvasSize * canvasSize * 4).fill(200), // grey background
  };
  // paste the stego QR into a skewed quad on the canvas (simulate off-angle photo)
  const distortedQuad: Point[] = [
    { x: 60, y: 40 },
    { x: canvasSize - 30, y: 70 },
    { x: canvasSize - 60, y: canvasSize - 50 },
    { x: 40, y: canvasSize - 30 },
  ];
  // forward-map: for each canvas pixel inside the quad, sample from the stego image via inverse mapping
  const { computeHomography, applyHomography } = await import('../src/lib/homography');
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
  writeFileSync('/tmp/test-qr-camera-sim.png', PNG.sync.write(rgbaToPng(canvas)));

  console.log('Running jsQR on the simulated off-angle capture to detect corners...');
  const detected = jsQR(canvas.data, canvas.width, canvas.height);
  if (!detected) {
    console.log('jsQR FAILED to detect the QR in the simulated capture.');
    return;
  }
  console.log('jsQR detected QR, visible text:', detected.data);
  console.log('Corners:', detected.location);

  const { topLeftCorner, topRightCorner, bottomRightCorner, bottomLeftCorner } = detected.location;
  const warped = warpQuadToSquare(canvas, [topLeftCorner, topRightCorner, bottomRightCorner, bottomLeftCorner], 320);
  writeFileSync('/tmp/test-qr-camera-warped.png', PNG.sync.write(rgbaToPng(warped)));

  console.log('\n--- Decoding the homography-corrected (unwarped) region ---');
  const decWarped = decodeImage(warped);
  console.log('Decoded:', JSON.stringify(decWarped.message), `valid ${decWarped.validCopies}/${decWarped.totalCopies}`);
  console.log('MATCH:', decWarped.message === secret ? 'YES — full pipeline works end to end' : 'NO');
}

main().catch(console.error);
