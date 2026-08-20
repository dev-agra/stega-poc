'use client';

import { useState } from 'react';
import { decodeImage, extractRawBits, DEFAULT_SEED, DEFAULT_SECRET, DEFAULT_COEFF_1, DEFAULT_COEFF_2, type DecodeResult } from '@/lib/imageStego';
import { computeBerReport, type BerReport } from '@/lib/ber';
import { loadImageFileNative, imageToRgbaNative } from '@/lib/canvasUtils';
import CoeffGridSelector from '@/components/CoeffGridSelector';
import CameraScan from '@/components/CameraScan';
import type { CoeffPos } from '@/lib/dct';

type Mode = 'unset' | 'upload' | 'scan-decode' | 'scan-ber';

export default function DecodePage() {
  const [coeff1, setCoeff1] = useState<CoeffPos>(DEFAULT_COEFF_1);
  const [coeff2, setCoeff2] = useState<CoeffPos>(DEFAULT_COEFF_2);
  const [mode, setMode] = useState<Mode>('unset');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [autoDetected, setAutoDetected] = useState(false);
  const [result, setResult] = useState<DecodeResult | null>(null);
  const [scannedQrText, setScannedQrText] = useState<string | null>(null);
  const [berReport, setBerReport] = useState<BerReport | null>(null);

  async function handleFile(file: File) {
    setError(null);
    setResult(null);
    setBerReport(null);

    let useCoeff1 = coeff1;
    let useCoeff2 = coeff2;
    // Filenames from this app's encoder still carry the coefficient pair
    // (secret/seed are fixed constants now, so no longer part of the match).
    const match = file.name.match(/c1-(\d)x(\d)_c2-(\d)x(\d)/);
    if (match) {
      useCoeff1 = { u: Number(match[1]), v: Number(match[2]) };
      useCoeff2 = { u: Number(match[3]), v: Number(match[4]) };
      setCoeff1(useCoeff1);
      setCoeff2(useCoeff2);
      setAutoDetected(true);
    } else {
      setAutoDetected(false);
    }

    setBusy(true);
    try {
      const { img, width, height } = await loadImageFileNative(file);
      const rgba = imageToRgbaNative(img, width, height);
      const dec = decodeImage(rgba, { seed: DEFAULT_SEED, coeff1: useCoeff1, coeff2: useCoeff2 });
      setResult(dec);

      // BER diagnostic: regenerate the reference bit-stream for the fixed
      // app-wide secret and compare against the raw extraction.
      const { rxBits } = extractRawBits(rgba, { seed: DEFAULT_SEED, coeff1: useCoeff1, coeff2: useCoeff2 });
      setBerReport(computeBerReport(DEFAULT_SECRET, DEFAULT_SEED, rxBits));
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  const paramsLocked = mode !== 'unset';

  return (
    <main className="max-w-3xl mx-auto px-6 py-10 space-y-8">
      <div>
        <h1 className="text-3xl font-bold text-neutral-50">Decode</h1>
        <p className="text-sm text-neutral-400 mt-1 leading-relaxed">
          Secret and seed are fixed for this app (<span className="font-mono text-red-400">{DEFAULT_SECRET}</span> /{' '}
          <span className="font-mono text-red-400">0x{DEFAULT_SEED.toString(16)}</span>) — only the
          coefficient pair varies. Set it below, then choose how to read the marker.
        </p>
      </div>

      <section className="space-y-5 border border-neutral-800 rounded-lg p-6 bg-neutral-950">
        <fieldset disabled={paramsLocked} className={paramsLocked ? 'opacity-50' : ''}>
          <CoeffGridSelector coeff1={coeff1} coeff2={coeff2} onChange={(c1, c2) => { setCoeff1(c1); setCoeff2(c2); }} />
        </fieldset>

        {paramsLocked && (
          <button
            onClick={() => { setMode('unset'); setResult(null); setError(null); setBerReport(null); }}
            className="text-xs text-neutral-400 underline hover:text-red-400"
          >
            ← edit parameters
          </button>
        )}

        {!paramsLocked && (
          <div className="flex flex-col gap-3 pt-2">
            <button
              onClick={() => setMode('upload')}
              className="w-full px-4 py-3 rounded bg-red-600 text-white font-medium hover:bg-red-500 transition-colors"
            >
              Upload Image
            </button>
            <div className="flex gap-3">
              <button
                onClick={() => setMode('scan-decode')}
                className="flex-1 px-4 py-3 rounded border border-neutral-700 text-neutral-100 font-medium hover:border-red-500 transition-colors"
              >
                Scan (Decode)
              </button>
              <button
                onClick={() => setMode('scan-ber')}
                className="flex-1 px-4 py-3 rounded border border-neutral-700 text-neutral-100 font-medium hover:border-red-500 transition-colors"
              >
                Scan (BER Analysis)
              </button>
            </div>
            <p className="text-xs text-neutral-500">
              <span className="text-neutral-300 font-medium">Scan (Decode)</span> only recovers the
              secret, no BER computed. <span className="text-neutral-300 font-medium">Scan (BER
              Analysis)</span> never decodes — it continuously tracks BER against the fixed secret and
              shows the lowest score reached this session.
            </p>
          </div>
        )}
      </section>

      {mode === 'upload' && (
        <section className="space-y-4 border border-neutral-800 rounded-lg p-6 bg-neutral-950">
          <h2 className="text-sm font-semibold text-neutral-200">Upload Marker Image</h2>
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
          {autoDetected && (
            <p className="text-xs text-red-400">✓ Coefficient pair auto-detected from filename.</p>
          )}
          {busy && <p className="text-sm text-neutral-400 animate-pulse">Decoding…</p>}
          {error && <p className="text-sm text-red-500">{error}</p>}
        </section>
      )}

      {mode === 'scan-decode' && (
        <section className="space-y-4 border border-neutral-800 rounded-lg p-6 bg-neutral-950">
          <h2 className="text-sm font-semibold text-neutral-200">Point Camera at Marker — Decode</h2>
          <CameraScan
            mode="decode"
            decodeOpts={{ seed: DEFAULT_SEED, coeff1, coeff2 }}
            onResult={(res, qrText) => {
              setResult(res);
              setScannedQrText(qrText);
            }}
          />
        </section>
      )}

      {mode === 'scan-ber' && (
        <section className="space-y-4 border border-neutral-800 rounded-lg p-6 bg-neutral-950">
          <h2 className="text-sm font-semibold text-neutral-200">Point Camera at Marker — BER Analysis</h2>
          <CameraScan mode="ber" decodeOpts={{ seed: DEFAULT_SEED, coeff1, coeff2 }} />
        </section>
      )}

      {result && (
        <section className="border border-neutral-800 rounded-lg p-6 bg-neutral-950">
          {result.message ? (
            <>
              <p className="text-2xl font-mono text-red-400">&quot;{result.message}&quot;</p>
              <p className="text-xs text-neutral-500 mt-2">
                Valid BCH copies: {result.validCopies}/{result.totalCopies} · bit errors corrected:{' '}
                {result.totalBitErrorsCorrected}
                {scannedQrText && (
                  <>
                    {' '}· QR visible text: <span className="font-mono text-neutral-300">{scannedQrText}</span>
                  </>
                )}
              </p>
            </>
          ) : (
            <p className="text-red-500 font-medium">
              No valid payload detected ({result.validCopies}/{result.totalCopies} copies passed BCH
              validation). Check the coefficient pair, or the image may not carry a watermark.
            </p>
          )}
        </section>
      )}

      {berReport && (
        <section className="border border-neutral-800 rounded-lg p-6 bg-neutral-950">
          <h2 className="text-sm font-semibold text-neutral-200 mb-3">Bit-Level Diagnostics (1024-block layer)</h2>
          <p className="text-xs text-neutral-500">BER (against fixed secret {DEFAULT_SECRET})</p>
          <p className="text-2xl font-mono text-red-400">{(berReport.ber * 100).toFixed(2)}%</p>
          <p className="text-xs text-neutral-500 mt-3">
            {berReport.mismatches} mismatches out of {berReport.bitsCompared} embedded bits compared.
          </p>
        </section>
      )}
    </main>
  );
}
