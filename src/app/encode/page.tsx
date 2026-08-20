'use client';

import { useRef, useState } from 'react';
import { encodeImage, DEFAULT_STRENGTH, MAX_STRENGTH, DEFAULT_SEED, DEFAULT_SECRET, DEFAULT_COEFF_1, DEFAULT_COEFF_2, type RgbaImage } from '@/lib/imageStego';
import { loadImageFileNative, imageToRgbaNative, rgbaToCanvas } from '@/lib/canvasUtils';
import { parseBulkCsv, bulkEncodeToZip, type BulkRow } from '@/lib/bulkEncode';
import CoeffGridSelector from '@/components/CoeffGridSelector';
import type { CoeffPos } from '@/lib/dct';

type PageMode = 'single' | 'bulk';

export default function EncodePage() {
  const [pageMode, setPageMode] = useState<PageMode>('single');

  // --- Single-encode state (secret + seed are fixed app-wide constants) ---
  const [strength, setStrength] = useState(DEFAULT_STRENGTH);
  const [coeff1, setCoeff1] = useState<CoeffPos>(DEFAULT_COEFF_1);
  const [coeff2, setCoeff2] = useState<CoeffPos>(DEFAULT_COEFF_2);
  const [error, setError] = useState<string | null>(null);
  const [stats, setStats] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [fileName, setFileName] = useState<string | null>(null);
  const [downloadUrl, setDownloadUrl] = useState<string | null>(null);
  const [downloadName, setDownloadName] = useState<string>('stego-output.png');
  const [uploadedImage, setUploadedImage] = useState<RgbaImage | null>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);

  function runEncode(rgba: RgbaImage) {
    setError(null);
    setBusy(true);
    try {
      const result = encodeImage(rgba, DEFAULT_SECRET, { strength, seed: DEFAULT_SEED, coeff1, coeff2 });
      const canvas = canvasRef.current!;
      rgbaToCanvas(result.image, canvas);
      setStats(
        `${rgba.width}x${rgba.height} in → ${result.image.width}x${result.image.height} out (unchanged) · ` +
          `${result.stats.bitsEmbedded} bits across ${result.stats.repeats} BCH-protected repeats · ` +
          `strength ${result.stats.strength}`
      );
      setDownloadUrl(canvas.toDataURL('image/png'));
      setDownloadName(
        `stego_c1-${coeff1.u}x${coeff1.v}_c2-${coeff2.u}x${coeff2.v}_str-${strength}.png`
      );
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  async function handleFile(file: File) {
    setStats(null);
    setDownloadUrl(null);
    setFileName(file.name);
    setBusy(true);
    try {
      const { img, width, height } = await loadImageFileNative(file);
      const rgba = imageToRgbaNative(img, width, height);
      setUploadedImage(rgba);
      runEncode(rgba);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      setBusy(false);
    }
  }

  // --- Bulk-encode state (secret + seed fixed here too) ---
  const [bulkImage, setBulkImage] = useState<RgbaImage | null>(null);
  const [bulkImageName, setBulkImageName] = useState<string | null>(null);
  const [bulkRows, setBulkRows] = useState<BulkRow[]>([]);
  const [bulkCsvName, setBulkCsvName] = useState<string | null>(null);
  const [bulkErrors, setBulkErrors] = useState<string[]>([]);
  const [bulkBusy, setBulkBusy] = useState(false);
  const [bulkProgress, setBulkProgress] = useState<{ completed: number; total: number } | null>(null);
  const [bulkZipUrl, setBulkZipUrl] = useState<string | null>(null);

  async function handleBulkImage(file: File) {
    setBulkImageName(file.name);
    setBulkZipUrl(null);
    const { img, width, height } = await loadImageFileNative(file);
    setBulkImage(imageToRgbaNative(img, width, height));
  }

  async function handleBulkCsv(file: File) {
    setBulkCsvName(file.name);
    setBulkZipUrl(null);
    const text = await file.text();
    const { rows, errors } = parseBulkCsv(text);
    setBulkRows(rows);
    setBulkErrors(errors);
  }

  async function runBulkEncode() {
    if (!bulkImage || bulkRows.length === 0) return;
    setBulkBusy(true);
    setBulkZipUrl(null);
    setBulkProgress({ completed: 0, total: bulkRows.length });
    try {
      const blob = await bulkEncodeToZip(bulkImage, DEFAULT_SECRET, DEFAULT_SEED, bulkRows, (progress) => {
        setBulkProgress({ completed: progress.completed, total: progress.total });
      });
      setBulkZipUrl(URL.createObjectURL(blob));
    } catch (e) {
      setBulkErrors([e instanceof Error ? e.message : String(e)]);
    } finally {
      setBulkBusy(false);
    }
  }

  return (
    <main className="max-w-3xl mx-auto px-6 py-10 space-y-8">
      <div>
        <h1 className="text-3xl font-bold text-neutral-50">Encode</h1>
        <p className="text-sm text-neutral-400 mt-1 leading-relaxed">
          Upload any RGB image, any resolution. Output ships at the same resolution — the payload
          is embedded via a 256×256 canonical DCT grid and projected back out via residual delta
          masking, so it survives resizing after the fact. Secret and seed are fixed app-wide (
          <span className="font-mono text-red-400">{DEFAULT_SECRET}</span> /{' '}
          <span className="font-mono text-red-400">0x{DEFAULT_SEED.toString(16)}</span>) — only
          strength and coefficient pair vary.
        </p>
      </div>

      <div className="flex gap-2 border border-neutral-800 rounded-lg p-1 w-fit">
        <button
          onClick={() => setPageMode('single')}
          className={`px-4 py-1.5 rounded text-sm font-medium transition-colors ${pageMode === 'single' ? 'bg-red-600 text-white' : 'text-neutral-400 hover:text-neutral-200'}`}
        >
          Single
        </button>
        <button
          onClick={() => setPageMode('bulk')}
          className={`px-4 py-1.5 rounded text-sm font-medium transition-colors ${pageMode === 'bulk' ? 'bg-red-600 text-white' : 'text-neutral-400 hover:text-neutral-200'}`}
        >
          Bulk Generate
        </button>
      </div>

      {pageMode === 'single' && (
        <>
          <section className="space-y-5 border border-neutral-800 rounded-lg p-6 bg-neutral-950">
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

            {uploadedImage && (
              <button
                onClick={() => runEncode(uploadedImage)}
                disabled={busy}
                className="w-full px-4 py-2.5 rounded border border-red-700 text-red-400 font-medium hover:bg-red-950/40 transition-colors disabled:opacity-50"
              >
                Re-encode with current settings
              </button>
            )}

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
        </>
      )}

      {pageMode === 'bulk' && (
        <section className="space-y-5 border border-neutral-800 rounded-lg p-6 bg-neutral-950">
          <div>
            <h2 className="text-sm font-semibold text-neutral-200 mb-1">Bulk Generate</h2>
            <p className="text-xs text-neutral-500 leading-relaxed">
              Upload one base image and a CSV with columns <span className="font-mono text-red-400">C1</span>,{' '}
              <span className="font-mono text-red-400">C2</span>,{' '}
              <span className="font-mono text-red-400">Strength</span>. One encoded PNG is generated per
              CSV row (same image, secret and seed each time — only the coefficient pair and strength
              vary), all packaged into a single ZIP.
            </p>
            <p className="text-xs text-neutral-500 mt-2">
              Coefficient cells use the format <span className="font-mono text-neutral-300">2x3</span> (u
              then v, 0–7 each) — avoid plain commas unless the cell is quoted, since an unquoted comma
              collides with the CSV's own column separator.
            </p>
          </div>

          <div>
            <label className="block text-sm font-medium text-neutral-200 mb-2">Base image</label>
            <input
              type="file"
              accept="image/*"
              onChange={(e) => {
                const f = e.target.files?.[0];
                if (f) handleBulkImage(f);
              }}
              className="block text-sm text-neutral-300"
            />
            {bulkImageName && <p className="text-xs text-neutral-500 mt-1">{bulkImageName}</p>}
          </div>

          <div>
            <label className="block text-sm font-medium text-neutral-200 mb-2">CSV (C1, C2, Strength)</label>
            <input
              type="file"
              accept=".csv,text/csv"
              onChange={(e) => {
                const f = e.target.files?.[0];
                if (f) handleBulkCsv(f);
              }}
              className="block text-sm text-neutral-300"
            />
            {bulkCsvName && (
              <p className="text-xs text-neutral-500 mt-1">
                {bulkCsvName} — {bulkRows.length} valid row{bulkRows.length === 1 ? '' : 's'} parsed
              </p>
            )}
          </div>

          {bulkErrors.length > 0 && (
            <div className="border border-red-900/50 rounded p-3 bg-red-950/30 text-xs text-red-400 space-y-1">
              {bulkErrors.map((e, i) => (
                <p key={i}>{e}</p>
              ))}
            </div>
          )}

          <button
            onClick={runBulkEncode}
            disabled={!bulkImage || bulkRows.length === 0 || bulkBusy}
            className="w-full px-4 py-2.5 rounded bg-red-600 text-white font-medium hover:bg-red-500 transition-colors disabled:opacity-40"
          >
            {bulkBusy ? 'Generating…' : `Generate ${bulkRows.length || ''} images as ZIP`}
          </button>

          {bulkProgress && (
            <div className="space-y-1">
              <div className="h-2 rounded bg-neutral-800 overflow-hidden">
                <div
                  className="h-full bg-red-600 transition-all"
                  style={{ width: `${(bulkProgress.completed / bulkProgress.total) * 100}%` }}
                />
              </div>
              <p className="text-xs text-neutral-500">
                {bulkProgress.completed} / {bulkProgress.total} images generated
              </p>
            </div>
          )}

          {bulkZipUrl && (
            <a
              href={bulkZipUrl}
              download={`bulk-stego_${bulkRows.length}-images.zip`}
              className="block text-center text-sm text-red-400 font-medium hover:text-red-300 border border-red-700 rounded py-2.5"
            >
              Download ZIP ({bulkRows.length} images)
            </a>
          )}
        </section>
      )}
    </main>
  );
}
