import { parseBulkCsv } from '../src/lib/bulkEncode';
import { encodeImage } from '../src/lib/imageStego';
import JSZip from 'jszip';

function makeTestImage(w: number, h: number) {
  const data = new Uint8ClampedArray(w * h * 4);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const i = (y * w + x) * 4;
    data[i] = Math.round((x / w) * 255); data[i + 1] = Math.round((y / h) * 255); data[i + 2] = 128; data[i + 3] = 255;
  }
  return { width: w, height: h, data };
}

async function main() {
  const csv = `C1,C2,Strength
2x3,3x4,120
1x3,3x1,80
0x1,1x0,200
`;
  const { rows, errors } = parseBulkCsv(csv);
  console.log('parsed', rows.length, 'rows, errors:', errors);

  const img = makeTestImage(256, 256);
  const zip = new JSZip();
  for (const row of rows) {
    const result = encodeImage(img, 'SECRET01', { strength: row.strength, seed: 1592639710, coeff1: row.coeff1, coeff2: row.coeff2 });
    console.log('row', row.rowNumber, '-> bitsEmbedded', result.stats.bitsEmbedded, 'strength', result.stats.strength);
    zip.file('test-row-' + row.rowNumber + '.bin', new Uint8Array(result.image.data));
  }
  const blob = await zip.generateAsync({ type: 'nodebuffer' });
  console.log('zip size:', blob.length, 'bytes, contains', Object.keys(zip.files).length, 'files');
}

main();
