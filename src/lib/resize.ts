// Pure-JS bilinear resize on a flat row-major Float64Array grid.
// Used for both downsampling an arbitrary-resolution image to the 256x256
// canonical grid, and upscaling the residual delta map back to native
// resolution. Deliberately not canvas-based so it's identical (and testable)
// in Node and the browser.

export function resizeBilinear(
  src: Float64Array,
  srcW: number,
  srcH: number,
  dstW: number,
  dstH: number
): Float64Array {
  const dst = new Float64Array(dstW * dstH);

  if (srcW === 1 && srcH === 1) {
    dst.fill(src[0]);
    return dst;
  }

  const scaleX = srcW > 1 ? (srcW - 1) / Math.max(1, dstW - 1) : 0;
  const scaleY = srcH > 1 ? (srcH - 1) / Math.max(1, dstH - 1) : 0;

  for (let dy = 0; dy < dstH; dy++) {
    const sy = dstH > 1 ? dy * scaleY : 0;
    const y0 = Math.floor(sy);
    const y1 = Math.min(srcH - 1, y0 + 1);
    const fy = sy - y0;

    for (let dx = 0; dx < dstW; dx++) {
      const sx = dstW > 1 ? dx * scaleX : 0;
      const x0 = Math.floor(sx);
      const x1 = Math.min(srcW - 1, x0 + 1);
      const fx = sx - x0;

      const v00 = src[y0 * srcW + x0];
      const v01 = src[y0 * srcW + x1];
      const v10 = src[y1 * srcW + x0];
      const v11 = src[y1 * srcW + x1];

      const top = v00 * (1 - fx) + v01 * fx;
      const bottom = v10 * (1 - fx) + v11 * fx;
      dst[dy * dstW + dx] = top * (1 - fy) + bottom * fy;
    }
  }

  return dst;
}
