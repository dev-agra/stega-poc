import { encodeImage, decodeImage, type RgbaImage } from '../src/lib/imageStego';

function makeTestImage(width: number, height: number): RgbaImage {
  // synthetic photo-like gradient + noise, not flat, to be realistic
  const data = new Uint8ClampedArray(width * height * 4);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const i = (y * width + x) * 4;
      data[i] = Math.round((x / width) * 255);
      data[i + 1] = Math.round((y / height) * 255);
      data[i + 2] = Math.round(128 + 64 * Math.sin(x / 10) * Math.cos(y / 10));
      data[i + 3] = 255;
    }
  }
  return { width, height, data };
}

async function main() {
  const secret = 'SECRET01';

  console.log('=== Resolution independence test ===');
  for (const [w, h] of [[256, 256], [512, 512], [1024, 768], [100, 100], [800, 450]]) {
    const img = makeTestImage(w, h);
    const enc = encodeImage(img, secret, { strength: 150 });
    console.log(`Input ${w}x${h} -> output ${enc.image.width}x${enc.image.height}, repeats=${enc.stats.repeats}`);
    if (enc.image.width !== w || enc.image.height !== h) {
      console.log('  !! RESOLUTION MISMATCH');
    }
    const dec = decodeImage(enc.image);
    console.log(`  decoded: ${JSON.stringify(dec.message)} valid=${dec.validCopies}/${dec.totalCopies} match=${dec.message === secret}`);
  }

  console.log('\n=== Strength sweep (512x512) ===');
  for (const strength of [10, 50, 120, 300, 600, 1000, 2000]) {
    const img = makeTestImage(512, 512);
    const enc = encodeImage(img, secret, { strength });
    const dec = decodeImage(enc.image);
    // measure visible distortion (mean abs diff)
    let sumDiff = 0;
    for (let i = 0; i < img.data.length; i += 4) {
      sumDiff += Math.abs(img.data[i] - enc.image.data[i]);
      sumDiff += Math.abs(img.data[i + 1] - enc.image.data[i + 1]);
      sumDiff += Math.abs(img.data[i + 2] - enc.image.data[i + 2]);
    }
    const meanAbsDiff = sumDiff / (512 * 512 * 3);
    console.log(
      `strength=${strength.toString().padStart(4)} | decoded=${JSON.stringify(dec.message)} match=${dec.message === secret} | mean|Δpixel|=${meanAbsDiff.toFixed(3)}`
    );
  }

  console.log('\n=== Wrong seed should fail to decode ===');
  const img = makeTestImage(400, 400);
  const enc = encodeImage(img, secret, { strength: 150, seed: 111 });
  const decWrongSeed = decodeImage(enc.image, { seed: 222 });
  const decRightSeed = decodeImage(enc.image, { seed: 111 });
  console.log('wrong seed ->', JSON.stringify(decWrongSeed.message), `(valid ${decWrongSeed.validCopies}/${decWrongSeed.totalCopies})`);
  console.log('right seed ->', JSON.stringify(decRightSeed.message), `(valid ${decRightSeed.validCopies}/${decRightSeed.totalCopies})`);

  console.log('\n=== No watermark (strength=0) should be rejected ===');
  const encPlain = encodeImage(img, secret, { strength: 0 });
  const decPlain = decodeImage(encPlain.image);
  console.log('strength=0 ->', JSON.stringify(decPlain.message), `(valid ${decPlain.validCopies}/${decPlain.totalCopies})`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
