import { existsSync } from 'fs';
import { join } from 'path';
import { crc32 } from 'zlib';
import { createTestApp, TestCtx, uploadPhotos } from './helpers';

const api = '/api/v1';
const bearer = (t: string) => ({ Authorization: `Bearer ${t}` });
let ctx: TestCtx;

beforeAll(async () => {
  ctx = await createTestApp();
});
afterAll(() => ctx.close());

const admin = () => bearer(ctx.tokens.admin);
const demo = () => bearer(ctx.tokens.demo);
const ids = (res: { body: { items: { id: number }[] } }) => res.body.items.map((p) => p.id);

/** Reads a stored ZIP back: names and CRC-checked contents from the central directory. */
function unzip(buf: Buffer): { name: string; data: Buffer }[] {
  const end = buf.lastIndexOf(Buffer.from([0x50, 0x4b, 0x05, 0x06]));
  const count = buf.readUInt16LE(end + 10);
  let p = buf.readUInt32LE(end + 16);
  const out: { name: string; data: Buffer }[] = [];
  for (let i = 0; i < count; i++) {
    expect(buf.readUInt32LE(p)).toBe(0x02014b50);
    const crc = buf.readUInt32LE(p + 16);
    const size = buf.readUInt32LE(p + 20);
    const nameLen = buf.readUInt16LE(p + 28);
    const local = buf.readUInt32LE(p + 42);
    const name = buf.subarray(p + 46, p + 46 + nameLen).toString('utf8');
    const start = local + 30 + buf.readUInt16LE(local + 26);
    const data = buf.subarray(start, start + size);
    expect(crc32(data) >>> 0).toBe(crc);
    out.push({ name, data });
    p += 46 + nameLen;
  }
  return out;
}

describe('favorite / save in batches', () => {
  it('adds and removes many at once, only for active photos, idempotently', async () => {
    const [a, b, c] = await uploadPhotos(ctx, 3);
    await ctx.http.delete(`${api}/admin/photos/${c}`).set(admin()).expect(200);

    const add = await ctx.http.post(`${api}/me/favorites/batch`).set(demo()).send({ photoIds: [a, b, c, 999999], on: true }).expect(200);
    expect(add.body).toEqual({ changed: 2 }); // trashed and missing ones skipped
    expect((await ctx.http.post(`${api}/me/favorites/batch`).set(demo()).send({ photoIds: [a, b], on: true }).expect(200)).body).toEqual({ changed: 0 });
    expect(ids(await ctx.http.get(`${api}/me/favorites`).set(demo()).expect(200))).toEqual(expect.arrayContaining([a, b]));

    expect((await ctx.http.post(`${api}/me/saves/batch`).set(demo()).send({ photoIds: [b], on: true }).expect(200)).body).toEqual({ changed: 1 });
    expect((await ctx.http.post(`${api}/me/favorites/batch`).set(demo()).send({ photoIds: [a], on: false }).expect(200)).body).toEqual({ changed: 1 });
    const favs = ids(await ctx.http.get(`${api}/me/favorites`).set(demo()).expect(200));
    expect(favs).toContain(b);
    expect(favs).not.toContain(a);

    await ctx.http.post(`${api}/me/favorites/batch`).send({ photoIds: [a], on: true }).expect(401);
    await ctx.http.post(`${api}/me/favorites/batch`).set(demo()).send({ photoIds: [], on: true }).expect(400);
    await ctx.http.post(`${api}/me/favorites/batch`).set(demo()).send({ photoIds: [a] }).expect(400);
  });
});

describe('admin batches', () => {
  it('edits titles and captions of many photos', async () => {
    const [a, b] = await uploadPhotos(ctx, 2, 'Old');
    expect((await ctx.http.patch(`${api}/admin/photos`).set(admin()).send({ photoIds: [a, b], title: 'Angkor Wat' }).expect(200)).body).toEqual({ changed: 2 });
    const pa = (await ctx.http.get(`${api}/photos/${a}`).expect(200)).body;
    expect(pa).toMatchObject({ title: 'Angkor Wat', caption: null });
    await ctx.http.patch(`${api}/admin/photos`).set(admin()).send({ photoIds: [a], title: '', caption: 'Sunrise' }).expect(200);
    expect((await ctx.http.get(`${api}/photos/${a}`).expect(200)).body).toMatchObject({ title: null, caption: 'Sunrise' });
    expect((await ctx.http.get(`${api}/photos/${b}`).expect(200)).body).toMatchObject({ title: 'Angkor Wat' });
    await ctx.http.patch(`${api}/admin/photos`).set(demo()).send({ photoIds: [a], title: 'x' }).expect(403);
  });

  it('moves many to trash, restores them and deletes them for good', async () => {
    const [a, b] = await uploadPhotos(ctx, 2);
    const before = (await ctx.http.get(`${api}/photos/${a}`).set(admin()).expect(200)).body;

    expect((await ctx.http.post(`${api}/admin/photos/trash`).set(admin()).send({ photoIds: [a, b, 999999] }).expect(200)).body).toEqual({ changed: 2 });
    await ctx.http.get(`${api}/photos/${a}`).expect(404);
    expect(existsSync(join(ctx.uploadDir, before.url.replace('/uploads/', '')))).toBe(false); // moved to trash
    expect((await ctx.http.post(`${api}/admin/photos/trash`).set(admin()).send({ photoIds: [a] }).expect(200)).body).toEqual({ changed: 0 });

    expect((await ctx.http.post(`${api}/admin/photos/restore`).set(admin()).send({ photoIds: [a] }).expect(200)).body).toEqual({ changed: 1 });
    await ctx.http.get(`${api}/photos/${a}`).expect(200);
    await ctx.http.get(before.url).expect(200);

    expect((await ctx.http.post(`${api}/admin/photos/purge`).set(admin()).send({ photoIds: [a, b] }).expect(200)).body).toEqual({ changed: 2 });
    await ctx.http.get(`${api}/photos/${a}`).set(admin()).expect(404);
    await ctx.http.get(`${api}/photos/${b}`).set(admin()).expect(404);

    for (const path of ['trash', 'restore', 'purge']) {
      await ctx.http.post(`${api}/admin/photos/${path}`).set(demo()).send({ photoIds: [1] }).expect(403);
    }
    await ctx.http.post(`${api}/admin/photos/trash`).set(admin()).send({ photoIds: Array.from({ length: 1001 }, (_, i) => i + 1) }).expect(400);
  });

  it('exports just the selected photos as CSV', async () => {
    const [a, b, c] = await uploadPhotos(ctx, 3);
    const res = await ctx.http.get(`${api}/admin/photos/export.csv?ids=${c},${a}`).set(admin()).expect(200);
    expect(res.headers['content-disposition']).toMatch(/filename="prewedding-selected-2-/);
    const rows = res.text.replace(/^﻿/, '').trim().split('\r\n').slice(1).map((l) => Number(l.split(',')[0]));
    expect(rows.sort()).toEqual([a, c].sort());
    expect(rows).not.toContain(b);
    await ctx.http.get(`${api}/admin/photos/export.csv?ids=x`).set(admin()).expect(400);
  });
});

describe('ZIP download', () => {
  it('streams the originals of the selected active photos', async () => {
    const [a, b, c] = await uploadPhotos(ctx, 3);
    await ctx.http.delete(`${api}/admin/photos/${c}`).set(admin()).expect(200);
    const res = await ctx.http
      .get(`${api}/photos/download.zip?ids=${b},${a},${c},999999`)
      .buffer(true)
      .parse((r, cb) => {
        const parts: Buffer[] = [];
        r.on('data', (d: Buffer) => parts.push(d));
        r.on('end', () => cb(null, Buffer.concat(parts)));
      })
      .expect(200)
      .expect('Content-Type', 'application/zip');
    const body = res.body as Buffer;
    expect(Number(res.headers['content-length'])).toBe(body.length);
    expect(res.headers['content-disposition']).toMatch(/filename="prewedding-2-photos-/);

    const files = unzip(body);
    expect(files.map((f) => f.name)).toEqual([`prewedding-${b}.jpg`, `prewedding-${a}.jpg`]);
    const original = (await ctx.http.get(`${api}/photos/${a}`).expect(200)).body.url as string;
    const raw = await ctx.http.get(original).buffer(true).parse((r, cb) => {
      const parts: Buffer[] = [];
      r.on('data', (d: Buffer) => parts.push(d));
      r.on('end', () => cb(null, Buffer.concat(parts)));
    });
    expect(files[1].data.equals(raw.body as Buffer)).toBe(true);

    await ctx.http.get(`${api}/photos/download.zip?ids=${c}`).expect(404); // only trashed
    await ctx.http.get(`${api}/photos/download.zip`).expect(400);
    await ctx.http.get(`${api}/photos/download.zip?ids=${Array.from({ length: 201 }, (_, i) => i + 1).join(',')}`).expect(400);
  });
});
