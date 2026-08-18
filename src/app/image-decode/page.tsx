'use client';

import { useState } from 'react';
import { decodeImage, DEFAULT_SEED, DEFAULT_COEFF_1, DEFAULT_COEFF_2 } from '@/lib/imageStego';
import { loadImageFileNative, imageToRgbaNative } from '@/lib/canvasUtils';
import CoeffGridSelector from '@/components/CoeffGridSelector';
import type { CoeffPos } from '@/lib/dct';

export default function ImageDecodePage() {
  const [seed, setSeed] = useState(DEFAULT_SEED);
  const [coeff1, setCoeff1] = useState<CoeffPos>(DEFAULT_COEFF_1);
  const [coeff2, setCoeff2] = useState<CoeffPos>(DEFAULT_COEFF_2);
  const [busy, setBusy] = useState(false);
  const [autoDetected, setAutoDetected] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<{
    message: string | null;
    validCopies: number;
    totalCopies: number;
    totalBitErrorsCorrected: number;
  } | null>(null);

  async function handleFile(file: File) {
    setError(null);
    setResult(null);
    setBusy(true);

    // Auto-parse params from filename if it matches our own naming scheme,
    // e.g. stego_seed-1585433294_c1-2x3_c2-3x4_str-120.png
    let useSeed = seed;
    let useCoeff1 = coeff1;
    let useCoeff2 = coeff2;
    const match = file.name.match(/seed-(-?\d+)_c1-(\d)x(\d)_c2-(\d)x(\d)/);
    if (match) {
      useSeed = Number(match[1]);
      useCoeff1 = { u: Number(match[2]), v: Number(match[3]) };
      useCoeff2 = { u: Number(match[4]), v: Number(match[5]) };
      setSeed(useSeed);
      setCoeff1(useCoeff1);
      setCoeff2(useCoeff2);
      setAutoDetected(true);
    } else {
      setAutoDetected(false);
    }

    try {
      const { img, width, height } = await loadImageFileNative(file);
      const rgba = imageToRgbaNative(img, width, height);
      const dec = decodeImage(rgba, { seed: useSeed, coeff1: useCoeff1, coeff2: useCoeff2 });
      setResult(dec);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <main className="max-w-3xl mx-auto p-8 space-y-8 relative z-10">
      <div>
        <h1 className="text-3xl font-bold text-red-500 tracking-tight">▓ DECODE ▓</h1>
        <p className="text-sm text-neutral-400 mt-1">
          Upload any image, any resolution. It&apos;s downsampled to the same 256×256 canonical grid
          used at encode time before extraction — no manual resizing needed.
        </p>
      </div>

      <section className="space-y-4 border border-red-900/50 rounded p-5 bg-black/40">
        <div>
          <label className="block text-sm font-semibold text-red-400 mb-1">Fixed PRNG Seed</label>
          <input
            type="number"
            className="w-full border border-neutral-700 rounded px-3 py-2 bg-black text-neutral-100 font-mono"
            value={seed}
            onChange={(e) => setSeed(Number(e.target.value) || 0)}
          />
          <p className="text-xs text-neutral-500 mt-1">
            Must match the encoder&apos;s seed exactly: <span className="font-mono text-red-300">0x{seed.toString(16)}</span>
          </p>
        </div>

        <CoeffGridSelector coeff1={coeff1} coeff2={coeff2} onChange={(c1, c2) => { setCoeff1(c1); setCoeff2(c2); }} />
        <p className="text-xs text-neutral-500">
          Current pair: <span className="font-mono text-red-400">({coeff1.u},{coeff1.v})</span> vs{' '}
          <span className="font-mono text-neutral-300">({coeff2.u},{coeff2.v})</span> — must match the encoder.
        </p>

        <div>
          <label className="block text-sm font-semibold text-red-400 mb-2">Marker Image</label>
          <input
            type="file"
            accept="image/*"
            disabled={busy}
            onChange={(e) => {
              const f = e.target.files?.[0];
              if (f) handleFile(f);
            }}
            className="block text-sm"
          />
          {autoDetected && (
            <p className="text-xs text-red-400 mt-1">
              ✓ Seed + coefficient pair auto-detected from filename and applied.
            </p>
          )}
        </div>

        {busy && <p className="text-sm text-red-400 animate-pulse">Decoding…</p>}
        {error && <p className="text-sm text-red-500 font-semibold">{error}</p>}
      </section>

      {result && (
        <section className="border border-neutral-800 rounded p-5 bg-black/60">
          {result.message ? (
            <>
              <p className="text-2xl font-mono text-red-400">
                &quot;{result.message}&quot;
              </p>
              <p className="text-xs text-neutral-500 mt-2">
                Valid BCH copies: {result.validCopies}/{result.totalCopies} · bit errors corrected:{' '}
                {result.totalBitErrorsCorrected}
              </p>
            </>
          ) : (
            <p className="text-red-600 font-semibold">
              NO VALID PAYLOAD DETECTED ({result.validCopies}/{result.totalCopies} copies passed BCH
              validation). Wrong seed/coefficient pair, unwatermarked image, or excessive distortion.
            </p>
          )}
        </section>
      )}
    </main>
  );
}
