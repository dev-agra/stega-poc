'use client';

import { useEffect, useRef, useState } from 'react';
import jsQR from 'jsqr';
import { warpQuadToSquare } from '@/lib/homography';
import { decodeImage, type DecodeOptions, type DecodeResult } from '@/lib/imageStego';

interface Props {
  decodeOpts: DecodeOptions;
  onResult: (result: DecodeResult, qrText: string) => void;
}

const WARP_SIZE = 320;
// Working resolution we crop the anchor region down to before running jsQR.
// Small on purpose: jsQR cost scales with pixel count, and we only ever
// need to search inside the anchor box, not the whole camera frame.
const CROP_SIZE = 400;
// Fraction of the (square, object-cover) video preview the anchor box covers.
const ANCHOR_FRACTION = 0.78;

export default function CameraScan({ decodeOpts, onResult }: Props) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const cropCanvasRef = useRef<HTMLCanvasElement>(null);
  const warpCanvasRef = useRef<HTMLCanvasElement>(null);
  const [status, setStatus] = useState<'starting' | 'searching' | 'found-qr' | 'decoded' | 'error'>('starting');
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [flash, setFlash] = useState(false);
  const rafRef = useRef<number | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const flashTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

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

        // Some browsers only honor advanced photo constraints (white
        // balance, exposure) via an explicit applyConstraints call on the
        // track, not through the initial getUserMedia video constraints.
        // Best-effort only — silently ignored where unsupported.
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

      // The preview container is a square using object-cover, so the video's
      // centered square crop (side = min(vw,vh)) is what's actually visible.
      // The anchor box is a further centered ANCHOR_FRACTION of that square.
      // Map both down to native video pixel coordinates.
      const visibleSide = Math.min(vw, vh);
      const visibleX = (vw - visibleSide) / 2;
      const visibleY = (vh - visibleSide) / 2;
      const anchorSide = visibleSide * ANCHOR_FRACTION;
      const anchorX = visibleX + (visibleSide - anchorSide) / 2;
      const anchorY = visibleY + (visibleSide - anchorSide) / 2;

      cropCanvas.width = CROP_SIZE;
      cropCanvas.height = CROP_SIZE;
      const cropCtx = cropCanvas.getContext('2d')!;
      // Single drawImage call crops directly from the video's native anchor
      // region and scales it to CROP_SIZE - no full-frame read needed.
      cropCtx.drawImage(video, anchorX, anchorY, anchorSide, anchorSide, 0, 0, CROP_SIZE, CROP_SIZE);
      const cropped = cropCtx.getImageData(0, 0, CROP_SIZE, CROP_SIZE);

      const qr = jsQR(cropped.data, CROP_SIZE, CROP_SIZE, { inversionAttempts: 'attemptBoth' });

      if (qr) {
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

        const result = decodeImage(warped, decodeOpts);
        if (result.validCopies > 0) {
          setStatus('decoded');
          onResult(result, qr.data);
          return; // stop scanning once decoded
        }
      } else {
        setStatus('searching');
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
  }, []);

  return (
    <div className="space-y-3">
      <div className="relative aspect-square w-full max-w-sm mx-auto border border-neutral-800 rounded overflow-hidden bg-black">
        <video ref={videoRef} className="absolute inset-0 w-full h-full object-cover" playsInline muted />

        {/* Anchor box overlay: corner brackets marking where to place the marker */}
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
                status === 'found-qr' || status === 'decoded' ? 'border-green-500' : 'border-red-500',
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

        {/* Capture flash feedback */}
        {flash && <div className="absolute inset-0 bg-white/20 pointer-events-none" />}

        <div className="absolute top-2 left-2 px-2 py-1 rounded text-xs font-medium bg-black/70 text-white">
          {status === 'starting' && 'Starting camera…'}
          {status === 'searching' && 'Align marker within the brackets…'}
          {status === 'found-qr' && 'QR found — reading…'}
          {status === 'decoded' && 'Decoded ✓'}
          {status === 'error' && `Camera error: ${errorMsg}`}
        </div>

        <canvas ref={cropCanvasRef} className="hidden" />
      </div>

      <div>
        <p className="text-xs text-neutral-500 mb-1">Aligned/cropped region the decoder is reading:</p>
        <canvas ref={warpCanvasRef} className="border border-neutral-800 rounded w-40 h-40" />
      </div>
    </div>
  );
}
