/**
 * Standalone helper — NOT part of the Next.js app UI.
 *
 * For this POC, QR generation lives outside the app: use this script (or any
 * QR generator you like) to produce a plain, un-watermarked QR code PNG.
 * Then:
 *   1. Upload that PNG to /encode, embed your 8-char secret, download the result.
 *   2. Print the downloaded PNG.
 *   3. Open /decode, set the same seed/coefficient pair, choose "Scan with
 *      Camera", and point your phone at the printed page.
 *
 * Usage: npx tsx scripts/generate-test-qr.ts "https://example.com" out.png
 */
import QRCode from 'qrcode';
import { writeFileSync } from 'fs';

async function main() {
  const text = process.argv[2] ?? 'https://example.com/verify/ABC123';
  const outPath = process.argv[3] ?? 'test-qr.png';

  const buffer = await QRCode.toBuffer(text, {
    errorCorrectionLevel: 'M',
    width: 512,
    margin: 4,
  });

  writeFileSync(outPath, buffer);
  console.log(`Wrote ${outPath} encoding "${text}"`);
  console.log('Upload this into /encode as the target image, then print the encoded output for camera testing.');
}

main().catch(console.error);
