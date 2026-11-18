// node real.cjs model.json : full pipeline (find board, crop, read) on real screenshots
const { chromium } = require('playwright'); const fs = require('fs'); const R = __dirname;
const cases = [
  ['real_apiary.png', 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR', 'black'],
  ['real_chessable.png', 'r2q1rk1/pbpn1pbp/1p3np1/4p3/4PB2/2P2N2/PPQNBPPP/R4RK1', 'black'],
  ...(process.argv[3] ? JSON.parse(fs.readFileSync(process.argv[3], 'utf8')) : []),
];
(async () => {
  const b = await chromium.launch(); const p = await b.newPage();
  await p.setContent('<body></body>'); await p.addScriptTag({ path: R + '/rec.js' });
  const model = JSON.parse(fs.readFileSync(process.argv[2], 'utf8'));
  let tot = 0, ok = 0;
  for (const [f, truth, orient] of cases) {
    const url = 'data:image/png;base64,' + fs.readFileSync(R + '/' + f).toString('base64');
    const r = await p.evaluate(async ({ url, model }) => {
      const im = new Image(); await new Promise((res) => { im.onload = res; im.src = url; });
      const crop = await Rec.guessBoard(im);
      const c = document.createElement('canvas'); c.width = 256; c.height = 256;
      const g = c.getContext('2d', { willReadFrequently: true }); g.imageSmoothingQuality = 'high';
      g.drawImage(im, crop.x, crop.y, crop.size, crop.size, 0, 0, 256, 256);
      const rd = Rec.readBoard(g.getImageData(0, 0, 256, 256), Rec.loadModel(model));
      return { crop, board: rd.board, orientation: rd.orientation, turn: rd.turn, unsure: rd.unsure };
    }, { url, model });
    const exp = (s) => s.split('/').map((r) => r.replace(/\d/g, (d) => '.'.repeat(+d))).join('');
    const a = exp(r.board), t = exp(truth);
    let wrong = []; for (let i = 0; i < 64; i++) if (a[i] !== t[i]) wrong.push('abcdefgh'[i % 8] + (8 - (i >> 3)) + ':' + t[i] + '->' + a[i]);
    tot += 64; ok += 64 - wrong.length;
    console.log(f, 'crop', JSON.stringify(r.crop), 'orient', r.orientation, orient === r.orientation ? 'ok' : 'WRONG', 'wrong squares', wrong.length, wrong.join(' '), 'unsure', r.unsure.join(','));
  }
  console.log('squares right', ok, '/', tot);
  await b.close();
})();
