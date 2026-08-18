'use client';

import type { CoeffPos } from '@/lib/dct';

interface Props {
  coeff1: CoeffPos;
  coeff2: CoeffPos;
  onChange: (coeff1: CoeffPos, coeff2: CoeffPos) => void;
}

// Which coefficient slot the *next* click will set. Simple toggle: after
// coeff1 is set, next click sets coeff2; after both set, next click resets
// coeff1 (so the user can always just keep clicking to redefine).
export default function CoeffGridSelector({ coeff1, coeff2, onChange }: Props) {
  function handleClick(u: number, v: number) {
    const isCoeff1 = coeff1.u === u && coeff1.v === v;
    const isCoeff2 = coeff2.u === u && coeff2.v === v;
    if (isCoeff1 || isCoeff2) return; // no-op on already-selected cell

    // Simple rule: clicking always replaces coeff1, and the *previous*
    // coeff1 slides into coeff2. Keeps exactly 2 always selected.
    onChange({ u, v }, coeff1);
  }

  return (
    <div>
      <p className="text-sm text-red-500 font-semibold mb-2 tracking-wide uppercase">
        Select DCT Coefficient Pair
      </p>
      <p className="text-xs text-neutral-400 mb-3">
        Click cells to set{' '}
        <span className="inline-block px-2 py-0.5 rounded bg-red-600 text-white font-mono text-xs">
          Coeff 1
        </span>{' '}
        and{' '}
        <span className="inline-block px-2 py-0.5 rounded bg-neutral-700 text-red-300 font-mono text-xs">
          Coeff 2
        </span>
      </p>
      <div className="inline-grid grid-cols-8 gap-1 bg-black p-2 rounded border border-red-900">
        {Array.from({ length: 8 }).map((_, u) =>
          Array.from({ length: 8 }).map((_, v) => {
            const isCoeff1 = coeff1.u === u && coeff1.v === v;
            const isCoeff2 = coeff2.u === u && coeff2.v === v;
            return (
              <button
                key={`${u}-${v}`}
                onClick={() => handleClick(u, v)}
                className={[
                  'w-10 h-10 text-[10px] font-mono rounded flex items-center justify-center transition-colors',
                  isCoeff1
                    ? 'bg-red-600 text-white font-bold ring-2 ring-red-400'
                    : isCoeff2
                      ? 'bg-neutral-700 text-red-300 font-bold ring-2 ring-neutral-500'
                      : 'bg-neutral-900 text-neutral-500 hover:bg-neutral-800 hover:text-red-400',
                ].join(' ')}
              >
                {u},{v}
              </button>
            );
          })
        )}
      </div>
    </div>
  );
}
