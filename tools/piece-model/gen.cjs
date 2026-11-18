// Render random boards with many piece sets / themes, extract features with the app's own code.
// usage: node gen.cjs out.bin sets(comma) boards seed [keepEmpty]
const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');
const R = __dirname;
const [out, setsArg, nBoards, seedArg, keepEmptyArg] = process.argv.slice(2);
const sets = setsArg.split(',');
const keepEmpty = Number(keepEmptyArg ?? 0.25);
let seed = Number(seedArg) || 1;
const rnd = () => ((seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648);
const pick = (a) => a[Math.floor(rnd() * a.length)];

const PIECES = ['K', 'Q', 'R', 'B', 'N', 'P', 'k', 'q', 'r', 'b', 'n', 'p'];
const file = (p) => (p === p.toUpperCase() ? 'w' : 'b') + p.toUpperCase();
const svgs = {};
for (const s of sets) {
  svgs[s] = {};
  for (const p of PIECES) {
    const t = fs.readFileSync(path.join(R, 'sets', s, file(p) + '.svg'));
    svgs[s][p] = 'data:image/svg+xml;base64,' + t.toString('base64');
  }
}
const THEMES = [
  ['#f0d9b5', '#b58863'], ['#dee3e6', '#8ca2ad'], ['#ffffdd', '#86a666'], ['#9f90b0', '#7d4a8d'],
  ['#eeeed2', '#769656'], ['#edd6b0', '#b88762'], ['#ececec', '#c1c18e'], ['#97b2c7', '#546f82'],
  ['#e8e8e8', '#7d8796'], ['#f5efe1', '#c9a26b'], ['#e0c391', '#a2703d'], ['#d9e4e8', '#7b9eb0'],
  ['#ebecd0', '#779556'], ['#f0f1f0', '#8476ba'], ['#c8c8c8', '#5a5a5a'], ['#fce4b2', '#d08b18'],
  ['#e9edcc', '#5d9948'], ['#f2e6d0', '#966f48'],
];
const HL = ['rgba(155,199,0,0.41)', 'rgba(255,255,51,0.5)', 'rgba(20,85,30,0.5)', 'rgba(246,246,105,0.8)', 'rgba(130,151,105,0.6)'];

function randomPosition() {
  const board = Array(64).fill('');
  const r = rnd();
  const n = r < 0.15 ? 32 : 3 + Math.floor(rnd() * 26);
  if (r < 0.15) {
    const start = 'rnbqkbnrpppppppp' + ''.padEnd(32, '.') + 'PPPPPPPPRNBQKBNR';
    for (let i = 0; i < 64; i++) board[i] = start[i] === '.' ? '' : start[i];
    if (rnd() < 0.5) board.reverse();
    return board;
  }
  const free = () => { let i; do i = Math.floor(rnd() * 64); while (board[i]); return i; };
  board[free()] = 'K';
  board[free()] = 'k';
  const bag = ['Q', 'R', 'R', 'B', 'B', 'N', 'N', 'P', 'P', 'P', 'P', 'P', 'P', 'P', 'P'];
  for (let k = 2; k < n; k++) {
    let p = pick(bag);
    if (rnd() < 0.5) p = p.toLowerCase();
    let i, tries = 0;
    do { i = free(); tries++; } while ((p === 'P' || p === 'p') && (i < 8 || i >= 56) && tries < 50);
    board[i] = p;
  }
  return board;
}

(async () => {
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 900, height: 900 } });
  await page.setContent('<html><body style="margin:0;background:#333"></body></html>');
  await page.addScriptTag({ path: path.join(R, 'rec.js') });
  const fd = fs.openSync(out, 'w');
  let count = 0;
  for (let b = 0; b < Number(nBoards); b++) {
    const set = sets[b % sets.length];
    const pos = randomPosition();
    const [light, dark] = pick(THEMES);
    const size = 200 + Math.floor(rnd() * 500);
    const scale = 0.82 + rnd() * 0.18;
    const coords = rnd() < 0.6;
    const hl = rnd() < 0.5 ? [Math.floor(rnd() * 64), Math.floor(rnd() * 64)] : [];
    const hlc = pick(HL);
    const check = rnd() < 0.08;
    const jpegQ = 0.5 + rnd() * 0.45;
    const off = [(rnd() - 0.5) * 0.04, (rnd() - 0.5) * 0.04, (rnd() - 0.5) * 0.03];
    const border = rnd() < 0.3 ? Math.floor(rnd() * 12) : 0;
    const texture = rnd() < 0.2;
    const res = await page.evaluate(async (o) => {
      const { pos, light, dark, size, scale, coords, hl, hlc, check, jpegQ, off, border, svgs, texture } = o;
      const W = size + 2 * border;
      const c = document.createElement('canvas');
      c.width = W; c.height = W;
      const g = c.getContext('2d');
      g.fillStyle = '#3a2a1a'; g.fillRect(0, 0, W, W);
      const sq = size / 8;
      const imgs = {};
      await Promise.all(Object.entries(svgs).map(([k, u]) => new Promise((res) => { const im = new Image(); im.onload = () => { imgs[k] = im; res(); }; im.onerror = res; im.src = u; })));
      for (let i = 0; i < 64; i++) {
        const r = i >> 3, f = i & 7;
        const x = border + f * sq, y = border + r * sq;
        g.fillStyle = (r + f) % 2 ? dark : light;
        g.fillRect(x, y, sq + 0.5, sq + 0.5);
        if (texture) {
          for (let t = 0; t < 6; t++) { g.fillStyle = `rgba(${Math.random() < 0.5 ? '0,0,0' : '255,255,255'},0.04)`; g.fillRect(x, y + Math.random() * sq, sq, 1 + Math.random() * 3); }
        }
        if (hl.includes(i)) { g.fillStyle = hlc; g.fillRect(x, y, sq + 0.5, sq + 0.5); }
        if (coords) {
          g.font = `${Math.round(sq * 0.2)}px sans-serif`;
          g.fillStyle = (r + f) % 2 ? light : dark;
          if (f === 0) { g.textBaseline = 'top'; g.textAlign = 'left'; g.fillText(String(8 - r), x + sq * 0.05, y + sq * 0.04); }
          if (r === 7) { g.textBaseline = 'bottom'; g.textAlign = 'right'; g.fillText('abcdefgh'[f], x + sq * 0.96, y + sq * 0.98); }
        }
        const p = pos[i];
        if (p) {
          if (check && (p === 'K' || p === 'k')) {
            const gr = g.createRadialGradient(x + sq / 2, y + sq / 2, 0, x + sq / 2, y + sq / 2, sq * 0.7);
            gr.addColorStop(0, 'rgba(255,0,0,1)'); gr.addColorStop(0.25, 'rgba(231,0,0,1)'); gr.addColorStop(0.9, 'rgba(169,0,0,0)');
            g.fillStyle = gr; g.fillRect(x, y, sq, sq);
          }
          const s = sq * scale;
          if (imgs[p]) g.drawImage(imgs[p], x + (sq - s) / 2, y + (sq - s) * 0.6, s, s);
        }
      }
      // JPEG round trip, then the app's own crop-to-256 with a small misalignment.
      const url = c.toDataURL('image/jpeg', jpegQ);
      const im = await new Promise((res) => { const i = new Image(); i.onload = () => res(i); i.src = url; });
      const cs = size * (1 + off[2]);
      const cx = border + off[0] * size, cy = border + off[1] * size;
      const d = document.createElement('canvas');
      d.width = 256; d.height = 256;
      const dg = d.getContext('2d', { willReadFrequently: true });
      dg.imageSmoothingQuality = 'high';
      dg.drawImage(im, cx, cy, cs, cs, 0, 0, 256, 256);
      const id = dg.getImageData(0, 0, 256, 256);
      const feats = [];
      for (let r = 0; r < 8; r++) for (let f = 0; f < 8; f++) {
        const ft = Rec.squareFeatures(id, r, f).feat;
        feats.push(Array.from(ft, (v) => Math.max(0, Math.min(255, Math.round(v * 255)))));
      }
      return feats;
    }, { pos, light, dark, size, scale, coords, hl, hlc, check, jpegQ, off, border, svgs: svgs[set], texture });
    const setIdx = sets.indexOf(set);
    for (let i = 0; i < 64; i++) {
      const label = pos[i] ? 1 + PIECES.indexOf(pos[i]) : 0;
      if (!label && rnd() > keepEmpty) continue;
      fs.writeSync(fd, Buffer.from([label, setIdx, ...res[i]]));
      count++;
    }
    if (b % 100 === 0) process.stderr.write(`${b} `);
  }
  fs.closeSync(fd);
  console.log(`\n${count} samples`);
  await browser.close();
})();
