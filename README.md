# Covert Code — QR Steganography POC

DCT-based watermarking system: embeds an 8-character secret payload directly
into the non-reserved (data) modules of a standard 37x37 (version 5) QR code,
protected with BCH(63,36,t=5) error correction and PRNG-masked repetition.

## How it works

- `src/lib/gf.ts` — GF(2^6) field arithmetic (log/antilog tables)
- `src/lib/bch.ts` — binary BCH(63,36,t=5) encoder/decoder (Berlekamp-Massey + Chien search)
- `src/lib/prng.ts` — deterministic seedable mask generator (mulberry32) + XOR helpers
- `src/lib/dct.ts` — 8x8 2D DCT/IDCT + differential coefficient bit embed/extract
- `src/lib/marker.ts` — ties it together: QR generation (via `qrcode`), maps
  each QR module 1:1 to an 8x8 DCT block (`PX_PER_MODULE = 8`, canonical grid
  = 37*8 = 296px), embeds only into modules the QR spec doesn't reserve for
  finder/timing/format/alignment patterns, and majority-votes across repeated
  BCH copies on decode.
- `src/lib/canvasUtils.ts` — browser canvas <-> luma grid conversions.

## Pages

- `/generate` — enter QR text + 8-char secret + embedding strength, get a
  watermarked PNG. Uses `jsqr`-verified-safe defaults (see `scripts/test-strength.ts`).
- `/decode` — upload an image, decode the hidden payload. **Current
  limitation**: resizes the upload directly to the canonical grid; it does
  NOT yet do fiducial detection / perspective correction for off-angle camera
  captures. Works well on straight, cropped screenshots or flat-on photos.

## Verified behavior (see `scripts/test-*.ts`)

- BCH(63,36,t=5) correctly encodes/decodes up to 5 bit errors per 63-bit
  codeword; over-limit and pure-random inputs are correctly rejected as
  "no valid payload" rather than returning garbage.
- End-to-end encode->decode recovers the exact message with zero distortion,
  and the QR remains scannable by `jsqr` even up to very high embedding
  strengths (500+) — though very high strength introduces visible ripple
  artifacts inside otherwise-solid QR modules, since there's no photographic
  texture to hide the perturbation under. **40–80 is a reasonable default.**
- Robustness sweep: message survives ±10 luma noise per pixel with zero bit
  errors; degrades gracefully (partial BCH correction) up to ±20; fails
  cleanly (reports "no valid payload") beyond that rather than misdecoding.

## Not yet implemented (next steps)

- Mobile camera capture pipeline (multi-frame capture, live preview)
- Fiducial-based perspective/alignment correction (ECC image alignment) for
  real camera captures at an angle
- Reed-Solomon as an alternative/upgrade path to BCH

## Deploy

```bash
npm install
npm run build
vercel deploy
```
