import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { gunzipSync } from 'node:zlib';
import { boardFromLabels, labelsFromBoard, NFEAT, S, SIDE, squareFeatures, readBoard, CLASSES, type Model } from '../recognize';
import model from '../pieceModel.json';
import { loadModel } from '../recognize';

const START = 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR';

/** A plain two-colour board, with a filled disc of `ink` on some squares. */
function board(discs: Record<number, number>) {
  const data = new Uint8ClampedArray(SIDE * SIDE * 4);
  for (let y = 0; y < SIDE; y++) {
    for (let x = 0; x < SIDE; x++) {
      const r = (y / S) | 0, c = (x / S) | 0;
      const light = (r + c) % 2 === 0;
      let v: number[] = light ? [240, 217, 181] : [181, 136, 99];
      const ink = discs[r * 8 + c];
      const dx = (x % S) - S / 2, dy = (y % S) - S / 2;
      if (ink !== undefined && dx * dx + dy * dy < (S * 0.3) ** 2) v = [ink, ink, ink];
      data.set([...v, 255], (y * SIDE + x) * 4);
    }
  }
  return { data, width: SIDE, height: SIDE };
}

describe('board labels', () => {
  it('round-trips a FEN board from either side', () => {
    for (const o of ['white', 'black'] as const) {
      expect(boardFromLabels(labelsFromBoard(START, o), o)).toBe(START);
    }
    // From Black's side the top-left square is h1.
    expect(labelsFromBoard(START, 'black')[0]).toBe('R');
    expect(labelsFromBoard('8/8/8/8/8/8/8/7K', 'black')[0]).toBe('K');
  });
});

describe('square features', () => {
  it('sees nothing on an empty square and a dark shape on a black disc', () => {
    const img = board({ 9: 20, 18: 250 });
    const empty = squareFeatures(img, 0, 0).feat;
    expect(empty).toHaveLength(NFEAT);
    expect(empty[3 * 256]).toBe(0); // area
    const dark = squareFeatures(img, 1, 1).feat;
    expect(dark[3 * 256]).toBeGreaterThan(0.2);
    expect(dark[3 * 256 + 5]).toBeLessThan(0.2); // mean lightness of the piece
    const light = squareFeatures(img, 2, 2).feat;
    expect(light[3 * 256 + 5]).toBeGreaterThan(0.8);
  });
});

describe('readBoard', () => {
  it('keeps one king per side and turns the board for Black at the bottom', () => {
    // A fake network that calls every square with a shape a white king, and every empty square empty.
    const fake: Model = {
      sizes: [NFEAT, 13],
      mean: new Float32Array(NFEAT),
      std: new Float32Array(NFEAT).fill(1),
      layers: [{
        w: (() => { const w = new Float32Array(13 * NFEAT); w[1 * NFEAT + 3 * 256] = 50; w[7 * NFEAT + 3 * 256 + 7] = -50; return w; })(),
        b: (() => { const b = new Float32Array(13); b[0] = 5; b[7] = 0; return b; })(),
      }],
    };
    const r = readBoard(board({ 0: 250, 1: 250, 63: 20 }), fake);
    const kings = r.labels.filter((l) => l === 'K').length;
    expect(kings).toBe(1);
    expect(CLASSES).toContain(r.labels[0]);
  });

  it('reads a real iPhone screenshot (start position, Black at the bottom) with the shipped model', () => {
    const m = loadModel(model as never);
    const raw = gunzipSync(readFileSync(new URL('./fixtures/apiary-start-black.rgba.gz', import.meta.url)));
    const r = readBoard({ data: new Uint8ClampedArray(raw), width: SIDE, height: SIDE }, m);
    expect(r.board).toBe(START);
    expect(r.orientation).toBe('black');
  });

  it('finds nothing on an empty board', () => {
    const r = readBoard(board({}), loadModel(model as never));
    expect(r.board).toBe('8/8/8/8/8/8/8/8');
  });
});
