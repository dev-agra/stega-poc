'use client';

import { useState } from 'react';
import { decodeImage, extractRawBits, DEFAULT_SEED, DEFAULT_COEFF_1, DEFAULT_COEFF_2, type DecodeResult } from '@/lib/imageStego';
import { computeBerReport, type BerReport } from '@/lib/ber';
import { loadImageFileNative, imageToRgbaNative } from '@/lib/canvasUtils';
import CoeffGridSelector from '@/components/CoeffGridSelector';
import CameraScan from '@/components/CameraScan';
import type { CoeffPos } from '@/lib/dct';

type Mode = 'unset' | 'upload' | 'scan';

export default function DecodePage() {
  const [seed, setSeed] = useState(DEFAULT_SEED);
  const [coeff1, setCoeff1] = useState<CoeffPos>(DEFAULT_COEFF_1);
  const [coeff2, setCoeff2] = useState<CoeffPos>(DEFAULT_COEFF_2);
  const [mode, setMode] = useState<Mode>('unset');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [autoDetected, setAutoDetected] = useState(false);
  const [result, setResult] = useState<DecodeResult | null>(null);
  const [scannedQrText, setScannedQrText] = useState<string | null>(null);
  const [referenceSecret, setReferenceSecret] = useState('SECRET01');
  const [berReport, setBerReport] = useState<BerReport | null>(null);

  async function handleFile(file: File) {
    setError(null);
    setResult(null);
    setBerReport(null);

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

    setBusy(true);
    try {
      const { img, width, height } = await loadImageFileNative(file);
      const rgba = imageToRgbaNative(img, width, height);
      const dec = decodeImage(rgba, { seed: useSeed, coeff1: useCoeff1, coeff2: useCoeff2 });
      setResult(dec);

      // BER / BERv2 diagnostic: regenerate the reference bit-stream for a
      // known secret (the one that was actually decoded if successful,
      // otherwise the manually-entered reference secret for calibration/
      // testing purposes) and compare against the raw extraction.
      const secretForBer = dec.message ?? referenceSecret;
      if (secretForBer && secretForBer.length === 8) {
        const { rxBits, confidences } = extractRawBits(rgba, { seed: useSeed, coeff1: useCoeff1, coeff2: useCoeff2 });
        const report = computeBerReport(secretForBer, useSeed, rxBits, confidences);
        setBerReport(report);
      }
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
          Set the seed and coefficient pair first, then choose how to read the marker.
        </p>
      </div>

      <section className="space-y-5 border border-neutral-800 rounded-lg p-6 bg-neutral-950">
        <fieldset disabled={paramsLocked} className={paramsLocked ? 'opacity-50' : ''}>
          <div className="space-y-4">
            <div>
              <label className="block text-sm font-medium text-neutral-200 mb-1">Fixed PRNG Seed</label>
              <input
                type="number"
                className="w-full border border-neutral-700 rounded px-3 py-2 bg-black text-neutral-100"
                value={seed}
                onChange={(e) => setSeed(Number(e.target.value) || 0)}
              />
              <p className="text-xs text-neutral-500 mt-1">
                Hex: <span className="font-mono text-red-400">0x{seed.toString(16)}</span>
              </p>
            </div>

            <CoeffGridSelector coeff1={coeff1} coeff2={coeff2} onChange={(c1, c2) => { setCoeff1(c1); setCoeff2(c2); }} />

            <div>
              <label className="block text-sm font-medium text-neutral-200 mb-1">
                Reference secret <span className="text-neutral-500">(for BER diagnostics, upload path only)</span>
              </label>
              <input
                className="w-full border border-neutral-700 rounded px-3 py-2 bg-black text-neutral-100"
                value={referenceSecret}
                maxLength={8}
                onChange={(e) => setReferenceSecret(e.target.value)}
              />
              <p className="text-xs text-neutral-500 mt-1">
                Used only if BCH decode fails — if decode succeeds, BER is computed against the
                actually-recovered secret automatically.
              </p>
            </div>
          </div>
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
          <div className="flex gap-3 pt-2">
            <button
              onClick={() => setMode('upload')}
              className="flex-1 px-4 py-3 rounded bg-red-600 text-white font-medium hover:bg-red-500 transition-colors"
            >
              Upload Image
            </button>
            <button
              onClick={() => setMode('scan')}
              className="flex-1 px-4 py-3 rounded border border-neutral-700 text-neutral-100 font-medium hover:border-red-500 transition-colors"
            >
              Scan with Camera
            </button>
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
            <p className="text-xs text-red-400">✓ Seed + coefficient pair auto-detected from filename.</p>
          )}
          {busy && <p className="text-sm text-neutral-400 animate-pulse">Decoding…</p>}
          {error && <p className="text-sm text-red-500">{error}</p>}
        </section>
      )}

      {mode === 'scan' && (
        <section className="space-y-4 border border-neutral-800 rounded-lg p-6 bg-neutral-950">
          <h2 className="text-sm font-semibold text-neutral-200">Point Camera at Marker</h2>
          <CameraScan
            decodeOpts={{ seed, coeff1, coeff2 }}
            onResult={(res, qrText) => {
              setResult(res);
              setScannedQrText(qrText);
            }}
          />
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
              validation). Check the seed/coefficient pair, or the image may not carry a watermark.
            </p>
          )}
        </section>
      )}

      {berReport && (
        <section className="border border-neutral-800 rounded-lg p-6 bg-neutral-950">
          <h2 className="text-sm font-semibold text-neutral-200 mb-3">Bit-Level Diagnostics (1024-block layer)</h2>
          <div className="grid grid-cols-2 gap-4">
            <div>
              <p className="text-xs text-neutral-500">BER (unweighted)</p>
              <p className="text-2xl font-mono text-red-400">{(berReport.ber * 100).toFixed(2)}%</p>
            </div>
            <div>
              <p className="text-xs text-neutral-500">BERv2 (confidence-weighted)</p>
              <p className="text-2xl font-mono text-red-400">{(berReport.berV2 * 100).toFixed(2)}%</p>
            </div>
          </div>
          <p className="text-xs text-neutral-500 mt-3">
            {berReport.mismatches} mismatches out of {berReport.bitsCompared} embedded bits compared.
            BERv2 weights each bit by its DCT coefficient-pair separation magnitude at decode time —
            low-confidence (near-zero separation) mismatches count less than high-confidence ones.
          </p>
        </section>
      )}
    </main>
  );
}
