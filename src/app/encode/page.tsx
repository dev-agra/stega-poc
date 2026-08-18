'use client';

import { useRef, useState } from 'react';
import { encodeImage, DEFAULT_STRENGTH, MAX_STRENGTH, DEFAULT_SEED, DEFAULT_COEFF_1, DEFAULT_COEFF_2 } from '@/lib/imageStego';
import { loadImageFileNative, imageToRgbaNative, rgbaToCanvas } from '@/lib/canvasUtils';
import CoeffGridSelector from '@/components/CoeffGridSelector';
import type { CoeffPos } from '@/lib/dct';

export default function EncodePage() {
  const [secret, setSecret] = useState('SECRET01');
  const [strength, setStrength] = useState(DEFAULT_STRENGTH);
  const [seed, setSeed] = useState(DEFAULT_SEED);
  const [coeff1, setCoeff1] = useState<CoeffPos>(DEFAULT_COEFF_1);
  const [coeff2, setCoeff2] = useState<CoeffPos>(DEFAULT_COEFF_2);
  const [error, setError] = useState<string | null>(null);
  const [stats, setStats] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [fileName, setFileName] = useState<string | null>(null);
  const [downloadUrl, setDownloadUrl] = useState<string | null>(null);
  const [downloadName, setDownloadName] = useState<string>('stego-output.png');
  const canvasRef = useRef<HTMLCanvasElement>(null);

  async function handleFile(file: File) {
    setError(null);
    setStats(null);
    setDownloadUrl(null);
    setFileName(file.name);

    if (secret.length !== 8) {
      setError('Secret message must be exactly 8 characters.');
      return;
    }

    setBusy(true);
    try {
      const { img, width, height } = await loadImageFileNative(file);
      const rgba = imageToRgbaNative(img, width, height);

      const result = encodeImage(rgba, secret, { strength, seed, coeff1, coeff2 });

      const canvas = canvasRef.current!;
      rgbaToCanvas(result.image, canvas);

      setStats(
        `${width}x${height} in → ${result.image.width}x${result.image.height} out (unchanged) · ` +
          `${result.stats.bitsEmbedded} bits across ${result.stats.repeats} BCH-protected repeats · ` +
          `strength ${result.stats.strength}`
      );
      setDownloadUrl(canvas.toDataURL('image/png'));
      setDownloadName(
        `stego_seed-${seed}_c1-${coeff1.u}x${coeff1.v}_c2-${coeff2.u}x${coeff2.v}_str-${strength}.png`
      );
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <main className="max-w-3xl mx-auto px-6 py-10 space-y-8">
      <div>
        <h1 className="text-3xl font-bold text-neutral-50">Encode</h1>
        <p className="text-sm text-neutral-400 mt-1 leading-relaxed">
          Upload any RGB image, any resolution. Output ships at the same resolution — the payload
          is embedded via a 256×256 canonical DCT grid and projected back out via residual delta
          masking, so it survives resizing after the fact.
        </p>
      </div>

      <section className="space-y-5 border border-neutral-800 rounded-lg p-6 bg-neutral-950">
        <div>
          <label className="block text-sm font-medium text-neutral-200 mb-1">
            Secret payload <span className="text-neutral-500">(exactly 8 characters)</span>
          </label>
          <input
            className="w-full border border-neutral-700 rounded px-3 py-2 bg-black text-neutral-100"
            value={secret}
            maxLength={8}
            onChange={(e) => setSecret(e.target.value)}
          />
          <p className="text-xs text-neutral-500 mt-1">{secret.length}/8 characters</p>
        </div>

        <div>
          <label className="block text-sm font-medium text-neutral-200 mb-1">
            Embedding strength (α): <span className="font-mono text-red-400">{strength}</span> / {MAX_STRENGTH}
          </label>
          <input
            type="range"
            min={0}
            max={MAX_STRENGTH}
            value={strength}
            onChange={(e) => setStrength(Number(e.target.value))}
            className="w-full"
          />
          <p className="text-xs text-neutral-500 mt-1">
            0–150 subtle · 150–500 visible on close inspection · 500+ visibly distorted, maximal robustness.
          </p>
        </div>

        <div>
          <label className="block text-sm font-medium text-neutral-200 mb-1">Fixed PRNG seed</label>
          <input
            type="number"
            className="w-full border border-neutral-700 rounded px-3 py-2 bg-black text-neutral-100"
            value={seed}
            onChange={(e) => setSeed(Number(e.target.value) || 0)}
          />
          <p className="text-xs text-neutral-500 mt-1">
            Must match on decode. Hex: <span className="font-mono text-red-400">0x{seed.toString(16)}</span>
          </p>
        </div>

        <CoeffGridSelector coeff1={coeff1} coeff2={coeff2} onChange={(c1, c2) => { setCoeff1(c1); setCoeff2(c2); }} />
        <p className="text-xs text-neutral-500">
          Pair: <span className="font-mono text-red-400">({coeff1.u},{coeff1.v})</span> vs{' '}
          <span className="font-mono text-neutral-300">({coeff2.u},{coeff2.v})</span> — must match on decode.
        </p>

        <div>
          <label className="block text-sm font-medium text-neutral-200 mb-2">Target image</label>
          <input
            type="file"
            accept="image/*"
            disabled={busy}
            onChange={(e) => {
              const f = e.target.files?.[0];
              if (f) handleFile(f);
            }}
            className="block text-sm text-neutral-300"
          />
          {fileName && <p className="text-xs text-neutral-500 mt-1">{fileName}</p>}
        </div>

        {busy && <p className="text-sm text-neutral-400 animate-pulse">Encoding…</p>}
        {error && <p className="text-sm text-red-500 font-medium">{error}</p>}
        {stats && <p className="text-xs text-neutral-500 leading-relaxed">{stats}</p>}
      </section>

      <section className="border border-neutral-800 rounded-lg p-6 flex flex-col items-center gap-3 bg-neutral-950">
        <canvas ref={canvasRef} className="border border-neutral-800 rounded max-w-full" />
        {downloadUrl && (
          <>
            <a href={downloadUrl} download={downloadName} className="text-sm text-red-400 font-medium hover:text-red-300">
              Download encoded PNG
            </a>
            <p className="text-[11px] text-neutral-600 font-mono break-all text-center">{downloadName}</p>
          </>
        )}
      </section>
    </main>
  );
}
