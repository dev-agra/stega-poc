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
      <p className="text-sm font-medium text-neutral-200 mb-2">DCT coefficient pair</p>
      <p className="text-xs text-neutral-500 mb-3">
        Click cells to set{' '}
        <span className="inline-block px-2 py-0.5 rounded bg-red-600 text-white text-xs font-medium">
          Coeff 1
        </span>{' '}
        and{' '}
        <span className="inline-block px-2 py-0.5 rounded bg-neutral-700 text-neutral-200 text-xs font-medium">
          Coeff 2
        </span>
      </p>
      <div className="inline-grid grid-cols-8 gap-1 bg-black p-2 rounded border border-neutral-800">
        {Array.from({ length: 8 }).map((_, u) =>
          Array.from({ length: 8 }).map((_, v) => {
            const isCoeff1 = coeff1.u === u && coeff1.v === v;
            const isCoeff2 = coeff2.u === u && coeff2.v === v;
            return (
              <button
                key={`${u}-${v}`}
                onClick={() => handleClick(u, v)}
                className={[
                  'w-9 h-9 text-[10px] font-mono rounded flex items-center justify-center transition-colors',
                  isCoeff1
                    ? 'bg-red-600 text-white font-semibold'
                    : isCoeff2
                      ? 'bg-neutral-700 text-neutral-100 font-semibold'
                      : 'bg-neutral-900 text-neutral-500 hover:bg-neutral-800',
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
