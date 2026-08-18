'use client';

import { useRef, useState } from 'react';
import { encodeImage, DEFAULT_STRENGTH, MAX_STRENGTH, DEFAULT_SEED, DEFAULT_COEFF_1, DEFAULT_COEFF_2 } from '@/lib/imageStego';
import { loadImageFileNative, imageToRgbaNative, rgbaToCanvas } from '@/lib/canvasUtils';
import CoeffGridSelector from '@/components/CoeffGridSelector';
import type { CoeffPos } from '@/lib/dct';

export default function ImageEncodePage() {
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
        `Input resolution: ${width}x${height} → output resolution: ${result.image.width}x${result.image.height} (unchanged) · ` +
          `${result.stats.bitsEmbedded} bits embedded across ${result.stats.repeats} BCH-protected repeats · ` +
          `strength=${result.stats.strength} · seed=0x${result.stats.seed.toString(16)}`
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
    <main className="max-w-3xl mx-auto p-8 space-y-8 relative z-10">
      <div>
        <h1 className="text-3xl font-bold text-red-500 tracking-tight">▓ ENCODE ▓</h1>
        <p className="text-sm text-neutral-400 mt-1">
          Upload any RGB image, any resolution. Output is emitted at the <span className="text-red-400">same
          resolution</span> — the payload is embedded via a 256×256 canonical DCT grid and projected back
          out via residual delta masking, so it survives resizing after the fact.
        </p>
      </div>

      <section className="space-y-4 border border-red-900/50 rounded p-5 bg-black/40">
        <div>
          <label className="block text-sm font-semibold text-red-400 mb-1">Secret Payload (exactly 8 ASCII chars)</label>
          <input
            className="w-full border border-neutral-700 rounded px-3 py-2 bg-black text-neutral-100 font-mono"
            value={secret}
            maxLength={8}
            onChange={(e) => setSecret(e.target.value)}
          />
          <p className="text-xs text-neutral-500 mt-1">{secret.length}/8 characters</p>
        </div>

        <div>
          <label className="block text-sm font-semibold text-red-400 mb-1">
            Embedding Strength (α): <span className="font-mono">{strength}</span> / {MAX_STRENGTH}
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
            0–150: subtle. 150–500: visible on close inspection. 500+: visibly distorted, maximal
            robustness. Default {DEFAULT_STRENGTH}.
          </p>
        </div>

        <div>
          <label className="block text-sm font-semibold text-red-400 mb-1">Fixed PRNG Seed</label>
          <input
            type="number"
            className="w-full border border-neutral-700 rounded px-3 py-2 bg-black text-neutral-100 font-mono"
            value={seed}
            onChange={(e) => setSeed(Number(e.target.value) || 0)}
          />
          <p className="text-xs text-neutral-500 mt-1">
            Must match exactly on the decoder side (shown as hex there too): <span className="font-mono text-red-300">0x{seed.toString(16)}</span>
          </p>
        </div>

        <CoeffGridSelector coeff1={coeff1} coeff2={coeff2} onChange={(c1, c2) => { setCoeff1(c1); setCoeff2(c2); }} />
        <p className="text-xs text-neutral-500">
          Current pair: <span className="font-mono text-red-400">({coeff1.u},{coeff1.v})</span> vs{' '}
          <span className="font-mono text-neutral-300">({coeff2.u},{coeff2.v})</span> — must match on decode.
        </p>

        <div>
          <label className="block text-sm font-semibold text-red-400 mb-2">Target Image</label>
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
          {fileName && <p className="text-xs text-neutral-500 mt-1">{fileName}</p>}
        </div>

        {busy && <p className="text-sm text-red-400 animate-pulse">Encoding…</p>}
        {error && <p className="text-sm text-red-500 font-semibold">{error}</p>}
        {stats && <p className="text-xs text-neutral-400">{stats}</p>}
      </section>

      <section className="border border-neutral-800 rounded p-4 flex flex-col items-center gap-3 bg-black/60">
        <canvas ref={canvasRef} className="border border-red-900 max-w-full" />
        {downloadUrl && (
          <a href={downloadUrl} download={downloadName} className="text-sm text-red-400 underline">
            Download Encoded PNG
          </a>
        )}
        {downloadUrl && (
          <p className="text-[11px] text-neutral-500 font-mono break-all text-center">{downloadName}</p>
        )}
      </section>
    </main>
  );
}
