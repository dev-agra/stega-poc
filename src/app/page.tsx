import Link from "next/link";

export default function Home() {
  return (
    <main className="max-w-3xl mx-auto p-8 space-y-8 relative z-10">
      <div>
        <h1 className="text-4xl font-bold text-red-500 tracking-tight">▓▓ COVERT CODE ▓▓</h1>
        <p className="text-sm text-neutral-400 mt-2">
          DCT frequency-domain steganography · BCH(63,36,t=5) error correction · PRNG-masked repetition
        </p>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <div className="border border-red-900/50 rounded p-5 bg-black/40 space-y-3">
          <h2 className="text-lg font-bold text-red-400">Any-Resolution Image</h2>
          <p className="text-xs text-neutral-500">
            Upload any RGB photo, any resolution. Output ships at the same resolution. Configurable
            strength (0–2000), seed, and DCT coefficient pair.
          </p>
          <div className="flex gap-3">
            <Link href="/image-encode" className="px-4 py-2 rounded bg-red-600 text-white text-sm font-semibold hover:bg-red-500">
              Encode
            </Link>
            <Link href="/image-decode" className="px-4 py-2 rounded border border-neutral-700 text-sm hover:border-red-500">
              Decode
            </Link>
          </div>
        </div>

        <div className="border border-neutral-800 rounded p-5 bg-black/40 space-y-3">
          <h2 className="text-lg font-bold text-neutral-300">QR Marker (37×37)</h2>
          <p className="text-xs text-neutral-500">
            Embeds the payload directly into a scannable QR code&apos;s non-reserved modules — output
            stays a valid, scannable QR.
          </p>
          <div className="flex gap-3">
            <Link href="/generate" className="px-4 py-2 rounded bg-neutral-800 text-white text-sm font-semibold hover:bg-neutral-700">
              Generate
            </Link>
            <Link href="/decode" className="px-4 py-2 rounded border border-neutral-700 text-sm hover:border-red-500">
              Decode
            </Link>
          </div>
        </div>
      </div>
    </main>
  );
}
