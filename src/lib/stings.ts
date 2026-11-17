import { db, newId } from './db';
import type { Sting, StingStatus } from './model';

/** Longest side of a stored screenshot. Enough to read the board; about 100 KB as JPEG. */
export const SHOT_MAX = 1280;
const QUALITY = 0.82;

export const STATUS_LABEL: Record<StingStatus, string> = { inbox: 'Inbox', progress: 'In progress', ready: 'Ready' };

/** Shrink and re-encode an image on the phone (nothing leaves the device). */
export async function compressImage(file: Blob, max = SHOT_MAX): Promise<{ blob: Blob; width: number; height: number }> {
  const bmp = await createImageBitmap(file);
  const scale = Math.min(1, max / Math.max(bmp.width, bmp.height));
  const width = Math.max(1, Math.round(bmp.width * scale));
  const height = Math.max(1, Math.round(bmp.height * scale));
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  canvas.getContext('2d')!.drawImage(bmp, 0, 0, width, height);
  bmp.close?.();
  const blob = await new Promise<Blob | null>((res) => canvas.toBlob(res, 'image/jpeg', QUALITY));
  if (!blob) throw new Error('Could not read that image.');
  return { blob, width, height };
}

/** Add screenshots to the Inbox, one card each. Returns how many were added and which files failed. */
export async function addScreenshots(
  files: File[],
  compress: (f: Blob) => Promise<{ blob: Blob; width: number; height: number }> = compressImage,
  onProgress?: (done: number) => void,
): Promise<{ added: number; failed: string[] }> {
  let added = 0;
  const failed: string[] = [];
  const now = Date.now();
  for (const [i, f] of files.entries()) {
    try {
      const img = await compress(f);
      const shotId = newId();
      // Keep the picker's order: the first picked file is the oldest card.
      const sting: Sting = { id: newId(), status: 'inbox', createdAt: now + i, updatedAt: now + i, shotId };
      await db.transaction('rw', db.stings, db.shots, async () => {
        await db.shots.add({ id: shotId, ...img });
        await db.stings.add(sting);
      });
      added++;
    } catch {
      failed.push(f.name || `image ${i + 1}`);
    }
    onProgress?.(i + 1);
  }
  return { added, failed };
}

export async function deleteSting(id: string) {
  await db.transaction('rw', db.stings, db.shots, async () => {
    const s = await db.stings.get(id);
    if (s?.shotId) await db.shots.delete(s.shotId);
    await db.stings.delete(id);
  });
}

export async function stingCounts(): Promise<Record<StingStatus, number>> {
  const [inbox, progress, ready] = await Promise.all(
    (['inbox', 'progress', 'ready'] as const).map((s) => db.stings.where('status').equals(s).count()),
  );
  return { inbox, progress, ready };
}
