// Computes a projective homography mapping 4 source points -> 4 destination
// points (or vice versa), and uses it to warp an arbitrary quadrilateral
// region of an image back to a clean square via inverse-mapped bilinear
// sampling. Used to unwarp a QR code detected at an angle/perspective by a
// camera back to a straight-on canonical square before DCT decoding.

export interface Point {
  x: number;
  y: number;
}

export type Mat3 = number[]; // row-major, length 9

/** Solve the 8x8 linear system for a homography mapping src[i] -> dst[i], i=0..3. */
export function computeHomography(src: Point[], dst: Point[]): Mat3 {
  if (src.length !== 4 || dst.length !== 4) {
    throw new Error('computeHomography needs exactly 4 point correspondences');
  }

  // Build the 8x9 augmented matrix for: h = [a,b,c,d,e,f,g,h,1]
  // dst.x = (a*src.x + b*src.y + c) / (g*src.x + h*src.y + 1)
  // dst.y = (d*src.x + e*src.y + f) / (g*src.x + h*src.y + 1)
  const A: number[][] = [];
  const B: number[] = [];

  for (let i = 0; i < 4; i++) {
    const { x: sx, y: sy } = src[i];
    const { x: dx, y: dy } = dst[i];
    A.push([sx, sy, 1, 0, 0, 0, -dx * sx, -dx * sy]);
    B.push(dx);
    A.push([0, 0, 0, sx, sy, 1, -dy * sx, -dy * sy]);
    B.push(dy);
  }

  const h = solveLinearSystem(A, B); // length 8: [a,b,c,d,e,f,g,h]
  return [h[0], h[1], h[2], h[3], h[4], h[5], h[6], h[7], 1];
}

/** Gaussian elimination with partial pivoting, for an n x n system. */
function solveLinearSystem(A: number[][], B: number[]): number[] {
  const n = A.length;
  const M = A.map((row, i) => [...row, B[i]]);

  for (let col = 0; col < n; col++) {
    let pivotRow = col;
    let maxVal = Math.abs(M[col][col]);
    for (let r = col + 1; r < n; r++) {
      if (Math.abs(M[r][col]) > maxVal) {
        maxVal = Math.abs(M[r][col]);
        pivotRow = r;
      }
    }
    if (pivotRow !== col) {
      [M[col], M[pivotRow]] = [M[pivotRow], M[col]];
    }
    const pivot = M[col][col];
    if (Math.abs(pivot) < 1e-12) continue; // singular-ish; leave as best effort
    for (let r = 0; r < n; r++) {
      if (r === col) continue;
      const factor = M[r][col] / pivot;
      for (let c = col; c <= n; c++) {
        M[r][c] -= factor * M[col][c];
      }
    }
  }

  return M.map((row, i) => row[n] / row[i]);
}

/** Apply homography H to a point. */
export function applyHomography(H: Mat3, p: Point): Point {
  const w = H[6] * p.x + H[7] * p.y + H[8];
  return {
    x: (H[0] * p.x + H[1] * p.y + H[2]) / w,
    y: (H[3] * p.x + H[4] * p.y + H[5]) / w,
  };
}

export interface RgbaBuffer {
  width: number;
  height: number;
  data: Uint8ClampedArray;
}

/**
 * Warp the quadrilateral region `srcQuad` (4 corners in the SOURCE image,
 * order: top-left, top-right, bottom-right, bottom-left) into an
 * `outSize x outSize` square output image, via inverse mapping + bilinear
 * sampling (so every output pixel is filled, no holes).
 */
export function warpQuadToSquare(src: RgbaBuffer, srcQuad: Point[], outSize: number): RgbaBuffer {
  const dstQuad: Point[] = [
    { x: 0, y: 0 },
    { x: outSize - 1, y: 0 },
    { x: outSize - 1, y: outSize - 1 },
    { x: 0, y: outSize - 1 },
  ];

  // We need dst -> src mapping for inverse sampling, so compute homography dst->src directly.
  const Hinv = computeHomography(dstQuad, srcQuad);

  const out = new Uint8ClampedArray(outSize * outSize * 4);

  for (let dy = 0; dy < outSize; dy++) {
    for (let dx = 0; dx < outSize; dx++) {
      const sp = applyHomography(Hinv, { x: dx, y: dy });
      const { r, g, b, a } = sampleBilinear(src, sp.x, sp.y);
      const idx = (dy * outSize + dx) * 4;
      out[idx] = r;
      out[idx + 1] = g;
      out[idx + 2] = b;
      out[idx + 3] = a;
    }
  }

  return { width: outSize, height: outSize, data: out };
}

function sampleBilinear(src: RgbaBuffer, x: number, y: number): { r: number; g: number; b: number; a: number } {
  const x0 = Math.floor(x);
  const y0 = Math.floor(y);
  const x1 = x0 + 1;
  const y1 = y0 + 1;
  const fx = x - x0;
  const fy = y - y0;

  const clampX = (v: number) => Math.min(src.width - 1, Math.max(0, v));
  const clampY = (v: number) => Math.min(src.height - 1, Math.max(0, v));

  const get = (xx: number, yy: number, channel: number) => {
    const idx = (clampY(yy) * src.width + clampX(xx)) * 4 + channel;
    return src.data[idx];
  };

  function bilerp(channel: number): number {
    const v00 = get(x0, y0, channel);
    const v01 = get(x1, y0, channel);
    const v10 = get(x0, y1, channel);
    const v11 = get(x1, y1, channel);
    const top = v00 * (1 - fx) + v01 * fx;
    const bottom = v10 * (1 - fx) + v11 * fx;
    return top * (1 - fy) + bottom * fy;
  }

  return { r: bilerp(0), g: bilerp(1), b: bilerp(2), a: bilerp(3) };
}
