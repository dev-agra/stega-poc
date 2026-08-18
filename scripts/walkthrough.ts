import { buildQrModules, modulesToCanonicalY, PX_PER_MODULE, COEFF_1, COEFF_2, prepareTxBits } from '../src/lib/marker';
import { dct8x8, embedBitInCoeffs, idct8x8, extractBitFromCoeffs, makeBlock, type Block8 } from '../src/lib/dct';

async function main() {
  const qrText = 'https://example.com/verify/ABC123';
  const secret = 'SECRET01';

  const { size, data, dataModuleIndices } = await buildQrModules(qrText);
  const luma = modulesToCanonicalY(data, size);
  const { txBits } = prepareTxBits(secret, dataModuleIndices.length);

  // Pick the FIRST data module (first non-reserved module in scan order) as our example.
  const exampleIdx = 0;
  const moduleIdx = dataModuleIndices[exampleIdx];
  const row = Math.floor(moduleIdx / size);
  const col = moduleIdx % size;
  const by = row * PX_PER_MODULE;
  const bx = col * PX_PER_MODULE;

  console.log(`Example module: row=${row}, col=${col} (module #${exampleIdx} in scan order among ${dataModuleIndices.length} data modules)`);
  console.log(`Pixel block origin: (${bx}, ${by}) to (${bx + 7}, ${by + 7})`);
  console.log(`Raw QR module value at this position: ${data[moduleIdx]} (1=dark/black, 0=light/white)`);

  const block: Block8 = makeBlock();
  for (let y = 0; y < 8; y++) {
    for (let x = 0; x < 8; x++) {
      block[y][x] = luma[by + y][bx + x];
    }
  }

  console.log('\n--- Step 1: Raw 8x8 luma pixel block (before any embedding) ---');
  for (let y = 0; y < 8; y++) {
    console.log(Array.from(block[y]).map((v) => v.toFixed(0).padStart(4)).join(' '));
  }

  console.log('\n--- Step 2: Forward 2D-DCT of this block ---');
  const F = dct8x8(block);
  for (let y = 0; y < 8; y++) {
    console.log(Array.from(F[y]).map((v) => v.toFixed(1).padStart(8)).join(' '));
  }

  console.log(`\nCoefficient pair used for embedding: (u1,v1)=(${COEFF_1.u},${COEFF_1.v}), (u2,v2)=(${COEFF_2.u},${COEFF_2.v})`);
  console.log(`F(${COEFF_1.u},${COEFF_1.v}) = ${F[COEFF_1.u][COEFF_1.v].toFixed(3)}`);
  console.log(`F(${COEFF_2.u},${COEFF_2.v}) = ${F[COEFF_2.u][COEFF_2.v].toFixed(3)}`);
  console.log(`(These are ~0 because a solid-color QR module has no internal frequency content before embedding)`);

  const bitToEmbed = txBits[exampleIdx] as 0 | 1;
  const strength = 60;
  console.log(`\n--- Step 3: Embed bit=${bitToEmbed} (from the BCH+PRNG-masked stream) with strength α=${strength} ---`);
  const avg = (F[COEFF_1.u][COEFF_1.v] + F[COEFF_2.u][COEFF_2.v]) / 2;
  console.log(`midpoint M = (F1+F2)/2 = ${avg.toFixed(3)}`);
  if (bitToEmbed === 1) {
    console.log(`bit=1 rule: F1' = M + α/2 = ${(avg + strength / 2).toFixed(3)}, F2' = M - α/2 = ${(avg - strength / 2).toFixed(3)}`);
  } else {
    console.log(`bit=0 rule: F1' = M - α/2 = ${(avg - strength / 2).toFixed(3)}, F2' = M + α/2 = ${(avg + strength / 2).toFixed(3)}`);
  }

  const F2 = embedBitInCoeffs(F, bitToEmbed, COEFF_1, COEFF_2, strength);
  console.log('\n--- Step 4: Modified DCT coefficient grid (only 2 of 64 values changed) ---');
  for (let y = 0; y < 8; y++) {
    console.log(Array.from(F2[y]).map((v) => v.toFixed(1).padStart(8)).join(' '));
  }

  console.log('\n--- Step 5: Inverse DCT reconstructs the pixel block ---');
  const newBlock = idct8x8(F2);
  for (let y = 0; y < 8; y++) {
    console.log(Array.from(newBlock[y]).map((v) => v.toFixed(1).padStart(7)).join(' '));
  }

  console.log('\n--- Step 6: Pixel-by-pixel change (delta = new - original) ---');
  for (let y = 0; y < 8; y++) {
    const deltaRow = [];
    for (let x = 0; x < 8; x++) {
      deltaRow.push((newBlock[y][x] - block[y][x]).toFixed(1).padStart(6));
    }
    console.log(deltaRow.join(' '));
  }

  console.log('\n--- Step 7: Decoder side — re-run DCT on the (possibly re-captured) block and compare coefficients ---');
  const Fcheck = dct8x8(newBlock);
  console.log(`F'(${COEFF_1.u},${COEFF_1.v}) = ${Fcheck[COEFF_1.u][COEFF_1.v].toFixed(3)}`);
  console.log(`F'(${COEFF_2.u},${COEFF_2.v}) = ${Fcheck[COEFF_2.u][COEFF_2.v].toFixed(3)}`);
  const extracted = extractBitFromCoeffs(Fcheck, COEFF_1, COEFF_2);
  console.log(`Extracted bit = ${extracted} (rule: F1 > F2 => 1, else 0)`);
  console.log(`Matches embedded bit? ${extracted === bitToEmbed ? 'YES' : 'NO'}`);
}

main().catch(console.error);
