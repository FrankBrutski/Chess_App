// Copies the bundled Stockfish engine (lite, single-threaded WASM build from the
// pinned `stockfish` npm package) into public/engine so it is served from our own
// origin and cached for offline use. Nothing is downloaded at runtime.
import { copyFileSync, mkdirSync, existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const src = join(root, 'node_modules', 'stockfish', 'bin');
const out = join(root, 'public', 'engine');
const files = ['stockfish-19-lite-single.js', 'stockfish-19-lite-single.wasm'];

mkdirSync(out, { recursive: true });
for (const f of files) {
  if (!existsSync(join(src, f))) throw new Error(`Missing ${f}: run npm install`);
  copyFileSync(join(src, f), join(out, f));
}
copyFileSync(join(root, 'node_modules', 'stockfish', 'Copying.txt'), join(out, 'COPYING-stockfish.txt'));
console.log(`Stockfish engine copied to public/engine (${files.join(', ')})`);
