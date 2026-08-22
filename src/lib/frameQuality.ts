// Cheap, dependency-free frame-quality gates for the live camera pipeline:
// - Blur detection via variance of the Laplacian (classic, fast, no ML needed).
//   Sharp images have lots of high-frequency edge content -> high variance.
//   Blurry/out-of-focus/motion-blurred images smear edges -> low variance.
// - Frame-to-frame motion detection via simple mean absolute difference on
//   grayscale, to catch fast hand-shake even when Laplacian variance alone
//   might not flag it (e.g. panning blur that still has some edge content).

/** RGBA -> grayscale Float64Array (luma only, no chroma needed for these metrics). */
export function toGrayscale(data: Uint8ClampedArray, width: number, height: number): Float64Array {
  const gray = new Float64Array(width * height);
  for (let i = 0; i < width * height; i++) {
    const r = data[i * 4];
    const g = data[i * 4 + 1];
    const b = data[i * 4 + 2];
    gray[i] = 0.299 * r + 0.587 * g + 0.114 * b;
  }
  return gray;
}

/**
 * Variance of the 3x3 Laplacian response across the image. Higher = sharper.
 * This is the standard, well-established blur metric (Pech-Pacheco et al.)
 * used widely because it's a single cheap convolution pass, no ML model
 * needed, and correlates well with subjective focus/sharpness.
 */
export function laplacianVariance(gray: Float64Array, width: number, height: number): number {
  // 3x3 Laplacian kernel: [[0,1,0],[1,-4,1],[0,1,0]]
  const responses: number[] = [];
  for (let y = 1; y < height - 1; y++) {
    for (let x = 1; x < width - 1; x++) {
      const idx = y * width + x;
      const lap =
        gray[idx - width] + gray[idx + width] + gray[idx - 1] + gray[idx + 1] - 4 * gray[idx];
      responses.push(lap);
    }
  }
  const n = responses.length;
  if (n === 0) return 0;
  const mean = responses.reduce((a, b) => a + b, 0) / n;
  let variance = 0;
  for (const r of responses) variance += (r - mean) ** 2;
  return variance / n;
}

/** Mean absolute per-pixel difference between two equally-sized grayscale frames. */
export function frameDiff(a: Float64Array, b: Float64Array): number {
  if (a.length !== b.length || a.length === 0) return 0;
  let sum = 0;
  for (let i = 0; i < a.length; i++) sum += Math.abs(a[i] - b[i]);
  return sum / a.length;
}

export interface FrameQuality {
  sharpness: number; // Laplacian variance
  motion: number | null; // mean abs diff vs previous frame, null if no previous frame
  isBlurry: boolean;
  isMoving: boolean;
  accepted: boolean;
}

export interface FrameQualityThresholds {
  minSharpness: number;
  maxMotion: number;
}

export const DEFAULT_QUALITY_THRESHOLDS: FrameQualityThresholds = {
  // These are starting points, not universal constants - real cameras,
  // lighting, and marker sizes vary enough that these should be tunable
  // (exposed as constants here, adjustable if real-world testing shows
  // too many false rejects/accepts).
  minSharpness: 15,
  maxMotion: 8,
};

export function assessFrameQuality(
  gray: Float64Array,
  width: number,
  height: number,
  previousGray: Float64Array | null,
  thresholds: FrameQualityThresholds = DEFAULT_QUALITY_THRESHOLDS
): FrameQuality {
  const sharpness = laplacianVariance(gray, width, height);
  const motion = previousGray ? frameDiff(gray, previousGray) : null;

  const isBlurry = sharpness < thresholds.minSharpness;
  const isMoving = motion !== null && motion > thresholds.maxMotion;

  return {
    sharpness,
    motion,
    isBlurry,
    isMoving,
    accepted: !isBlurry && !isMoving,
  };
}
