import Papa from 'papaparse';
import JSZip from 'jszip';
import { encodeImage, type RgbaImage } from './imageStego';
import type { CoeffPos } from './dct';

export interface BulkRow {
  rowNumber: number; // 1-indexed, matches CSV row order
  coeff1: CoeffPos;
  coeff2: CoeffPos;
  strength: number;
}

export interface BulkParseResult {
  rows: BulkRow[];
  errors: string[];
}

/** Parse a "u,v" or "u x v" or "u-v" style cell into a CoeffPos. */
function parseCoeffCell(cell: string): CoeffPos | null {
  const match = cell.trim().match(/(\d+)\s*[,x\-]\s*(\d+)/i);
  if (!match) return null;
  const u = Number(match[1]);
  const v = Number(match[2]);
  if (u < 0 || u > 7 || v < 0 || v > 7) return null;
  return { u, v };
}

/**
 * Parse a CSV with columns C1, C2, Strength (header names case-insensitive,
 * order-independent). Each row's C1/C2 cells hold a coefficient pair like
 * "2,3"; Strength is a plain number.
 */
export function parseBulkCsv(csvText: string): BulkParseResult {
  const parsed = Papa.parse<Record<string, string>>(csvText, {
    header: true,
    skipEmptyLines: true,
    transformHeader: (h) => h.trim().toLowerCase(),
  });

  const errors: string[] = [];
  const rows: BulkRow[] = [];

  if (parsed.errors.length > 0) {
    for (const e of parsed.errors) errors.push(`CSV parse error: ${e.message} (row ${e.row ?? '?'})`);
  }

  parsed.data.forEach((record, i) => {
    const rowNumber = i + 1;
    const c1Raw = record['c1'];
    const c2Raw = record['c2'];
    const strengthRaw = record['strength'];

    if (!c1Raw || !c2Raw || !strengthRaw) {
      errors.push(`Row ${rowNumber}: missing C1, C2, or Strength column`);
      return;
    }

    const coeff1 = parseCoeffCell(c1Raw);
    const coeff2 = parseCoeffCell(c2Raw);
    const strength = Number(strengthRaw.trim());

    if (!coeff1) {
      errors.push(`Row ${rowNumber}: could not parse C1 "${c1Raw}" as a coefficient pair (expected e.g. "2,3")`);
      return;
    }
    if (!coeff2) {
      errors.push(`Row ${rowNumber}: could not parse C2 "${c2Raw}" as a coefficient pair (expected e.g. "3,4")`);
      return;
    }
    if (!Number.isFinite(strength) || strength < 0) {
      errors.push(`Row ${rowNumber}: invalid Strength "${strengthRaw}"`);
      return;
    }

    rows.push({ rowNumber, coeff1, coeff2, strength });
  });

  return { rows, errors };
}

export interface BulkEncodeProgress {
  completed: number;
  total: number;
  currentRow: number;
}

/**
 * Run encodeImage once per CSV row (same base image + secret + seed across
 * all rows, only coeff1/coeff2/strength vary per row), and zip the results.
 */
export async function bulkEncodeToZip(
  baseImage: RgbaImage,
  secret8: string,
  seed: number,
  rows: BulkRow[],
  onProgress?: (progress: BulkEncodeProgress) => void
): Promise<Blob> {
  const zip = new JSZip();

  for (let i = 0; i < rows.length; i++) {
    const row = rows[i];
    const result = encodeImage(baseImage, secret8, {
      strength: row.strength,
      seed,
      coeff1: row.coeff1,
      coeff2: row.coeff2,
    });

    const canvas = document.createElement('canvas');
    canvas.width = result.image.width;
    canvas.height = result.image.height;
    const ctx = canvas.getContext('2d')!;
    const imgData = ctx.createImageData(result.image.width, result.image.height);
    imgData.data.set(result.image.data);
    ctx.putImageData(imgData, 0, 0);

    const dataUrl = canvas.toDataURL('image/png');
    const base64 = dataUrl.split(',')[1];

    const fileName = `row-${row.rowNumber}_seed-${seed}_c1-${row.coeff1.u}x${row.coeff1.v}_c2-${row.coeff2.u}x${row.coeff2.v}_str-${row.strength}.png`;
    zip.file(fileName, base64, { base64: true });

    onProgress?.({ completed: i + 1, total: rows.length, currentRow: row.rowNumber });

    // yield to the event loop periodically so the UI/progress indicator can repaint
    if (i % 5 === 0) {
      await new Promise((resolve) => setTimeout(resolve, 0));
    }
  }

  return zip.generateAsync({ type: 'blob' });
}
