export function lumaGridToImageData(luma: Float64Array[], size: number): ImageData {
  const imgData = new ImageData(size, size);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const v = Math.min(255, Math.max(0, Math.round(luma[y][x])));
      const idx = (y * size + x) * 4;
      imgData.data[idx] = v;
      imgData.data[idx + 1] = v;
      imgData.data[idx + 2] = v;
      imgData.data[idx + 3] = 255;
    }
  }
  return imgData;
}

/** Load a File into an HTMLImageElement. */
export function loadImageFile(file: File): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    const reader = new FileReader();
    reader.onload = (e) => {
      img.onload = () => resolve(img);
      img.onerror = reject;
      img.src = e.target?.result as string;
    };
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}

/**
 * Draw an arbitrary image into a canonical square canvas of `size` px
 * (nearest-neighbor is NOT forced here since a captured/uploaded photo of a
 * printed marker is continuous-tone; this is a simple resize, not a
 * perspective-correcting alignment step yet).
 */
export function imageToLumaGrid(img: HTMLImageElement, size: number): Float64Array[] {
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext('2d')!;
  ctx.drawImage(img, 0, 0, size, size);
  const imgData = ctx.getImageData(0, 0, size, size);
  const luma: Float64Array[] = Array.from({ length: size }, () => new Float64Array(size));
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const idx = (y * size + x) * 4;
      const r = imgData.data[idx];
      const g = imgData.data[idx + 1];
      const b = imgData.data[idx + 2];
      luma[y][x] = 0.299 * r + 0.587 * g + 0.114 * b;
    }
  }
  return luma;
}
