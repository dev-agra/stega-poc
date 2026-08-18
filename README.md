# Covert Code

DCT-based image steganography: hide an 8-character secret in any RGB photo
at any resolution, protected with BCH(63,36,t=5) error correction and
PRNG-masked repetition. Output ships at the same resolution as the input.

## Pages

- `/` — landing page
- `/encode` — upload any image, set secret / strength (0–2000) / seed /
  DCT coefficient pair, download the watermarked PNG. The download filename
  encodes the seed + coefficient pair + strength used, e.g.
  `stego_seed-1585433294_c1-2x3_c2-3x4_str-120.png`.
- `/decode` — set the seed + coefficient pair (or let them auto-fill from a
  matching filename on upload), then either:
  - **Upload Image** — decode a file directly.
  - **Scan with Camera** — live camera feed, detects a QR code via `jsqr`,
    unwarps it back to a clean square via a homography computed from the
    QR's own 4 corner points, then runs the same DCT/BCH decode on that
    corrected region.

## Core library (`src/lib`)

- `gf.ts` — GF(2^6) field arithmetic (log/antilog tables)
- `bch.ts` — binary BCH(63,36,t=5) encoder/decoder (Berlekamp-Massey + Chien search)
- `prng.ts` — deterministic seedable mask generator (mulberry32) + XOR helpers
- `payloadCodec.ts` — message → BCH → repeat → PRNG-mask, and the reverse
  (unmask → per-copy BCH decode → majority vote), parameterized by seed/capacity
- `dct.ts` — 8×8 2D DCT/IDCT + differential coefficient bit embed/extract
- `resize.ts` — pure-JS bilinear resize (no canvas dependency, works in Node and browser)
- `color.ts` — RGB ↔ YCbCr conversion
- `imageStego.ts` — the resolution-independent pipeline: downsample to a
  256×256 canonical grid, embed via DCT into all 1024 blocks, reconstruct,
  compute the residual delta vs the original canonical image, upscale that
  delta back to native resolution, and superimpose it on the original —
  so output resolution always matches input resolution.
- `homography.ts` — projective transform (4-point DLT) + inverse-mapped
  bilinear warp, used to unwarp a camera-detected QR quad back to a square.
- `canvasUtils.ts` — browser canvas ↔ RGBA helpers (native-resolution upload/download).

## POC test flow for the camera-scan feature

QR generation is intentionally **not** part of the app UI for this POC — use
any QR generator, or the included helper script:

```bash
npx tsx scripts/generate-test-qr.ts "https://example.com/your-id" test-qr.png
```

**Important**: generate the QR with **zero margin** (no quiet-zone border in
the image file itself). `jsqr`'s corner detection targets the QR symbol
only, not a margin — if the uploaded image has extra white border around the
QR, the encoder's canonical grid (which spans the *whole* uploaded image)
won't spatially match what the camera-scan path detects and unwarps at
decode time, and BCH copies will fail to align. Confirmed via
`scripts/test-full-pipeline.ts`: zero-margin QR gives a working end-to-end
camera-scan decode; nonzero margin breaks it.

Then:
1. Upload `test-qr.png` to `/encode`, set your secret, download the result.
2. Print the downloaded PNG.
3. Open `/decode` on your phone, set the same seed + coefficient pair
   (or just don't rename the file before re-uploading it once to confirm,
   then note the values for the camera flow), choose **Scan with Camera**,
   and point at the printout.

## Verified behavior (`scripts/test-*.ts`)

- BCH(63,36,t=5): 200/200 correct with 0–5 injected errors; correctly
  rejects over-limit corruption and pure-random noise as "no valid payload"
  rather than decoding to garbage.
- Resolution independence: 256×256, 512×512, 1024×768, 100×100, 800×450 all
  round-trip correctly, output resolution always equals input resolution.
- Strength 0–2000 all decode correctly; visible distortion scales roughly
  linearly with strength (mean |Δpixel| ~0.5 at strength 10, ~77 at strength 2000).
- Wrong seed and strength=0 are both correctly rejected rather than
  misdecoding.
- Full real-QR pipeline (`test-full-pipeline.ts`): generates a real QR,
  encodes a secret into it, confirms the QR still scans, simulates an
  off-angle camera capture, runs jsQR + homography unwarp, and recovers the
  exact secret — end to end, no manual alignment.

## Known limitations / next steps

- Camera-scan robustness is currently tight (as low as 1/8 valid BCH copies
  survived in the simulated-distortion test) — still enough to recover the
  message via majority vote, but worth increasing strength or improving
  corner-detection precision for production use.
- No live "value has changed, re-scanning" UX polish yet — scan stops on
  first successful decode.
- Reed-Solomon as an alternative/upgrade path to BCH is not yet implemented.

## Deploy

```bash
npm install
npm run build
vercel deploy
```
