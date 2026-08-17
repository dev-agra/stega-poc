import { encodeMarker, decodeMarker, PX_PER_MODULE } from '../src/lib/marker';
import jsQR from 'jsqr';

async function main() {
  const qrText = 'https://example.com/verify/ABC123';
  const secret = 'SECRET01';

  console.log('Encoding...');
  const enc = await encodeMarker(qrText, secret, 40);
  console.log('Encode stats:', enc.stats, 'canonicalSize:', enc.canonicalSize);

  console.log('\nDecoding (no distortion)...');
  const dec = await decodeMarker(enc.luma, enc.moduleSize);
  console.log('Decoded message:', JSON.stringify(dec.message));
  console.log(
    `Valid copies: ${dec.validCopies}/${dec.totalCopies}, bit errors corrected: ${dec.totalBitErrorsCorrected}`
  );
  console.log('MATCH:', dec.message === secret ? 'YES' : 'NO');

  // Build an RGBA buffer from luma for jsQR scannability check
  const size = enc.canonicalSize;
  const rgba = new Uint8ClampedArray(size * size * 4);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const v = Math.round(enc.luma[y][x]);
      const idx = (y * size + x) * 4;
      rgba[idx] = v;
      rgba[idx + 1] = v;
      rgba[idx + 2] = v;
      rgba[idx + 3] = 255;
    }
  }
  console.log('\nChecking QR scannability with jsQR after watermark embedding...');
  const result = jsQR(rgba, size, size);
  if (result) {
    console.log('QR SCAN OK. Decoded text:', result.data);
    console.log('MATCH original text:', result.data === qrText ? 'YES' : 'NO');
  } else {
    console.log('QR SCAN FAILED — watermark strength likely too high, or jsQR needs a quiet zone border.');
  }

  // Test with a garbage (non-watermarked) image -> should reject
  console.log('\nSanity check: decoding a plain (non-watermarked) QR of the same text...');
  const plainSize = enc.moduleSize * PX_PER_MODULE;
  const plainLuma: Float64Array[] = Array.from({ length: plainSize }, () => new Float64Array(plainSize));
  // just reuse the pre-embedding pattern via encodeMarker with strength 0
  const encPlain = await encodeMarker(qrText, secret, 0);
  const decPlain = await decodeMarker(encPlain.luma, encPlain.moduleSize);
  console.log('Strength=0 decode result:', JSON.stringify(decPlain.message), `validCopies=${decPlain.validCopies}/${decPlain.totalCopies}`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
