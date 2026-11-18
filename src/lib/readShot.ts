import { SIDE, loadModel, readBoard, type Model, type Reading } from './recognize';
import type { Crop } from './crop';

let model: Promise<Model> | undefined;
/** The piece model ships with the app (a separate file, loaded the first time it's needed). */
const getModel = () => (model ??= import('./pieceModel.json').then((m) => loadModel(m.default as never)));

/** Read the position off an image: the whole image is the board unless a crop is given. */
export async function readShot(img: ImageBitmap | HTMLImageElement, crop?: Crop): Promise<Reading> {
  const W = 'naturalWidth' in img ? img.naturalWidth : img.width;
  const H = 'naturalHeight' in img ? img.naturalHeight : img.height;
  const c = crop ?? { x: 0, y: 0, size: Math.min(W, H) };
  const canvas = document.createElement('canvas');
  canvas.width = SIDE;
  canvas.height = SIDE;
  const g = canvas.getContext('2d', { willReadFrequently: true })!;
  g.imageSmoothingQuality = 'high';
  g.drawImage(img, c.x, c.y, c.size, c.size, 0, 0, SIDE, SIDE);
  const m = await getModel();
  return readBoard(g.getImageData(0, 0, SIDE, SIDE), m);
}

/** A short line for the person: what was read and where to look. */
export function readingNote(r: Reading): string {
  const who = r.turn === 'w' ? 'White' : 'Black';
  const turn = r.turnFromHighlight ? `${who} to move (from the last-move highlight).` : `${who} to move is a guess: change it if needed.`;
  const unsure = r.unsure.length ? ` Least sure about ${r.unsure.slice(0, 4).join(', ')}.` : '';
  return `Read from the screenshot. Check it against the picture and fix any square with the palette.${unsure} ${turn}`;
}
