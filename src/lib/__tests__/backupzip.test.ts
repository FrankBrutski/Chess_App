import 'fake-indexeddb/auto';
import { describe, expect, it } from 'vitest';
import { crc32, makeZip, readZip } from '../zip';
import { db, exportBackupZip, importBackupFile } from '../db';

describe('zip', () => {
  it('round-trips files and checks CRCs', () => {
    const files = [
      { name: 'backup.json', data: new TextEncoder().encode('{"a":1}') },
      { name: 'shots/ä.jpg', data: new Uint8Array([0xff, 0xd8, 1, 2, 3]) },
    ];
    const z = makeZip(files);
    const back = readZip(z);
    expect(back.map((e) => [e.name, [...e.data]])).toEqual(files.map((e) => [e.name, [...e.data]]));
    expect(crc32(new TextEncoder().encode('123456789'))).toBe(0xcbf43926);
    const broken = z.slice();
    broken[30 + 11 + 2] ^= 0xff; // flip a byte of the first file's data
    expect(() => readZip(broken)).toThrow(/damaged/);
  });
});

describe('zip backup', () => {
  it('restores Stings with their screenshots, and old JSON backups still work', async () => {
    await db.stings.clear();
    await db.shots.clear();
    await db.shots.add({ id: 'shot1', blob: new Blob([new Uint8Array([9, 8, 7])], { type: 'image/jpeg' }), width: 8, height: 8 });
    await db.stings.add({ id: 'st1', status: 'ready', createdAt: 1, updatedAt: 1, shotId: 'shot1', fen: 'x', title: 'Fork' });
    await db.stings.add({ id: 'st2', status: 'inbox', createdAt: 2, updatedAt: 2, shotId: 'gone' });
    const { bytes, stings } = await exportBackupZip();
    expect(stings).toBe(2);
    await db.stings.clear();
    await db.shots.clear();
    const r = await importBackupFile(bytes);
    expect(r.stings).toBe(2);
    const st1 = await db.stings.get('st1');
    expect(st1?.title).toBe('Fork');
    const shot = await db.shots.get('shot1');
    expect([...new Uint8Array(await shot!.blob.arrayBuffer())]).toEqual([9, 8, 7]);
    expect((await db.stings.get('st2'))?.shotId).toBeUndefined(); // image missing from the zip

    const old = new TextEncoder().encode(JSON.stringify({ app: 'chess-app', version: 3, exportedAt: '', courses: [], chapters: [] }));
    expect(await importBackupFile(old)).toEqual({ hives: 0, stings: 0 });
    await expect(importBackupFile(new TextEncoder().encode('PK\u0003\u0004 nonsense'))).rejects.toThrow();
  });
});
