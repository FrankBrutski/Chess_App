/** A square crop in image pixels. */
export interface Crop { x: number; y: number; size: number }

/**
 * Guess where the chessboard is in a screenshot. Works on a small greyscale copy:
 * a board is the square whose 8×8 cells alternate light and dark the most.
 * Pieces add noise but the checker pattern still wins on normal 2D boards.
 */
export function findBoard(lum: Float32Array, w: number, h: number): Crop {
  // Integral image for O(1) cell means.
  const I = new Float64Array((w + 1) * (h + 1));
  for (let y = 0; y < h; y++) {
    let row = 0;
    for (let x = 0; x < w; x++) {
      row += lum[y * w + x];
      I[(y + 1) * (w + 1) + x + 1] = I[y * (w + 1) + x + 1] + row;
    }
  }
  const sum = (x0: number, y0: number, x1: number, y1: number) =>
    I[y1 * (w + 1) + x1] - I[y0 * (w + 1) + x1] - I[y1 * (w + 1) + x0] + I[y0 * (w + 1) + x0];

  const short = Math.min(w, h);
  const scoreAt = (x: number, y: number, size: number, padFrac: number) => {
    const cell = size / 8;
    const pad = cell * padFrac; // only the inner part of each cell, so borders and coordinates matter less
    let alt = 0;
    for (let r = 0; r < 8; r++) {
      for (let c = 0; c < 8; c++) {
        const x0 = Math.round(x + c * cell + pad);
        const y0 = Math.round(y + r * cell + pad);
        const x1 = Math.round(x + (c + 1) * cell - pad);
        const y1 = Math.round(y + (r + 1) * cell - pad);
        const m = sum(x0, y0, x1, y1) / Math.max(1, (x1 - x0) * (y1 - y0));
        alt += (r + c) % 2 ? -m : m;
      }
    }
    // Prefer bigger squares a little: a 2×2 block inside the board alternates just as well.
    return Math.abs(alt) / 64 + size * 1e-4;
  };
  let best: Crop & { score: number } = { x: 0, y: Math.max(0, Math.round((h - short) / 2)), size: short, score: -Infinity };
  const minSize = Math.max(16, Math.round(short * 0.45));
  const step = Math.max(1, Math.round(short / 100));
  // Coarse pass over sizes and positions...
  for (let size = short; size >= minSize; size -= step) {
    for (let y = 0; y + size <= h; y += step) {
      for (let x = 0; x + size <= w; x += step) {
        const score = scoreAt(x, y, size, 0.2);
        if (score > best.score) best = { x, y, size, score };
      }
    }
  }
  // ...then a fine pass around the winner that lines up the grid: the 7 inner lines in each
  // direction sit exactly where light and dark squares meet, so the brightness jumps there.
  const at = (x: number, y: number) => lum[Math.min(h - 1, Math.max(0, y)) * w + Math.min(w - 1, Math.max(0, x))];
  const gridScore = (x: number, y: number, size: number) => {
    const cell = size / 8;
    let e = 0;
    for (let k = 1; k < 8; k++) {
      const gx = Math.round(x + k * cell);
      const gy = Math.round(y + k * cell);
      for (let t = 0; t < size; t++) {
        e += Math.abs(at(gx, y + t) - at(gx - 1, y + t));
        e += Math.abs(at(x + t, gy) - at(x + t, gy - 1));
      }
    }
    return e / (14 * size);
  };
  const coarse = best;
  best = { ...coarse, score: -Infinity };
  const RS = Math.ceil(coarse.size / 12) + step; // size
  const R = Math.ceil(coarse.size / 16) + step; // position: up to half a square
  for (let size = Math.min(short, coarse.size + RS); size >= Math.max(minSize, coarse.size - RS); size--) {
    for (let y = Math.max(0, coarse.y - R); y <= Math.min(h - size, coarse.y + R); y++) {
      for (let x = Math.max(0, coarse.x - R); x <= Math.min(w - size, coarse.x + R); x++) {
        const score = scoreAt(x, y, size, 0.1) * 0.25 + gridScore(x, y, size);
        if (score > best.score) best = { x, y, size, score };
      }
    }
  }
  return { x: best.x, y: best.y, size: best.size };
}

/** Run findBoard on an image (scaled down to `work` pixels wide), and return the crop in full-size pixels. */
export async function guessBoard(img: ImageBitmap | HTMLImageElement, work = 120): Promise<Crop> {
  const W = 'naturalWidth' in img ? img.naturalWidth : img.width;
  const H = 'naturalHeight' in img ? img.naturalHeight : img.height;
  const scale = work / W;
  const w = work;
  const h = Math.max(1, Math.round(H * scale));
  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext('2d', { willReadFrequently: true })!;
  ctx.drawImage(img, 0, 0, w, h);
  const data = ctx.getImageData(0, 0, w, h).data;
  const lum = new Float32Array(w * h);
  for (let i = 0; i < w * h; i++) lum[i] = 0.299 * data[i * 4] + 0.587 * data[i * 4 + 1] + 0.114 * data[i * 4 + 2];
  const c = findBoard(lum, w, h);
  return clampCrop({ x: c.x / scale, y: c.y / scale, size: c.size / scale }, W, H);
}

export function clampCrop(c: Crop, W: number, H: number): Crop {
  const size = Math.max(32, Math.min(c.size, W, H));
  return { size, x: Math.min(Math.max(0, c.x), W - size), y: Math.min(Math.max(0, c.y), H - size) };
}

/** Cut the crop out of an image as a square JPEG (board crop only is kept). */
export async function cropToBlob(img: ImageBitmap | HTMLImageElement, c: Crop, out = 800): Promise<{ blob: Blob; width: number; height: number }> {
  const size = Math.round(Math.min(out, c.size));
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  canvas.getContext('2d')!.drawImage(img, c.x, c.y, c.size, c.size, 0, 0, size, size);
  const blob = await new Promise<Blob | null>((res) => canvas.toBlob(res, 'image/jpeg', 0.85));
  if (!blob) throw new Error('Could not crop that image.');
  return { blob, width: size, height: size };
}
