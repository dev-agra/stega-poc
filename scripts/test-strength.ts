import { encodeMarker, decodeMarker } from '../src/lib/marker';
import jsQR from 'jsqr';

function toRgba(luma: Float64Array[], size: number): Uint8ClampedArray {
  const rgba = new Uint8ClampedArray(size * size * 4);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const v = Math.round(luma[y][x]);
      const idx = (y * size + x) * 4;
      rgba[idx] = v;
      rgba[idx + 1] = v;
      rgba[idx + 2] = v;
      rgba[idx + 3] = 255;
    }
  }
  return rgba;
}

async function main() {
  const qrText = 'https://example.com/verify/ABC123';
  const secret = 'SECRET01';

  console.log('=== Strength sweep: QR scannability + message decode ===');
  for (const strength of [10, 20, 40, 60, 80, 100, 150, 200, 300, 500]) {
    const enc = await encodeMarker(qrText, secret, strength);
    const rgba = toRgba(enc.luma, enc.canonicalSize);
    const scan = jsQR(rgba, enc.canonicalSize, enc.canonicalSize);
    const dec = await decodeMarker(enc.luma, enc.moduleSize);
    console.log(
      `strength=${strength.toString().padStart(4)} | QR scan: ${scan ? 'OK ' : 'FAIL'} (text match: ${
        scan ? scan.data === qrText : 'n/a'
      }) | secret decode: ${dec.message === secret ? 'OK' : 'FAIL'} (valid ${dec.validCopies}/${dec.totalCopies})`
    );
  }

  console.log('\n=== Robustness: inject random luma noise post-embedding, strength=60 ===');
  const enc60 = await encodeMarker(qrText, secret, 60);
  for (const noiseAmp of [0, 5, 10, 20, 30, 40]) {
    const noisyLuma = enc60.luma.map((row) =>
      Float64Array.from(row, (v) => Math.min(255, Math.max(0, v + (Math.random() * 2 - 1) * noiseAmp)))
    );
    const dec = await decodeMarker(noisyLuma, enc60.moduleSize);
    console.log(
      `noiseAmp=±${noiseAmp.toString().padStart(2)} | decode: ${JSON.stringify(dec.message)} | valid ${dec.validCopies}/${dec.totalCopies} | bitErrorsCorrected=${dec.totalBitErrorsCorrected}`
    );
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
