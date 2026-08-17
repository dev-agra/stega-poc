import Link from "next/link";

export default function Home() {
  return (
    <main className="max-w-2xl mx-auto p-8 space-y-6">
      <h1 className="text-2xl font-semibold">Covert Code — QR Steganography POC</h1>
      <p className="text-sm text-neutral-600">
        DCT-based watermarking of QR code modules, protected with BCH(63,36,t=5)
        error correction and PRNG-masked repetition.
      </p>
      <div className="flex gap-4">
        <Link href="/generate" className="px-4 py-2 rounded bg-black text-white">
          Generate / Encode
        </Link>
        <Link href="/decode" className="px-4 py-2 rounded border">
          Decode
        </Link>
      </div>
    </main>
  );
}
