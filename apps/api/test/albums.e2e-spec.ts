import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { createTestApp, TestCtx, uploadPhotos, walk } from './helpers';
import { slugify } from '../src/albums/albums.service';

const api = '/api/v1';
const bearer = (t: string) => ({ Authorization: `Bearer ${t}` });
let ctx: TestCtx;
let webDir: string;

beforeAll(async () => {
  webDir = mkdtempSync(join(tmpdir(), 'pw-web-'));
  mkdirSync(join(webDir, 'assets'));
  writeFileSync(join(webDir, 'index.html'), '<!doctype html><html><head><title>Pre-Wedding View</title></head><body></body></html>');
  ctx = await createTestApp({ WEB_DIST_DIR: webDir, PUBLIC_URL: 'https://example.test/' });
});
afterAll(async () => {
  await ctx.close();
  rmSync(webDir, { recursive: true, force: true });
});

const admin = () => bearer(ctx.tokens.admin);
const createAlbum = async (body: Record<string, unknown>) =>
  (await ctx.http.post(`${api}/admin/albums`).set(admin()).send(body).expect(201)).body;

describe('slugify', () => {
  it('makes URL names and falls back for non-Latin names', () => {
    expect(slugify('Barsat Angkor Wat')).toBe('barsat-angkor-wat');
    expect(slugify('  Café — Sunrise!! ')).toBe('cafe-sunrise');
    expect(slugify('អង្គរវត្ត')).toBe('album');
  });
});

describe('albums', () => {
  it('creates an album with photos; anyone can browse it with paging and their own flags', async () => {
    const ids = await uploadPhotos(ctx, 5);
    const album = await createAlbum({ name: 'Barsat Angkor Wat', description: 'Sunrise', photoIds: ids.slice(0, 4) });
    expect(album).toMatchObject({ slug: 'barsat-angkor-wat', name: 'Barsat Angkor Wat', description: 'Sunrise', hidden: false, photoCount: 4 });
    expect(album.cover).toMatchObject({ id: ids[3], thumbUrl: expect.stringMatching(/^\/uploads\/thumbs\//) });

    // Guest: list, detail, photos newest first across pages.
    const list = (await ctx.http.get(`${api}/albums`).expect(200)).body;
    expect(list.map((a: { slug: string }) => a.slug)).toContain('barsat-angkor-wat');
    await ctx.http.get(`${api}/albums/barsat-angkor-wat`).expect(200).expect('Cache-Control', /public/);
    expect(await walk(ctx, `${api}/albums/barsat-angkor-wat/photos`, undefined, 3)).toEqual(ids.slice(0, 4).reverse());
    const guestPage = (await ctx.http.get(`${api}/albums/barsat-angkor-wat/photos`).expect(200)).body;
    expect(guestPage.items[0].isFavorite).toBeUndefined();

    // Signed in: favorite / save flags come along, same as the All tab.
    await ctx.http.put(`${api}/photos/${ids[1]}/favorite`).set(bearer(ctx.tokens.demo)).expect(204);
    const mine = (await ctx.http.get(`${api}/albums/barsat-angkor-wat/photos`).set(bearer(ctx.tokens.demo)).expect(200)).body;
    expect(mine.items.find((p: { id: number }) => p.id === ids[1])).toMatchObject({ isFavorite: true, isSaved: false });

    // A second album with the same name gets a unique slug; an explicit duplicate slug is a conflict.
    expect((await createAlbum({ name: 'Barsat Angkor Wat' })).slug).toBe('barsat-angkor-wat-2');
    await ctx.http.post(`${api}/admin/albums`).set(admin()).send({ name: 'X', slug: 'barsat-angkor-wat' }).expect(409);
    await ctx.http.post(`${api}/admin/albums`).set(admin()).send({ name: 'X', slug: 'Bad Slug' }).expect(400);
    await ctx.http.post(`${api}/admin/albums`).set(admin()).send({ name: '   ' }).expect(400);
  });

  it('adds and removes photos idempotently, skipping missing and trashed ones', async () => {
    const [a, b, c] = await uploadPhotos(ctx, 3);
    const album = await createAlbum({ name: 'Add remove' });
    await ctx.http.delete(`${api}/admin/photos/${c}`).set(admin()).expect(200);
    const add = await ctx.http.post(`${api}/admin/albums/${album.id}/photos`).set(admin()).send({ photoIds: [a, b, b, c, 999999] }).expect(200);
    expect(add.body).toMatchObject({ changed: 2, album: { photoCount: 2 } });
    expect((await ctx.http.post(`${api}/admin/albums/${album.id}/photos`).set(admin()).send({ photoIds: [a] }).expect(200)).body.changed).toBe(0);

    const rm = await ctx.http.post(`${api}/admin/albums/${album.id}/photos/remove`).set(admin()).send({ photoIds: [a, 424242] }).expect(200);
    expect(rm.body).toMatchObject({ changed: 1, album: { photoCount: 1 } });
    await ctx.http.post(`${api}/admin/albums/${album.id}/photos`).set(admin()).send({ photoIds: [] }).expect(400);
    await ctx.http.post(`${api}/admin/albums/999999/photos`).set(admin()).send({ photoIds: [a] }).expect(404);
  });

  it('hides trashed photos until restored and drops hard-deleted ones', async () => {
    const [a, b] = await uploadPhotos(ctx, 2);
    const album = await createAlbum({ name: 'Trash', photoIds: [a, b] });
    await ctx.http.delete(`${api}/admin/photos/${b}`).set(admin()).expect(200);
    expect(await walk(ctx, `${api}/albums/${album.slug}/photos`)).toEqual([a]);
    expect((await ctx.http.get(`${api}/albums/${album.slug}`).expect(200)).body).toMatchObject({ photoCount: 1, cover: { id: a } });
    await ctx.http.post(`${api}/admin/photos/${b}/restore`).set(admin()).expect(200);
    expect(await walk(ctx, `${api}/albums/${album.slug}/photos`)).toEqual([b, a]);
    await ctx.http.delete(`${api}/admin/photos/${b}/permanent`).set(admin()).expect(204);
    expect(await walk(ctx, `${api}/albums/${album.slug}/photos`)).toEqual([a]);
  });

  it('keeps hidden albums from guests and users but not from album managers', async () => {
    const [a] = await uploadPhotos(ctx, 1);
    const album = await createAlbum({ name: 'Secret draft', hidden: true, photoIds: [a] });
    const slugs = async (token?: string) => {
      const r = ctx.http.get(`${api}/albums`);
      if (token) r.set(bearer(token));
      return (await r.expect(200)).body.map((x: { slug: string }) => x.slug);
    };
    expect(await slugs()).not.toContain(album.slug);
    expect(await slugs(ctx.tokens.demo)).not.toContain(album.slug);
    expect(await slugs(ctx.tokens.admin)).toContain(album.slug);
    await ctx.http.get(`${api}/albums/${album.slug}`).expect(404);
    await ctx.http.get(`${api}/albums/${album.slug}/photos`).set(bearer(ctx.tokens.demo)).expect(404);
    await ctx.http.get(`${api}/albums/${album.slug}/photos`).set(admin()).expect(200);
    // The photo detail lists only the albums the caller may see.
    expect((await ctx.http.get(`${api}/photos/${a}`).expect(200)).body.albums).toEqual([]);
    expect((await ctx.http.get(`${api}/photos/${a}`).set(admin()).expect(200)).body.albums).toEqual([{ id: album.id, slug: album.slug, name: 'Secret draft' }]);

    // Publishing makes it public; its shared link gets Open Graph tags.
    await ctx.http.patch(`${api}/admin/albums/${album.id}`).set(admin()).send({ hidden: false, name: 'Koh Ker', description: 'Temple day' }).expect(200);
    expect((await ctx.http.get(`${api}/photos/${a}`).expect(200)).body.albums).toEqual([{ id: album.id, slug: album.slug, name: 'Koh Ker' }]);
    const page = await ctx.http.get(`/albums/${album.slug}`).set('Accept', 'text/html').expect(200);
    expect(page.text).toContain('<meta property="og:title" content="Koh Ker · Pre-Wedding View" />');
    expect(page.text).toContain('<meta property="og:description" content="Temple day" />');
    expect(page.text).toMatch(new RegExp(`og:image" content="https://example.test/api/v1/photos/${a}/og.jpg\\?v=`));
  });

  it('edits the cover and slug, and deleting an album keeps its photos', async () => {
    const [a, b, outside] = await uploadPhotos(ctx, 3);
    const album = await createAlbum({ name: 'Cover test', photoIds: [a, b] });
    expect(album.cover.id).toBe(b);
    const patch = (body: Record<string, unknown>) => ctx.http.patch(`${api}/admin/albums/${album.id}`).set(admin()).send(body);
    expect((await patch({ coverPhotoId: a }).expect(200)).body).toMatchObject({ coverPhotoId: a, cover: { id: a } });
    await patch({ coverPhotoId: outside }).expect(400);
    // Removing the chosen cover falls back to automatic.
    await ctx.http.post(`${api}/admin/albums/${album.id}/photos/remove`).set(admin()).send({ photoIds: [a] }).expect(200);
    expect((await ctx.http.get(`${api}/albums/${album.slug}`).expect(200)).body).toMatchObject({ coverPhotoId: null, cover: { id: b } });

    expect((await patch({ slug: 'cover-renamed' }).expect(200)).body.slug).toBe('cover-renamed');
    await ctx.http.get(`${api}/albums/${album.slug}`).expect(404);

    await ctx.http.delete(`${api}/admin/albums/${album.id}`).set(admin()).expect(204);
    await ctx.http.get(`${api}/albums/cover-renamed`).expect(404);
    await ctx.http.get(`${api}/photos/${b}`).expect(200);
  });

  it('requires albums.manage for every admin route, which can be granted to a user', async () => {
    const [a] = await uploadPhotos(ctx, 1);
    const album = await createAlbum({ name: 'Perms' });
    const routes: [string, string, object?][] = [
      ['post', '/admin/albums', { name: 'x' }],
      ['patch', `/admin/albums/${album.id}`, { name: 'x' }],
      ['delete', `/admin/albums/${album.id}`],
      ['post', `/admin/albums/${album.id}/photos`, { photoIds: [a] }],
      ['post', `/admin/albums/${album.id}/photos/remove`, { photoIds: [a] }],
    ];
    const http = ctx.http as unknown as Record<string, (u: string) => import('supertest').Test>;
    for (const [m, p, body] of routes) {
      await http[m](api + p).send(body).expect(401);
      await http[m](api + p).set(bearer(ctx.tokens.demo)).send(body).expect(403);
    }

    await ctx.http
      .post(`${api}/admin/users`)
      .set(admin())
      .send({ username: 'curator', role: 'user', password: 'curator-pass-1', grants: ['albums.manage'] })
      .expect(201);
    const login = await ctx.http.post(`${api}/auth/login`).send({ username: 'curator', password: 'curator-pass-1' }).expect(200);
    const curator = bearer(login.body.accessToken);
    await ctx.http.post(`${api}/admin/albums/${album.id}/photos`).set(curator).send({ photoIds: [a] }).expect(200);
    await ctx.http.get(`${api}/admin/photos/export.csv`).set(curator).expect(403); // export is its own permission
  });

  it('exports an album as CSV and lists every album a photo is in', async () => {
    const [a, b, c] = await uploadPhotos(ctx, 3);
    const one = await createAlbum({ name: 'Export One', photoIds: [a, b] });
    await createAlbum({ name: 'Export Two', photoIds: [a] });
    await ctx.http.put(`${api}/photos/${b}/favorite`).set(bearer(ctx.tokens.demo)).expect(204);
    const csv = async (q: string) => {
      const res = await ctx.http.get(`${api}/admin/photos/export.csv?${q}`).set(admin()).expect(200);
      const [header, ...rows] = res.text.replace(/^﻿/, '').trim().split('\r\n');
      return { name: res.headers['content-disposition'], header: header.split(','), rows };
    };

    const all = await csv(`album=${one.id}`);
    expect(all.name).toMatch(/filename="prewedding-album-export-one-\d{4}-\d{2}-\d{2}\.csv"/);
    expect(all.rows.map((r) => Number(r.split(',')[0]))).toEqual([b, a]);
    const col = all.header.indexOf('albums');
    expect(col).toBeGreaterThan(0);
    expect(all.rows[1].split(',')[col]).toBe('Export One | Export Two');

    const favs = await csv(`album=${one.id}&collection=favorites`);
    expect(favs.name).toMatch(/filename="prewedding-album-export-one-favorites-/);
    expect(favs.rows.map((r) => Number(r.split(',')[0]))).toEqual([b]);
    expect((await csv('status=active')).rows.some((r) => r.startsWith(`${c},`))).toBe(true);
    await ctx.http.get(`${api}/admin/photos/export.csv?album=999999`).set(admin()).expect(404);
  });
});
