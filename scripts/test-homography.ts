import { warpQuadToSquare, computeHomography, applyHomography, type Point, type RgbaBuffer } from '../src/lib/homography';

function makeCheckerboard(size: number): RgbaBuffer {
  const data = new Uint8ClampedArray(size * size * 4);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const idx = (y * size + x) * 4;
      // 4x4 checker pattern so we can verify orientation/alignment after warp
      const cell = Math.floor(x / (size / 4)) + Math.floor(y / (size / 4));
      const v = cell % 2 === 0 ? 255 : 0;
      data[idx] = v;
      data[idx + 1] = v;
      data[idx + 2] = v;
      data[idx + 3] = 255;
    }
  }
  return { width: size, height: size, data };
}

function main() {
  console.log('=== Test 1: identity warp (axis-aligned quad = same square) ===');
  const img = makeCheckerboard(200);
  const identityQuad: Point[] = [
    { x: 0, y: 0 },
    { x: 199, y: 0 },
    { x: 199, y: 199 },
    { x: 0, y: 199 },
  ];
  const warped = warpQuadToSquare(img, identityQuad, 200);
  let maxDiff = 0;
  for (let i = 0; i < img.data.length; i++) {
    maxDiff = Math.max(maxDiff, Math.abs(img.data[i] - warped.data[i]));
  }
  console.log(`Max pixel diff after identity warp: ${maxDiff} (should be ~0)`);

  console.log('\n=== Test 2: perspective-distorted quad -> should unwarp back to clean checkerboard ===');
  // Simulate a checkerboard photographed at an angle: the quad in the "photo"
  // (source) is skewed/perspective-shrunk on one side.
  const distortedSrcQuad: Point[] = [
    { x: 20, y: 10 },   // top-left pulled in
    { x: 210, y: 30 },  // top-right pulled in less
    { x: 230, y: 220 }, // bottom-right pushed out
    { x: 5, y: 200 },   // bottom-left pushed out
  ];

  // Build a "photographed" image: take the clean checkerboard and forward-warp
  // it INTO this distorted quad on a blank canvas, simulating a camera capture.
  const canvasSize = 260;
  const blank: RgbaBuffer = { width: canvasSize, height: canvasSize, data: new Uint8ClampedArray(canvasSize * canvasSize * 4) };
  const cleanQuad: Point[] = [
    { x: 0, y: 0 },
    { x: 199, y: 0 },
    { x: 199, y: 199 },
    { x: 0, y: 199 },
  ];
  // forward map: for each dest (distorted) pixel, sample from clean image via inverse of (clean->distorted)
  const Hforward = computeHomography(cleanQuad, distortedSrcQuad); // clean -> distorted
  const Hback = computeHomography(distortedSrcQuad, cleanQuad); // distorted -> clean (for sampling)
  void Hforward;
  for (let y = 0; y < canvasSize; y++) {
    for (let x = 0; x < canvasSize; x++) {
      const cp = applyHomography(Hback, { x, y }); // where in clean image does this "photo" pixel come from
      if (cp.x >= 0 && cp.x < 199 && cp.y >= 0 && cp.y < 199) {
        const cx = Math.round(cp.x);
        const cy = Math.round(cp.y);
        const srcIdx = (cy * 200 + cx) * 4;
        const dstIdx = (y * canvasSize + x) * 4;
        blank.data[dstIdx] = img.data[srcIdx];
        blank.data[dstIdx + 1] = img.data[srcIdx + 1];
        blank.data[dstIdx + 2] = img.data[srcIdx + 2];
        blank.data[dstIdx + 3] = 255;
      }
    }
  }

  // Now use OUR function to unwarp: given the "photographed" quad corners, recover a clean square.
  const recovered = warpQuadToSquare(blank, distortedSrcQuad, 200);

  let sumDiff = 0;
  let count = 0;
  for (let y = 20; y < 180; y++) {
    for (let x = 20; x < 180; x++) {
      const idx = (y * 200 + x) * 4;
      sumDiff += Math.abs(recovered.data[idx] - img.data[idx]);
      count++;
    }
  }
  console.log(`Mean abs pixel diff (recovered vs original, center region): ${(sumDiff / count).toFixed(2)} (should be small, <20)`);

  // spot check a specific known-white cell vs known-black cell
  const whiteCellIdx = (50 * 200 + 50) * 4; // should be in a white cell (top-left 4x4 checker, cell (0,0) -> white since cell%2==0)
  const blackCellIdx = (50 * 200 + 150) * 4; // cell (2,0)? let's just check contrast exists
  console.log('Recovered pixel A (expect near 255 or 0, matching original):', recovered.data[whiteCellIdx], 'original:', img.data[whiteCellIdx]);
  console.log('Recovered pixel B:', recovered.data[blackCellIdx], 'original:', img.data[blackCellIdx]);
}

main();
