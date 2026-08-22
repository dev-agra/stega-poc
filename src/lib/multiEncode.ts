import JSZip from 'jszip';
import { encodeImage, type RgbaImage } from './imageStego';
import type { CoeffPos } from './dct';

export interface LayerSpec {
  coeff1: CoeffPos;
  coeff2: CoeffPos;
}

export interface LayerResult {
  layerIndex: number; // 1-indexed
  coeff1: CoeffPos;
  coeff2: CoeffPos;
  image: RgbaImage; // cumulative result up through this layer
}

/**
 * Cascade encodeImage once per layer spec: layer N's input is layer N-1's
 * output (layer 1's input is the original base image). Same secret/seed/
 * strength used for every layer - only the coefficient pair varies.
 */
export function runMultiLayerEncode(
  baseImage: RgbaImage,
  secret8: string,
  seed: number,
  strength: number,
  layers: LayerSpec[]
): LayerResult[] {
  const results: LayerResult[] = [];
  let current = baseImage;

  for (let i = 0; i < layers.length; i++) {
    const { coeff1, coeff2 } = layers[i];
    const encoded = encodeImage(current, secret8, { strength, seed, coeff1, coeff2 });
    results.push({ layerIndex: i + 1, coeff1, coeff2, image: encoded.image });
    current = encoded.image;
  }

  return results;
}

function rgbaToBase64Png(image: RgbaImage): string {
  const canvas = document.createElement('canvas');
  canvas.width = image.width;
  canvas.height = image.height;
  const ctx = canvas.getContext('2d')!;
  const imgData = ctx.createImageData(image.width, image.height);
  imgData.data.set(image.data);
  ctx.putImageData(imgData, 0, 0);
  const dataUrl = canvas.toDataURL('image/png');
  return dataUrl.split(',')[1];
}

/**
 * Package every layer's cumulative output into a ZIP, plus an explicit
 * "final" copy of the last layer's result.
 */
export async function multiLayerResultsToZip(results: LayerResult[]): Promise<Blob> {
  const zip = new JSZip();

  for (const r of results) {
    const base64 = rgbaToBase64Png(r.image);
    const fileName = `layer-${r.layerIndex}_c1-${r.coeff1.u}x${r.coeff1.v}_c2-${r.coeff2.u}x${r.coeff2.v}.png`;
    zip.file(fileName, base64, { base64: true });
  }

  if (results.length > 0) {
    const last = results[results.length - 1];
    const base64 = rgbaToBase64Png(last.image);
    zip.file(`final_${results.length}-layers.png`, base64, { base64: true });
  }

  return zip.generateAsync({ type: 'blob' });
}

/** Check whether any two layers share a coefficient position (allowed, but degrades that earlier layer's margin). */
export function findCoefficientCollisions(layers: LayerSpec[]): string[] {
  const warnings: string[] = [];
  const seen = new Map<string, number>(); // "u,v" -> first layer index (1-indexed) that used it

  for (let i = 0; i < layers.length; i++) {
    const { coeff1, coeff2 } = layers[i];
    for (const c of [coeff1, coeff2]) {
      const key = `${c.u},${c.v}`;
      const firstLayer = seen.get(key);
      if (firstLayer !== undefined && firstLayer !== i + 1) {
        warnings.push(
          `Coefficient (${c.u},${c.v}) is used in both layer ${firstLayer} and layer ${i + 1} - the later layer will partially overwrite the earlier one's margin.`
        );
      } else {
        seen.set(key, i + 1);
      }
    }
  }

  return warnings;
}
