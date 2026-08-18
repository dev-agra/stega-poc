import Link from "next/link";

export default function Home() {
  return (
    <main className="max-w-3xl mx-auto px-6 py-16">
      <div className="relative overflow-hidden rounded-lg border border-neutral-800 mb-10">
        <div className="absolute inset-0 mosaic-accent" />
        <div className="relative px-8 py-12">
          <h1 className="text-4xl font-bold text-neutral-50 tracking-tight">Covert Code</h1>
          <p className="text-sm text-neutral-400 mt-3 max-w-md leading-relaxed">
            Frequency-domain image watermarking. Hide an 8-character message inside any photo
            using DCT coefficient encoding, protected with BCH error correction so corrupted or
            unwatermarked images are rejected rather than misread.
          </p>
        </div>
        <div className="h-1 w-full stripe-accent" />
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        <Link
          href="/encode"
          className="group border border-neutral-800 rounded-lg p-6 hover:border-red-600 transition-colors"
        >
          <h2 className="text-lg font-semibold text-neutral-50 group-hover:text-red-400">Encode</h2>
          <p className="text-sm text-neutral-500 mt-2 leading-relaxed">
            Upload any image, any resolution. Set your secret, strength, seed, and coefficient pair.
          </p>
        </Link>
        <Link
          href="/decode"
          className="group border border-neutral-800 rounded-lg p-6 hover:border-red-600 transition-colors"
        >
          <h2 className="text-lg font-semibold text-neutral-50 group-hover:text-red-400">Decode</h2>
          <p className="text-sm text-neutral-500 mt-2 leading-relaxed">
            Upload an image, or scan a printed marker live with your camera.
          </p>
        </Link>
      </div>
    </main>
  );
}
