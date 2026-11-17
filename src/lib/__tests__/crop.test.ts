import { describe, expect, it } from 'vitest';
import { findBoard } from '../crop';

/** A fake phone screenshot: flat UI with some text bars, and a board somewhere in it. */
function screenshot(w: number, h: number, bx: number, by: number, bs: number, pieces = true) {
  const lum = new Float32Array(w * h).fill(235);
  for (let y = 0; y < 30; y++) for (let x = 10; x < w - 10; x++) if (y % 6 < 3) lum[y * w + x] = 40; // header text
  for (let y = 0; y < bs; y++) {
    for (let x = 0; x < bs; x++) {
      const r = Math.floor((y * 8) / bs);
      const c = Math.floor((x * 8) / bs);
      let v = (r + c) % 2 ? 110 : 220;
      // A "piece" blob in some squares.
      const cx = ((x * 8) / bs) % 1;
      const cy = ((y * 8) / bs) % 1;
      if (pieces && (r < 2 || r > 5) && Math.hypot(cx - 0.5, cy - 0.5) < 0.3) v = r < 2 ? 20 : 250;
      lum[(by + y) * w + bx + x] = v;
    }
  }
  return lum;
}

describe('findBoard', () => {
  it('finds a full-width board below a header', () => {
    const lum = screenshot(120, 260, 0, 70, 120);
    const c = findBoard(lum, 120, 260);
    expect(Math.abs(c.y - 70)).toBeLessThanOrEqual(3);
    expect(Math.abs(c.size - 120)).toBeLessThanOrEqual(3);
  });

  it('finds a smaller board off to the side', () => {
    const lum = screenshot(200, 150, 90, 30, 96);
    const c = findBoard(lum, 200, 150);
    expect(Math.abs(c.x - 90)).toBeLessThanOrEqual(4);
    expect(Math.abs(c.y - 30)).toBeLessThanOrEqual(4);
    expect(Math.abs(c.size - 96)).toBeLessThanOrEqual(5);
  });
});
