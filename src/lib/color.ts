// Standard (BT.601 / JPEG-style) RGB <-> YCbCr conversion, operating on
// separate flat R/G/B Float64Array channels.

export interface YCbCr {
  Y: Float64Array;
  Cb: Float64Array;
  Cr: Float64Array;
}

export function rgbToYCbCr(R: Float64Array, G: Float64Array, B: Float64Array): YCbCr {
  const n = R.length;
  const Y = new Float64Array(n);
  const Cb = new Float64Array(n);
  const Cr = new Float64Array(n);
  for (let i = 0; i < n; i++) {
    const r = R[i];
    const g = G[i];
    const b = B[i];
    Y[i] = 0.299 * r + 0.587 * g + 0.114 * b;
    Cb[i] = 128 - 0.168736 * r - 0.331264 * g + 0.5 * b;
    Cr[i] = 128 + 0.5 * r - 0.418688 * g - 0.081312 * b;
  }
  return { Y, Cb, Cr };
}

export function ycbcrToRgb(Y: Float64Array, Cb: Float64Array, Cr: Float64Array): {
  R: Float64Array;
  G: Float64Array;
  B: Float64Array;
} {
  const n = Y.length;
  const R = new Float64Array(n);
  const G = new Float64Array(n);
  const B = new Float64Array(n);
  for (let i = 0; i < n; i++) {
    const y = Y[i];
    const cb = Cb[i] - 128;
    const cr = Cr[i] - 128;
    R[i] = y + 1.402 * cr;
    G[i] = y - 0.344136 * cb - 0.714136 * cr;
    B[i] = y + 1.772 * cb;
  }
  return { R, G, B };
}
