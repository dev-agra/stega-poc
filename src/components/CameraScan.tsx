'use client';

import { useEffect, useRef, useState } from 'react';
import jsQR from 'jsqr';
import { warpQuadToSquare } from '@/lib/homography';
import { extractRawBits, resolveFromRawBits, computeAvgCoeffDifferencePenalized, DEFAULT_SEED, DEFAULT_SECRET, type DecodeOptions, type DecodeResult, type PenalizedCoeffDifferenceReport } from '@/lib/imageStego';
import { computeBerReport, type BerReport } from '@/lib/ber';
import { prepareTxBits } from '@/lib/payloadCodec';
import { toGrayscale, assessFrameQuality, DEFAULT_QUALITY_THRESHOLDS, type FrameQuality } from '@/lib/frameQuality';

interface Props {
  /**
   * 'decode': pure decode flow, no BER computation at all - just find the
   *   marker and recover the secret as fast as possible.
   * 'ber': BER-only diagnostic session - never attempts a full BCH decode,
   *   just tracks BER per detected frame plus a running session-best
   *   (lowest) score, with a reset control. Compares against the app-wide
   *   fixed secret (DEFAULT_SECRET), since secret/seed are constants
   *   everywhere in this app.
   */
  mode: 'decode' | 'ber';
  decodeOpts: DecodeOptions;
  onResult?: (result: DecodeResult, qrText: string) => void;
}

const WARP_SIZE = 320;
const CROP_SIZE = 400;
const ANCHOR_FRACTION = 0.78;

export default function CameraScan({ mode, decodeOpts, onResult }: Props) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const cropCanvasRef = useRef<HTMLCanvasElement>(null);
  const warpCanvasRef = useRef<HTMLCanvasElement>(null);
  const [status, setStatus] = useState<'starting' | 'searching' | 'found-qr' | 'found-blurry' | 'found-invalid' | 'decoded' | 'error'>('starting');
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [flash, setFlash] = useState(false);
  const [invalidAttempts, setInvalidAttempts] = useState(0);
  const [lastQrText, setLastQrText] = useState<string | null>(null);
  const [lastQuality, setLastQuality] = useState<FrameQuality | null>(null);
  const [rejectedFrames, setRejectedFrames] = useState(0);
  const previousGrayRef = useRef<Float64Array | null>(null);

  // BER-mode session tracking
  const [currentBer, setCurrentBer] = useState<BerReport | null>(null);
  const [lowestBer, setLowestBer] = useState<BerReport | null>(null);
  const [framesAnalyzed, setFramesAnalyzed] = useState(0);
  const [currentCoeffDiff, setCurrentCoeffDiff] = useState<PenalizedCoeffDifferenceReport | null>(null);

  const rafRef = useRef<number | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const flashTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  function resetSession() {
    setLowestBer(null);
    setFramesAnalyzed(0);
    setCurrentBer(null);
    setCurrentCoeffDiff(null);
  }

  useEffect(() => {
    let cancelled = false;

    async function start() {
      try {
        const stream = await navigator.mediaDevices.getUserMedia({
          video: {
            facingMode: 'environment',
            width: { ideal: 1920 },
            height: { ideal: 1080 },
            // @ts-expect-error whiteBalanceMode is not in the standard TS lib types yet, but is supported by Chrome/Android
            whiteBalanceMode: 'continuous',
          },
        });
        if (cancelled) {
          stream.getTracks().forEach((t) => t.stop());
          return;
        }
        streamRef.current = stream;

        try {
          const [track] = stream.getVideoTracks();
          const capabilities = track.getCapabilities?.() as MediaTrackCapabilities & { whiteBalanceMode?: string[] };
          if (capabilities?.whiteBalanceMode?.includes('continuous')) {
            await track.applyConstraints({
              advanced: [{ whiteBalanceMode: 'continuous' } as unknown as MediaTrackConstraintSet],
            });
          }
        } catch {
          // ignore - not all browsers/devices support this
        }

        const video = videoRef.current!;
        video.srcObject = stream;
        await video.play();
        setStatus('searching');
        tick();
      } catch (e) {
        setErrorMsg(e instanceof Error ? e.message : String(e));
        setStatus('error');
      }
    }

    function tick() {
      const video = videoRef.current;
      const cropCanvas = cropCanvasRef.current;
      if (!video || !cropCanvas || video.readyState !== video.HAVE_ENOUGH_DATA) {
        rafRef.current = requestAnimationFrame(tick);
        return;
      }

      const vw = video.videoWidth;
      const vh = video.videoHeight;
      const visibleSide = Math.min(vw, vh);
      const visibleX = (vw - visibleSide) / 2;
      const visibleY = (vh - visibleSide) / 2;
      const anchorSide = visibleSide * ANCHOR_FRACTION;
      const anchorX = visibleX + (visibleSide - anchorSide) / 2;
      const anchorY = visibleY + (visibleSide - anchorSide) / 2;

      cropCanvas.width = CROP_SIZE;
      cropCanvas.height = CROP_SIZE;
      const cropCtx = cropCanvas.getContext('2d')!;
      cropCtx.drawImage(video, anchorX, anchorY, anchorSide, anchorSide, 0, 0, CROP_SIZE, CROP_SIZE);
      const cropped = cropCtx.getImageData(0, 0, CROP_SIZE, CROP_SIZE);

      const qr = jsQR(cropped.data, CROP_SIZE, CROP_SIZE, { inversionAttempts: 'attemptBoth' });

      if (qr) {
        // Quality gate AFTER confirming a marker is actually present (jsQR
        // itself tolerates a fair amount of blur, but our fine-grained DCT
        // coefficient comparison needs sharper input than that) and BEFORE
        // the expensive homography warp + DCT extraction, so a confirmed
        // blurry/shaking frame is rejected cheaply without wasted work.
        const gray = toGrayscale(cropped.data, CROP_SIZE, CROP_SIZE);
        const quality = assessFrameQuality(gray, CROP_SIZE, CROP_SIZE, previousGrayRef.current, DEFAULT_QUALITY_THRESHOLDS);
        previousGrayRef.current = gray;
        setLastQuality(quality);

        if (!quality.accepted) {
          setStatus('found-blurry');
          setRejectedFrames((n) => n + 1);
          rafRef.current = requestAnimationFrame(tick);
          return;
        }

        setStatus('found-qr');
        setFlash(true);
        if (flashTimeoutRef.current) clearTimeout(flashTimeoutRef.current);
        flashTimeoutRef.current = setTimeout(() => setFlash(false), 150);

        const { topLeftCorner, topRightCorner, bottomRightCorner, bottomLeftCorner } = qr.location;
        const warped = warpQuadToSquare(
          { width: CROP_SIZE, height: CROP_SIZE, data: cropped.data },
          [topLeftCorner, topRightCorner, bottomRightCorner, bottomLeftCorner],
          WARP_SIZE
        );

        const warpCanvas = warpCanvasRef.current;
        if (warpCanvas) {
          warpCanvas.width = WARP_SIZE;
          warpCanvas.height = WARP_SIZE;
          const wctx = warpCanvas.getContext('2d')!;
          const imgData = wctx.createImageData(WARP_SIZE, WARP_SIZE);
          imgData.data.set(warped.data);
          wctx.putImageData(imgData, 0, 0);
        }

        if (mode === 'decode') {
          // Pure decode path: no BER pass at all - just extract + resolve.
          const seed = decodeOpts.seed ?? DEFAULT_SEED;
          const codec = decodeOpts.codec ?? 'bch';
          const { rxBits } = extractRawBits(warped, decodeOpts);
          const result = resolveFromRawBits(rxBits, seed, codec);

          if (result.validCopies > 0) {
            setStatus('decoded');
            onResult?.(result, qr.data);
            return; // stop scanning once decoded
          } else {
            setStatus('found-invalid');
            setLastQrText(qr.data);
            setInvalidAttempts((n) => n + 1);
          }
        } else {
          // BER-only session path: never attempts BCH decode. Secret/seed
          // are fixed app-wide constants, so no extra input is needed.
          setLastQrText(qr.data);
          const seed = decodeOpts.seed ?? DEFAULT_SEED;
          const { rxBits } = extractRawBits(warped, decodeOpts);
          const report = computeBerReport(DEFAULT_SECRET, seed, rxBits);
          setCurrentBer(report);
          setFramesAnalyzed((n) => n + 1);
          setLowestBer((prev) => (prev === null || report.ber < prev.ber ? report : prev));

          if (decodeOpts.coeff1 && decodeOpts.coeff2) {
            const { txBits } = prepareTxBits(DEFAULT_SECRET, 1024, seed);
            setCurrentCoeffDiff(computeAvgCoeffDifferencePenalized(warped, decodeOpts.coeff1, decodeOpts.coeff2, txBits));
          }
        }
      } else {
        setStatus('searching');
        if (mode === 'ber') {
          setCurrentBer(null);
          setCurrentCoeffDiff(null);
        }
      }

      rafRef.current = requestAnimationFrame(tick);
    }

    start();

    return () => {
      cancelled = true;
      if (rafRef.current) cancelAnimationFrame(rafRef.current);
      if (flashTimeoutRef.current) clearTimeout(flashTimeoutRef.current);
      streamRef.current?.getTracks().forEach((t) => t.stop());
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mode]);

  return (
    <div className="space-y-3">
      <div className="relative aspect-square w-full max-w-sm mx-auto border border-neutral-800 rounded overflow-hidden bg-black">
        <video ref={videoRef} className="absolute inset-0 w-full h-full object-cover" playsInline muted />

        <div
          className="absolute pointer-events-none"
          style={{
            top: `${(1 - ANCHOR_FRACTION) / 2 * 100}%`,
            left: `${(1 - ANCHOR_FRACTION) / 2 * 100}%`,
            width: `${ANCHOR_FRACTION * 100}%`,
            height: `${ANCHOR_FRACTION * 100}%`,
          }}
        >
          {(['top-left', 'top-right', 'bottom-left', 'bottom-right'] as const).map((corner) => (
            <div
              key={corner}
              className={[
                'absolute w-6 h-6 border-red-500 transition-colors',
                status === 'found-qr' || status === 'decoded'
                  ? 'border-green-500'
                  : status === 'found-blurry'
                    ? 'border-amber-500'
                    : 'border-red-500',
                corner === 'top-left' && 'top-0 left-0 border-t-2 border-l-2',
                corner === 'top-right' && 'top-0 right-0 border-t-2 border-r-2',
                corner === 'bottom-left' && 'bottom-0 left-0 border-b-2 border-l-2',
                corner === 'bottom-right' && 'bottom-0 right-0 border-b-2 border-r-2',
              ]
                .filter(Boolean)
                .join(' ')}
            />
          ))}
        </div>

        {flash && <div className="absolute inset-0 bg-white/20 pointer-events-none" />}

        <div className="absolute top-2 left-2 px-2 py-1 rounded text-xs font-medium bg-black/70 text-white">
          {status === 'starting' && 'Starting camera…'}
          {status === 'searching' && 'Align marker within the brackets…'}
          {status === 'found-blurry' && 'Hold steady — image too blurry/shaky…'}
          {status === 'found-qr' && mode === 'decode' && 'QR found — reading…'}
          {status === 'found-qr' && mode === 'ber' && 'QR found — measuring BER…'}
          {status === 'found-invalid' && 'QR read, but no valid payload — reading…'}
          {status === 'decoded' && 'Decoded ✓'}
          {status === 'error' && `Camera error: ${errorMsg}`}
        </div>

        <canvas ref={cropCanvasRef} className="hidden" />
      </div>

      <div>
        <p className="text-xs text-neutral-500 mb-1">Aligned/cropped region the decoder is reading:</p>
        <canvas ref={warpCanvasRef} className="border border-neutral-800 rounded w-40 h-40" />
      </div>

      {lastQuality && (
        <p className="text-[11px] text-neutral-600 font-mono">
          sharpness={lastQuality.sharpness.toFixed(1)} (min {DEFAULT_QUALITY_THRESHOLDS.minSharpness}) ·
          motion={lastQuality.motion?.toFixed(1) ?? '—'} (max {DEFAULT_QUALITY_THRESHOLDS.maxMotion}) ·
          rejected frames: {rejectedFrames}
        </p>
      )}

      {mode === 'decode' && invalidAttempts >= 5 && (
        <div className="border border-red-900/50 rounded p-3 bg-red-950/30 text-sm text-red-300">
          <p className="font-medium">QR detected repeatedly, but never a valid payload.</p>
          <p className="text-xs text-red-400/80 mt-1">
            This almost always means the coefficient pair set above doesn&apos;t match what was used
            to encode this marker — the filename auto-detect feature only works on the Upload path,
            not Scan, so double-check the coefficient pair matches the encoded filename exactly.
          </p>
          {lastQrText && (
            <p className="text-xs text-neutral-400 mt-2">
              QR visible text being read: <span className="font-mono">{lastQrText}</span>
            </p>
          )}
        </div>
      )}

      {mode === 'ber' && (
        <div className="border border-neutral-800 rounded-lg p-4 bg-neutral-950 space-y-4">
          <div>
            <p className="text-xs font-semibold text-neutral-200 mb-2">This frame</p>
            {currentBer ? (
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <p className="text-xs text-neutral-500">BER</p>
                  <p className="text-xl font-mono text-red-400">{(currentBer.ber * 100).toFixed(2)}%</p>
                </div>
                {currentCoeffDiff && (
                  <div>
                    <p className="text-xs text-neutral-500">Avg coeff diff (penalized)</p>
                    <p className="text-xl font-mono text-red-400">{currentCoeffDiff.averageDifference.toFixed(2)}</p>
                    <p className="text-[10px] text-neutral-600">{currentCoeffDiff.flippedBlocks} flipped</p>
                  </div>
                )}
              </div>
            ) : (
              <p className="text-xs text-neutral-500">No marker in frame right now.</p>
            )}
          </div>

          <div className="pt-3 border-t border-neutral-800">
            <div className="flex items-center justify-between mb-2">
              <p className="text-xs font-semibold text-neutral-200">
                Session best (lowest) · {framesAnalyzed} frame{framesAnalyzed === 1 ? '' : 's'} analyzed
              </p>
              <button onClick={resetSession} className="text-xs text-neutral-400 underline hover:text-red-400">
                Reset session
              </button>
            </div>
            <p className="text-xs text-neutral-500">Lowest BER</p>
            <p className="text-xl font-mono text-green-400">
              {lowestBer ? `${(lowestBer.ber * 100).toFixed(2)}%` : '—'}
            </p>
          </div>
        </div>
      )}
    </div>
  );
}
