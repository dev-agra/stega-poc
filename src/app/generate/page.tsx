'use client';

import { useRef, useState } from 'react';
import { encodeMarker, DEFAULT_STRENGTH } from '@/lib/marker';
import { lumaGridToImageData } from '@/lib/canvasUtils';

export default function GeneratePage() {
  const [qrText, setQrText] = useState('https://example.com/verify/ABC123');
  const [secret, setSecret] = useState('SECRET01');
  const [strength, setStrength] = useState(DEFAULT_STRENGTH);
  const [stats, setStats] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [downloadUrl, setDownloadUrl] = useState<string | null>(null);

  async function handleGenerate() {
    setError(null);
    setStats(null);
    setDownloadUrl(null);

    if (secret.length !== 8) {
      setError('Secret message must be exactly 8 characters.');
      return;
    }
    if (!qrText.trim()) {
      setError('QR text/URL cannot be empty.');
      return;
    }

    setBusy(true);
    try {
      const result = await encodeMarker(qrText, secret, strength);
      const canvas = canvasRef.current!;
      canvas.width = result.canonicalSize;
      canvas.height = result.canonicalSize;
      const ctx = canvas.getContext('2d')!;
      const imgData = lumaGridToImageData(result.luma, result.canonicalSize);
      ctx.putImageData(imgData, 0, 0);

      setStats(
        `Canonical size: ${result.canonicalSize}x${result.canonicalSize}px (${result.moduleSize}x${result.moduleSize} modules) · ` +
          `${result.stats.totalDataModules} data modules available · ${result.stats.bitsEmbedded} bits embedded ` +
          `(${result.stats.repeats} BCH-protected repeats) · strength=${result.stats.strength}`
      );
      setDownloadUrl(canvas.toDataURL('image/png'));
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <main className="max-w-2xl mx-auto p-8 space-y-6">
      <h1 className="text-2xl font-semibold">Generate Watermarked QR Marker</h1>
      <p className="text-sm text-neutral-500">
        Generates a standard 37×37 (version 5) QR code carrying your visible URL/text, then embeds an
        8-character secret payload into its non-reserved modules using DCT coefficient watermarking,
        BCH(63,36,t=5) error correction, and PRNG-masked repetition.
      </p>

      <div className="space-y-4">
        <div>
          <label className="block text-sm font-medium mb-1">QR visible text / URL</label>
          <input
            className="w-full border rounded px-3 py-2 bg-transparent"
            value={qrText}
            onChange={(e) => setQrText(e.target.value)}
          />
        </div>

        <div>
          <label className="block text-sm font-medium mb-1">Secret message (exactly 8 characters)</label>
          <input
            className="w-full border rounded px-3 py-2 bg-transparent"
            value={secret}
            maxLength={8}
            onChange={(e) => setSecret(e.target.value)}
          />
          <p className="text-xs text-neutral-500 mt-1">{secret.length}/8 characters</p>
        </div>

        <div>
          <label className="block text-sm font-medium mb-1">
            Embedding strength (α): {strength}
          </label>
          <input
            type="range"
            min={5}
            max={200}
            value={strength}
            onChange={(e) => setStrength(Number(e.target.value))}
            className="w-full"
          />
          <p className="text-xs text-neutral-500 mt-1">
            Higher = more robust to noise/print-scan degradation, but more visible ripple inside QR
            modules. 40–80 is a reasonable default.
          </p>
        </div>

        <button
          onClick={handleGenerate}
          disabled={busy}
          className="px-4 py-2 rounded bg-black text-white disabled:opacity-50"
        >
          {busy ? 'Generating…' : 'Generate Marker'}
        </button>

        {error && <p className="text-red-600 text-sm">{error}</p>}
        {stats && <p className="text-sm text-neutral-600">{stats}</p>}
      </div>

      <div className="border rounded p-4 flex flex-col items-center gap-3">
        <canvas ref={canvasRef} className="border" style={{ imageRendering: 'pixelated', maxWidth: '100%' }} />
        {downloadUrl && (
          <a
            href={downloadUrl}
            download="watermarked-marker.png"
            className="text-sm underline text-blue-600"
          >
            Download PNG
          </a>
        )}
      </div>
    </main>
  );
}
