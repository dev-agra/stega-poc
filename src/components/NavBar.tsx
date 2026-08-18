import Link from 'next/link';

export default function NavBar() {
  return (
    <header className="sticky top-0 z-20 bg-black/90 backdrop-blur border-b border-neutral-800">
      <div className="h-1 w-full stripe-accent" />
      <nav className="max-w-3xl mx-auto px-6 py-3 flex items-center justify-between">
        <Link href="/" className="text-sm font-semibold text-neutral-100 tracking-tight hover:text-red-400">
          Covert Code
        </Link>
        <div className="flex gap-5 text-sm">
          <Link href="/encode" className="text-neutral-300 hover:text-red-400 transition-colors">
            Encode
          </Link>
          <Link href="/decode" className="text-neutral-300 hover:text-red-400 transition-colors">
            Decode
          </Link>
        </div>
      </nav>
    </header>
  );
}
