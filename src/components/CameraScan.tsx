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

export default function CameraScan({ decodeOpts, onResult }: Props) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const warpCanvasRef = useRef<HTMLCanvasElement>(null);
  const [status, setStatus] = useState<'starting' | 'searching' | 'found-qr' | 'decoded' | 'error'>('starting');
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const rafRef = useRef<number | null>(null);
  const streamRef = useRef<MediaStream | null>(null);

  useEffect(() => {
    let cancelled = false;

    async function start() {
      try {
        const stream = await navigator.mediaDevices.getUserMedia({
          video: { facingMode: 'environment' },
        });
        if (cancelled) {
          stream.getTracks().forEach((t) => t.stop());
          return;
        }
        streamRef.current = stream;
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
      const canvas = canvasRef.current;
      if (!video || !canvas || video.readyState !== video.HAVE_ENOUGH_DATA) {
        rafRef.current = requestAnimationFrame(tick);
        return;
      }

      canvas.width = video.videoWidth;
      canvas.height = video.videoHeight;
      const ctx = canvas.getContext('2d')!;
      ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
      const frame = ctx.getImageData(0, 0, canvas.width, canvas.height);

      const qr = jsQR(frame.data, frame.width, frame.height, { inversionAttempts: 'dontInvert' });

      if (qr) {
        setStatus('found-qr');
        const { topLeftCorner, topRightCorner, bottomRightCorner, bottomLeftCorner } = qr.location;

        const warped = warpQuadToSquare(
          { width: frame.width, height: frame.height, data: frame.data },
          [topLeftCorner, topRightCorner, bottomRightCorner, bottomLeftCorner],
          WARP_SIZE
        );

        // show what the decoder is actually looking at
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
      streamRef.current?.getTracks().forEach((t) => t.stop());
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <div className="space-y-3">
      <div className="relative border border-neutral-800 rounded overflow-hidden bg-black">
        <video ref={videoRef} className="w-full max-h-[70vh] object-contain" playsInline muted />
        <canvas ref={canvasRef} className="hidden" />
        <div className="absolute top-2 left-2 px-2 py-1 rounded text-xs font-medium bg-black/70 text-white">
          {status === 'starting' && 'Starting camera…'}
          {status === 'searching' && 'Point at marker…'}
          {status === 'found-qr' && 'QR found — reading…'}
          {status === 'decoded' && 'Decoded ✓'}
          {status === 'error' && `Camera error: ${errorMsg}`}
        </div>
      </div>
      <div>
        <p className="text-xs text-neutral-500 mb-1">Aligned/cropped region the decoder is reading:</p>
        <canvas ref={warpCanvasRef} className="border border-neutral-800 rounded w-40 h-40" />
      </div>
    </div>
  );
}
