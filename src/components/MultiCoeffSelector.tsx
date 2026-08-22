'use client';

import { useState } from 'react';
import type { CoeffPos } from '@/lib/dct';
import type { LayerSpec } from '@/lib/multiEncode';

interface Props {
  layers: LayerSpec[];
  onChange: (layers: LayerSpec[]) => void;
}

export default function MultiCoeffSelector({ layers, onChange }: Props) {
  const [pending1, setPending1] = useState<CoeffPos>({ u: 0, v: 1 });
  const [pending2, setPending2] = useState<CoeffPos>({ u: 1, v: 0 });

  function handleCellClick(u: number, v: number) {
    const isPending1 = pending1.u === u && pending1.v === v;
    const isPending2 = pending2.u === u && pending2.v === v;
    if (isPending1 || isPending2) return;
    setPending1({ u, v });
    setPending2(pending1);
  }

  function addLayer() {
    onChange([...layers, { coeff1: pending1, coeff2: pending2 }]);
  }

  function removeLayer(index: number) {
    onChange(layers.filter((_, i) => i !== index));
  }

  return (
    <div className="space-y-4">
      <div>
        <p className="text-sm font-medium text-neutral-200 mb-2">
          Stage a coefficient pair, then add it as the next layer
        </p>
        <div className="flex items-start gap-4">
          <div className="inline-grid grid-cols-8 gap-1 bg-black p-2 rounded border border-neutral-800">
            {Array.from({ length: 8 }).map((_, u) =>
              Array.from({ length: 8 }).map((_, v) => {
                const isPending1 = pending1.u === u && pending1.v === v;
                const isPending2 = pending2.u === u && pending2.v === v;
                return (
                  <button
                    key={`${u}-${v}`}
                    onClick={() => handleCellClick(u, v)}
                    className={[
                      'w-9 h-9 text-[10px] font-mono rounded flex items-center justify-center transition-colors',
                      isPending1
                        ? 'bg-red-600 text-white font-semibold'
                        : isPending2
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

          <button
            onClick={addLayer}
            title="Add this pair as the next layer"
            className="flex flex-col items-center justify-center w-14 h-14 rounded-full border-2 border-red-600 text-red-500 hover:bg-red-950/40 transition-colors text-2xl font-bold shrink-0 mt-1"
          >
            +
          </button>
        </div>
        <p className="text-xs text-neutral-500 mt-2">
          Staged: <span className="font-mono text-red-400">({pending1.u},{pending1.v})</span> vs{' '}
          <span className="font-mono text-neutral-300">({pending2.u},{pending2.v})</span>
        </p>
      </div>

      {layers.length > 0 && (
        <div>
          <p className="text-sm font-medium text-neutral-200 mb-2">
            Layers ({layers.length}) — applied in order, each on top of the previous layer&apos;s output
          </p>
          <div className="space-y-1.5">
            {layers.map((layer, i) => (
              <div
                key={i}
                className="flex items-center justify-between border border-neutral-800 rounded px-3 py-2 bg-neutral-950"
              >
                <span className="text-sm text-neutral-300">
                  <span className="text-neutral-500 font-mono">L{i + 1}</span>{' '}
                  <span className="font-mono text-red-400">({layer.coeff1.u},{layer.coeff1.v})</span> vs{' '}
                  <span className="font-mono text-neutral-300">({layer.coeff2.u},{layer.coeff2.v})</span>
                </span>
                <button
                  onClick={() => removeLayer(i)}
                  className="text-xs text-neutral-500 hover:text-red-400"
                >
                  remove
                </button>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
