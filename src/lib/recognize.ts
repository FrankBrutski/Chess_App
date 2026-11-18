/**
 * Read the pieces off a cropped board screenshot, entirely on the phone.
 *
 * Each square is cut out of a 256×256 copy of the board, its background colour is taken from
 * the ring just inside the square's edge, and the piece's outline is found by flood-filling the
 * background in from the edges. That gives a few small pictures per square (the piece's shape,
 * its shape stretched to fill the frame, and how light it is), which a tiny neural network
 * (trained on 32 piece sets, about 200 KB) turns into "empty" or one of the 12 pieces.
 * Then a few board rules (one king each, no pawns on the end ranks) and which side sits at the bottom.
 */

export const S = 32; // pixels per square in the working copy
export const SIDE = S * 8;
const G = 16; // feature grid per square
export const NFEAT = G * G * 3 + 9;

/** 0 = empty, then white K Q R B N P, then black k q r b n p. */
export const CLASSES = ['', 'K', 'Q', 'R', 'B', 'N', 'P', 'k', 'q', 'r', 'b', 'n', 'p'] as const;
export type PieceChar = (typeof CLASSES)[number];

interface Rgba { data: Uint8ClampedArray | Uint8Array; width: number; height: number }

const median = (a: number[]) => {
  const s = a.slice().sort((x, y) => x - y);
  return s[s.length >> 1] ?? 0;
};

export interface SquareInfo { feat: Float32Array; bg: [number, number, number] }

/** Features of one square (row 0 = top of the picture, col 0 = left). `img` must be SIDE×SIDE. */
export function squareFeatures(img: Rgba, row: number, col: number): SquareInfo {
  const { data, width } = img;
  const x0 = col * S;
  const y0 = row * S;
  const px = (x: number, y: number) => ((y0 + y) * width + (x0 + x)) * 4;
  // Background: median colour of a thin ring just inside the edge (the outermost pixel can bleed from the neighbour).
  const rs: number[] = [];
  const gs: number[] = [];
  const bs: number[] = [];
  for (let t = 1; t < S - 1; t++) {
    for (const [x, y] of [[t, 1], [t, 2], [t, S - 2], [t, S - 3], [1, t], [2, t], [S - 2, t], [S - 3, t]]) {
      const i = px(x, y);
      rs.push(data[i]); gs.push(data[i + 1]); bs.push(data[i + 2]);
    }
  }
  const bg: [number, number, number] = [median(rs), median(gs), median(bs)];
  const N = S * S;
  const lum = new Float32Array(N);
  const near = new Uint8Array(N); // looks like the background
  for (let y = 0; y < S; y++) {
    for (let x = 0; x < S; x++) {
      const i = px(x, y);
      const r = data[i], g = data[i + 1], b = data[i + 2];
      lum[y * S + x] = (0.299 * r + 0.587 * g + 0.114 * b) / 255;
      const d = Math.hypot(r - bg[0], g - bg[1], b - bg[2]);
      near[y * S + x] = d < 34 ? 1 : 0;
    }
  }
  // Flood the background in from the edges; whatever it can't reach is the piece (outline and inside).
  const out = new Uint8Array(N);
  const stack: number[] = [];
  for (let t = 0; t < S; t++) for (const k of [t, (S - 1) * S + t, t * S, t * S + S - 1]) if (near[k] && !out[k]) { out[k] = 1; stack.push(k); }
  while (stack.length) {
    const k = stack.pop()!;
    const x = k % S, y = (k / S) | 0;
    if (x > 0 && near[k - 1] && !out[k - 1]) { out[k - 1] = 1; stack.push(k - 1); }
    if (x < S - 1 && near[k + 1] && !out[k + 1]) { out[k + 1] = 1; stack.push(k + 1); }
    if (y > 0 && near[k - S] && !out[k - S]) { out[k - S] = 1; stack.push(k - S); }
    if (y < S - 1 && near[k + S] && !out[k + S]) { out[k + S] = 1; stack.push(k + S); }
  }
  // Ignore the 2-pixel frame (neighbour bleed, board borders) when measuring the piece.
  let area = 0, sl = 0, sl2 = 0, bright = 0;
  let minX = S, minY = S, maxX = -1, maxY = -1;
  const mask = new Uint8Array(N);
  for (let y = 2; y < S - 2; y++) {
    for (let x = 2; x < S - 2; x++) {
      const k = y * S + x;
      if (out[k]) continue;
      mask[k] = 1;
      area++;
      sl += lum[k]; sl2 += lum[k] * lum[k];
      if (lum[k] > 0.6) bright++;
      if (x < minX) minX = x; if (x > maxX) maxX = x;
      if (y < minY) minY = y; if (y > maxY) maxY = y;
    }
  }
  const f = new Float32Array(NFEAT);
  const k2 = S / G;
  for (let gy = 0; gy < G; gy++) {
    for (let gx = 0; gx < G; gx++) {
      let m = 0, l = 0;
      for (let dy = 0; dy < k2; dy++) for (let dx = 0; dx < k2; dx++) {
        const k = (gy * k2 + dy) * S + gx * k2 + dx;
        m += mask[k]; l += mask[k] * lum[k];
      }
      f[gy * G + gx] = m / (k2 * k2);
      f[G * G + gy * G + gx] = l / (k2 * k2);
    }
  }
  // The shape again, stretched to fill the frame (piece sets differ in size and placement).
  if (area > 0) {
    const bw = maxX - minX + 1, bh = maxY - minY + 1;
    const side = Math.max(bw, bh);
    const ox = minX - (side - bw) / 2, oy = minY - (side - bh) / 2;
    for (let gy = 0; gy < G; gy++) {
      for (let gx = 0; gx < G; gx++) {
        let m = 0, n = 0;
        for (let sy = 0; sy < 2; sy++) for (let sx = 0; sx < 2; sx++) {
          const x = Math.floor(ox + ((gx + (sx + 0.5) / 2) / G) * side);
          const y = Math.floor(oy + ((gy + (sy + 0.5) / 2) / G) * side);
          n++;
          if (x >= 0 && y >= 0 && x < S && y < S) m += mask[y * S + x];
        }
        f[2 * G * G + gy * G + gx] = m / n;
      }
    }
  }
  const inner = (S - 4) * (S - 4);
  const mean = area ? sl / area : 0;
  const o = 3 * G * G;
  f[o] = area / inner;
  f[o + 1] = area ? minY / S : 0;
  f[o + 2] = area ? maxY / S : 0;
  f[o + 3] = area ? minX / S : 0;
  f[o + 4] = area ? maxX / S : 0;
  f[o + 5] = mean;
  f[o + 6] = area ? Math.sqrt(Math.max(0, sl2 / area - mean * mean)) : 0;
  f[o + 7] = area ? bright / area : 0;
  f[o + 8] = (0.299 * bg[0] + 0.587 * bg[1] + 0.114 * bg[2]) / 255;
  return { feat: f, bg };
}

// ---------- the network ----------

export interface Model { sizes: number[]; layers: { w: Float32Array; b: Float32Array }[]; mean: Float32Array; std: Float32Array }

/** Model file: { sizes, mean, std, layers: [{ scale, w (base64 int8, row-major out×in), b }] }. */
export interface ModelJson { sizes: number[]; mean: number[]; std: number[]; layers: { scale: number; w: string; b: number[] }[] }

const fromB64 = (s: string) => {
  const bin = atob(s);
  const a = new Int8Array(bin.length);
  for (let i = 0; i < bin.length; i++) a[i] = (bin.charCodeAt(i) << 24) >> 24;
  return a;
};

export function loadModel(j: ModelJson): Model {
  return {
    sizes: j.sizes,
    mean: Float32Array.from(j.mean),
    std: Float32Array.from(j.std),
    layers: j.layers.map((l) => {
      const q = fromB64(l.w);
      const w = new Float32Array(q.length);
      for (let i = 0; i < q.length; i++) w[i] = q[i] * l.scale;
      return { w, b: Float32Array.from(l.b) };
    }),
  };
}

/** Class probabilities for one square's features. */
export function predict(m: Model, feat: Float32Array): Float32Array {
  let x = new Float32Array(feat.length);
  for (let i = 0; i < feat.length; i++) x[i] = (feat[i] - m.mean[i]) / m.std[i];
  m.layers.forEach((l, li) => {
    const nIn = x.length;
    const nOut = l.b.length;
    const y = new Float32Array(nOut);
    for (let o = 0; o < nOut; o++) {
      let s = l.b[o];
      const row = o * nIn;
      for (let i = 0; i < nIn; i++) s += l.w[row + i] * x[i];
      y[o] = li < m.layers.length - 1 ? Math.max(0, s) : s;
    }
    x = y;
  });
  const mx = Math.max(...x);
  let sum = 0;
  for (let i = 0; i < x.length; i++) { x[i] = Math.exp(x[i] - mx); sum += x[i]; }
  for (let i = 0; i < x.length; i++) x[i] /= sum;
  return x;
}

// ---------- the whole board ----------

export interface Reading {
  /** FEN board part, from White's side. */
  board: string;
  orientation: 'white' | 'black';
  turn: 'w' | 'b';
  /** How sure it was about each square (from White's side, a8 first), 0..1. */
  confidence: number[];
  /** Squares (like "e4") it was least sure about. */
  unsure: string[];
  /** Side to move came from a highlighted last move (rather than a guess). */
  turnFromHighlight: boolean;
  /** Picture-order labels it read (row 0 = top). */
  labels: PieceChar[];
}

const FILES = 'abcdefgh';

/** Turn picture-order labels (row 0 = top) into a FEN board, given which side is at the bottom. */
export function boardFromLabels(labels: readonly PieceChar[], orientation: 'white' | 'black'): string {
  const rows: string[] = [];
  for (let r = 0; r < 8; r++) {
    let s = '';
    let gap = 0;
    for (let c = 0; c < 8; c++) {
      const pr = orientation === 'white' ? r : 7 - r;
      const pc = orientation === 'white' ? c : 7 - c;
      const p = labels[pr * 8 + pc];
      if (!p) { gap++; continue; }
      if (gap) { s += gap; gap = 0; }
      s += p;
    }
    if (gap) s += gap;
    rows.push(s);
  }
  return rows.join('/');
}

/** The inverse: picture-order labels for a FEN board shown with `orientation` at the bottom. */
export function labelsFromBoard(board: string, orientation: 'white' | 'black'): PieceChar[] {
  const grid = board.split('/').map((r) => r.replace(/\d/g, (d) => '.'.repeat(+d)));
  const out: PieceChar[] = [];
  for (let r = 0; r < 8; r++) {
    for (let c = 0; c < 8; c++) {
      const fr = orientation === 'white' ? r : 7 - r;
      const fc = orientation === 'white' ? c : 7 - c;
      const ch = grid[fr]?.[fc] ?? '.';
      out.push((ch === '.' ? '' : ch) as PieceChar);
    }
  }
  return out;
}

const isWhite = (p: PieceChar) => p !== '' && p === p.toUpperCase();

export function readBoard(img: Rgba, model: Model): Reading {
  const bgs: [number, number, number][] = [];
  const probs: Float32Array[] = [];
  for (let r = 0; r < 8; r++) {
    for (let c = 0; c < 8; c++) {
      const { feat, bg } = squareFeatures(img, r, c);
      bgs.push(bg);
      probs.push(predict(model, feat));
    }
  }
  const labels: PieceChar[] = probs.map((p) => CLASSES[argmax(p)]);

  // One king each: keep the likeliest, and fall back to the next guess for the others.
  for (const K of ['K', 'k'] as const) {
    const ki = CLASSES.indexOf(K);
    const at = labels.map((l, i) => (l === K ? i : -1)).filter((i) => i >= 0);
    if (at.length > 1) {
      at.sort((a, b) => probs[b][ki] - probs[a][ki]);
      for (const i of at.slice(1)) { probs[i][ki] = 0; labels[i] = CLASSES[argmax(probs[i])]; }
    } else if (!at.length) {
      let bi = -1;
      for (let i = 0; i < 64; i++) if (labels[i] !== 'K' && labels[i] !== 'k' && (bi < 0 || probs[i][ki] > probs[bi][ki])) bi = i;
      if (bi >= 0 && probs[bi][ki] > 0.02) labels[bi] = K;
    }
  }

  // Which side is at the bottom: White's pieces sit lower in the picture than Black's.
  let wr = 0, wn = 0, br = 0, bn = 0;
  labels.forEach((l, i) => {
    if (!l) return;
    const row = i >> 3;
    const weight = l === 'K' || l === 'k' ? 3 : l === 'P' || l === 'p' ? 2 : 1;
    if (isWhite(l)) { wr += row * weight; wn += weight; } else { br += row * weight; bn += weight; }
  });
  const orientation: 'white' | 'black' = wn && bn && wr / wn < br / bn ? 'black' : 'white';

  // No pawns on the first or last rank.
  labels.forEach((l, i) => {
    const row = i >> 3;
    if ((l === 'P' || l === 'p') && (row === 0 || row === 7)) {
      const p = probs[i];
      p[CLASSES.indexOf('P')] = 0;
      p[CLASSES.indexOf('p')] = 0;
      labels[i] = CLASSES[argmax(p)];
    }
  });

  // Side to move: a highlighted last move (two squares coloured differently from the board) tells us who just moved.
  const parity = (i: number) => ((i >> 3) + (i & 7)) % 2;
  const base = [0, 1].map((par) => {
    const own = bgs.filter((_, i) => parity(i) === par);
    return [0, 1, 2].map((ch) => median(own.map((b) => b[ch])));
  });
  const lit = bgs
    .map((b, i) => ({ i, d: Math.hypot(b[0] - base[parity(i)][0], b[1] - base[parity(i)][1], b[2] - base[parity(i)][2]) }))
    .filter((x) => x.d > 30)
    .map((x) => x.i);
  let turn: 'w' | 'b' = orientation === 'white' ? 'w' : 'b';
  let turnFromHighlight = false;
  if (lit.length === 2) {
    const moved = lit.map((i) => labels[i]).filter(Boolean);
    if (moved.length === 1) { turn = isWhite(moved[0]) ? 'b' : 'w'; turnFromHighlight = true; }
  }

  // Confidence, from White's side (a8 first).
  const conf = probs.map((p, i) => p[CLASSES.indexOf(labels[i])] ?? 0);
  const confidence: number[] = [];
  const unsure: { sq: string; c: number }[] = [];
  for (let r = 0; r < 8; r++) {
    for (let c = 0; c < 8; c++) {
      const pi = orientation === 'white' ? r * 8 + c : (7 - r) * 8 + (7 - c);
      confidence.push(conf[pi]);
      if (conf[pi] < 0.6) unsure.push({ sq: `${FILES[c]}${8 - r}`, c: conf[pi] });
    }
  }
  unsure.sort((a, b) => a.c - b.c);
  return {
    board: boardFromLabels(labels, orientation),
    orientation,
    turn,
    confidence,
    unsure: unsure.map((u) => u.sq),
    turnFromHighlight,
    labels,
  };
}

function argmax(p: Float32Array) {
  let b = 0;
  for (let i = 1; i < p.length; i++) if (p[i] > p[b]) b = i;
  return b;
}
