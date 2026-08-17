'use client';

import { useRef, useState } from 'react';
import { decodeMarker, QR_VERSION, PX_PER_MODULE } from '@/lib/marker';
import { imageToLumaGrid, loadImageFile } from '@/lib/canvasUtils';

// Version 5 QR = 37 modules per side (fixed, matches the generator).
const MODULE_SIZE = 4 * QR_VERSION + 17; // QR module-count formula: 17 + 4*version
const CANONICAL_PX = MODULE_SIZE * PX_PER_MODULE;

export default function DecodePage() {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<{
    message: string | null;
    validCopies: number;
    totalCopies: number;
    totalBitErrorsCorrected: number;
  } | null>(null);
  const previewRef = useRef<HTMLCanvasElement>(null);

  async function handleFile(file: File) {
    setError(null);
    setResult(null);
    setBusy(true);
    try {
      const img = await loadImageFile(file);
      const luma = imageToLumaGrid(img, CANONICAL_PX);

      // preview what the decoder actually sees, post-resize
      const canvas = previewRef.current!;
      canvas.width = CANONICAL_PX;
      canvas.height = CANONICAL_PX;
      const ctx = canvas.getContext('2d')!;
      const imgData = ctx.createImageData(CANONICAL_PX, CANONICAL_PX);
      for (let y = 0; y < CANONICAL_PX; y++) {
        for (let x = 0; x < CANONICAL_PX; x++) {
          const v = Math.round(luma[y][x]);
          const idx = (y * CANONICAL_PX + x) * 4;
          imgData.data[idx] = v;
          imgData.data[idx + 1] = v;
          imgData.data[idx + 2] = v;
          imgData.data[idx + 3] = 255;
        }
      }
      ctx.putImageData(imgData, 0, 0);

      const dec = await decodeMarker(luma, MODULE_SIZE);
      setResult(dec);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <main className="max-w-2xl mx-auto p-8 space-y-6">
      <h1 className="text-2xl font-semibold">Decode Marker</h1>
      <p className="text-sm text-neutral-500">
        Upload an image of the marker. This build resizes the upload directly to the canonical{' '}
        {CANONICAL_PX}×{CANONICAL_PX}px grid — it does not yet perform fiducial detection or
        perspective correction for off-angle camera captures. Use a straight, cropped, well-lit shot
        for now.
      </p>

      <input
        type="file"
        accept="image/*"
        disabled={busy}
        onChange={(e) => {
          const f = e.target.files?.[0];
          if (f) handleFile(f);
        }}
        className="block"
      />

      {error && <p className="text-red-600 text-sm">{error}</p>}

      {result && (
        <div className="border rounded p-4 space-y-1">
          {result.message ? (
            <>
              <p className="text-lg font-mono">
                Decoded: <span className="font-bold">&quot;{result.message}&quot;</span>
              </p>
              <p className="text-sm text-neutral-600">
                Valid BCH copies: {result.validCopies}/{result.totalCopies} · bit errors corrected:{' '}
                {result.totalBitErrorsCorrected}
              </p>
            </>
          ) : (
            <p className="text-red-600 font-medium">
              No valid payload detected ({result.validCopies}/{result.totalCopies} copies passed BCH
              validation). This image likely has no embedded watermark, or distortion exceeded
              correction capacity.
            </p>
          )}
        </div>
      )}

      <div>
        <p className="text-sm font-medium mb-1">Canonical grid as seen by the decoder:</p>
        <canvas ref={previewRef} className="border" style={{ imageRendering: 'pixelated', maxWidth: '100%' }} />
      </div>
    </main>
  );
}
