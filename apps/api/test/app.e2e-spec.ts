import { existsSync } from 'fs';
import { join } from 'path';
import { createTestApp, makeJpeg, TestCtx, uploadPhotos, walk } from './helpers';
import { photos } from '../src/db/schema';
import { encodeCursor } from '../src/common/cursor';

const api = '/api/v1';
let ctx: TestCtx;
const bearer = (t: string) => ({ Authorization: `Bearer ${t}` });

beforeAll(async () => {
  ctx = await createTestApp();
});
afterAll(async () => {
  await ctx.close();
});

describe('auth', () => {
  it('logs in and returns the profile', async () => {
    const res = await ctx.http.post(`${api}/auth/login`).send({ username: 'demo', password: 'password' }).expect(200);
    expect(res.body).toMatchObject({ tokenType: 'Bearer', expiresIn: 3600, user: { username: 'demo', role: 'user' } });
    const me = await ctx.http.get(`${api}/auth/me`).set(bearer(res.body.accessToken)).expect(200);
    expect(me.body).toEqual({ id: expect.any(Number), username: 'demo', role: 'user', permissions: [] });
  });

  it('fails with the same generic 401 for a bad password or unknown user', async () => {
    const a = await ctx.http.post(`${api}/auth/login`).send({ username: 'demo', password: 'nope' }).expect(401);
    const b = await ctx.http.post(`${api}/auth/login`).send({ username: 'ghost', password: 'nope' }).expect(401);
    expect(a.body).toEqual({ statusCode: 401, error: 'Unauthorized', message: 'Invalid username or password' });
    expect(b.body).toEqual(a.body);
  });

  it('rejects an invalid token on public endpoints instead of silently treating it as a guest', async () => {
    await ctx.http.get(`${api}/photos`).set(bearer('garbage')).expect(401);
  });
});

describe('access control', () => {
  let id: number;
  beforeAll(async () => {
    [id] = await uploadPhotos(ctx, 1);
  });

  const userRoutes: [string, string][] = [
    ['get', '/auth/me'],
    ['get', '/me/favorites'],
    ['get', '/me/saves'],
    ['put', '/photos/:id/favorite'],
    ['delete', '/photos/:id/favorite'],
    ['put', '/photos/:id/save'],
    ['delete', '/photos/:id/save'],
  ];
  const adminRoutes: [string, string][] = [
    ['get', '/admin/photos'],
    ['post', '/admin/photos'],
    ['patch', '/admin/photos/:id'],
    ['delete', '/admin/photos/:id'],
    ['post', '/admin/photos/:id/restore'],
    ['delete', '/admin/photos/:id/permanent'],
  ];
  const call = (m: string, p: string) =>
    (ctx.http as unknown as Record<string, (u: string) => import('supertest').Test>)[m](api + p.replace(':id', String(id)));

  it.each(userRoutes)('%s %s requires a token (401)', async (m, p) => {
    await call(m, p).expect(401);
  });
  it.each(adminRoutes)('%s %s returns 401 for guests and 403 for users', async (m, p) => {
    await call(m, p).expect(401);
    await call(m, p).set(bearer(ctx.tokens.demo)).expect(403);
  });
  it('public routes work for guests', async () => {
    await ctx.http.get(`${api}/photos`).expect(200);
    await ctx.http.get(`${api}/photos/${id}`).expect(200);
  });
});

describe('favorites and saves', () => {
  it('are idempotent and reflected in flags and lists', async () => {
    const [id] = await uploadPhotos(ctx, 1);
    for (const verb of ['favorite', 'save']) {
      await ctx.http.put(`${api}/photos/${id}/${verb}`).set(bearer(ctx.tokens.demo)).expect(204);
      await ctx.http.put(`${api}/photos/${id}/${verb}`).set(bearer(ctx.tokens.demo)).expect(204);
    }
    const detail = await ctx.http.get(`${api}/photos/${id}`).set(bearer(ctx.tokens.demo)).expect(200);
    expect(detail.body).toMatchObject({ isFavorite: true, isSaved: true });
    const guest = await ctx.http.get(`${api}/photos/${id}`).expect(200);
    expect(guest.body.isFavorite).toBeUndefined();
    const favs = await ctx.http.get(`${api}/me/favorites`).set(bearer(ctx.tokens.demo)).expect(200);
    expect(favs.body.items.filter((p: { id: number }) => p.id === id)).toHaveLength(1);
    for (const verb of ['favorite', 'save']) {
      await ctx.http.delete(`${api}/photos/${id}/${verb}`).set(bearer(ctx.tokens.demo)).expect(204);
      await ctx.http.delete(`${api}/photos/${id}/${verb}`).set(bearer(ctx.tokens.demo)).expect(204);
    }
    const after = await ctx.http.get(`${api}/photos/${id}`).set(bearer(ctx.tokens.demo)).expect(200);
    expect(after.body).toMatchObject({ isFavorite: false, isSaved: false });
  });

  it('404s when favoriting a missing photo', async () => {
    await ctx.http.put(`${api}/photos/999999/favorite`).set(bearer(ctx.tokens.demo)).expect(404);
  });
});

describe('soft delete, restore, hard delete', () => {
  it('soft delete hides the photo everywhere and moves files to .trash; restore brings it back', async () => {
    const [id] = await uploadPhotos(ctx, 1);
    await ctx.http.put(`${api}/photos/${id}/favorite`).set(bearer(ctx.tokens.demo)).expect(204);
    await ctx.http.put(`${api}/photos/${id}/save`).set(bearer(ctx.tokens.demo)).expect(204);
    const { url, thumbUrl } = (await ctx.http.get(`${api}/photos/${id}`).expect(200)).body;
    await ctx.http.get(url).expect(200);
    await ctx.http.get(thumbUrl).expect(200).expect('Cache-Control', /immutable/);

    const del = await ctx.http.delete(`${api}/admin/photos/${id}`).set(bearer(ctx.tokens.admin)).expect(200);
    expect(del.body.deletedAt).not.toBeNull();
    await ctx.http.get(`${api}/photos/${id}`).expect(404);
    await ctx.http.get(url).expect(404);
    await ctx.http.get(thumbUrl).expect(404);
    expect(existsSync(join(ctx.uploadDir, '.trash', url.split('/').pop()))).toBe(true);
    await ctx.http.get(`/uploads/.trash/${url.split('/').pop()}`).expect(404);
    const ids = async (path: string, token?: string) => walk(ctx, path, token, 60);
    expect(await ids(`${api}/photos`)).not.toContain(id);
    expect(await ids(`${api}/me/favorites`, ctx.tokens.demo)).not.toContain(id);
    expect(await ids(`${api}/me/saves`, ctx.tokens.demo)).not.toContain(id);
    expect(await ids(`${api}/admin/photos?status=deleted`, ctx.tokens.admin)).toContain(id);
    expect(await ids(`${api}/admin/photos?status=active`, ctx.tokens.admin)).not.toContain(id);
    // admin can still see the detail
    await ctx.http.get(`${api}/photos/${id}`).set(bearer(ctx.tokens.admin)).expect(200);

    await ctx.http.post(`${api}/admin/photos/${id}/restore`).set(bearer(ctx.tokens.admin)).expect(200);
    await ctx.http.get(url).expect(200);
    expect(await ids(`${api}/photos`)).toContain(id);
    expect(await ids(`${api}/me/favorites`, ctx.tokens.demo)).toContain(id);
    expect(await ids(`${api}/me/saves`, ctx.tokens.demo)).toContain(id);
  });

  it('hard delete removes the row, files and favorite/save rows', async () => {
    const [id] = await uploadPhotos(ctx, 1);
    await ctx.http.put(`${api}/photos/${id}/favorite`).set(bearer(ctx.tokens.demo)).expect(204);
    await ctx.http.put(`${api}/photos/${id}/save`).set(bearer(ctx.tokens.demo)).expect(204);
    const { url, thumbUrl } = (await ctx.http.get(`${api}/photos/${id}`).expect(200)).body;
    await ctx.http.delete(`${api}/admin/photos/${id}`).set(bearer(ctx.tokens.admin)).expect(200); // trash first
    await ctx.http.delete(`${api}/admin/photos/${id}/permanent`).set(bearer(ctx.tokens.admin)).expect(204);
    await ctx.http.get(`${api}/photos/${id}`).set(bearer(ctx.tokens.admin)).expect(404);
    await ctx.http.post(`${api}/admin/photos/${id}/restore`).set(bearer(ctx.tokens.admin)).expect(404);
    for (const f of [url, thumbUrl]) {
      const name = f.split('/').pop();
      expect(existsSync(join(ctx.uploadDir, name))).toBe(false);
      expect(existsSync(join(ctx.uploadDir, '.trash', name))).toBe(false);
      expect(existsSync(join(ctx.uploadDir, 'thumbs', name))).toBe(false);
      expect(existsSync(join(ctx.uploadDir, '.trash', 'thumbs', name))).toBe(false);
    }
    const count = (t: string) => (ctx.sqlite.prepare(`SELECT COUNT(*) n FROM ${t} WHERE photo_id = ?`).get(id) as { n: number }).n;
    expect(count('favorites')).toBe(0);
    expect(count('saves')).toBe(0);
  });
});

describe('upload', () => {
  it('rejects a non-image renamed to .jpg and keeps nothing', async () => {
    const before = ctx.db.select().from(photos).all().length;
    const res = await ctx.http
      .post(`${api}/admin/photos`)
      .set(bearer(ctx.tokens.admin))
      .attach('files', await makeJpeg(), 'good.jpg')
      .attach('files', Buffer.from('<?php echo "hi"; ?>'), { filename: 'evil.jpg', contentType: 'image/jpeg' })
      .expect(400);
    expect(res.body.message).toMatch(/evil\.jpg/);
    expect(ctx.db.select().from(photos).all().length).toBe(before);
  });

  it('applies title and caption and returns width/height', async () => {
    const res = await ctx.http
      .post(`${api}/admin/photos`)
      .set(bearer(ctx.tokens.admin))
      .attach('files', await makeJpeg(120, 80), 'a.jpg')
      .field('title', 'Golden hour')
      .field('caption', 'Angkor Wat')
      .expect(201);
    expect(res.body[0]).toMatchObject({ title: 'Golden hour', caption: 'Angkor Wat', width: 120, height: 80 });
    expect(res.body[0].url).toMatch(/^\/uploads\/[0-9a-f-]{36}\.jpg$/);
    expect(res.body[0].thumbUrl).toMatch(/^\/uploads\/thumbs\/[0-9a-f-]{36}\.webp$/);
  });

  it('PATCH updates title and caption', async () => {
    const [id] = await uploadPhotos(ctx, 1);
    const res = await ctx.http.patch(`${api}/admin/photos/${id}`).set(bearer(ctx.tokens.admin)).send({ title: 'New' }).expect(200);
    expect(res.body.title).toBe('New');
  });
});

describe('cursor pagination', () => {
  it('walks every page with no duplicates or gaps', async () => {
    await uploadPhotos(ctx, 8);
    const all = ctx.sqlite.prepare('SELECT id FROM photos WHERE deleted_at IS NULL ORDER BY id DESC').all() as { id: number }[];
    const ids = await walk(ctx, `${api}/photos`, undefined, 3);
    expect(ids).toEqual(all.map((r) => r.id));
  });

  it('stays consistent when photos are uploaded or soft-deleted between pages', async () => {
    await uploadPhotos(ctx, 6);
    const before = (ctx.sqlite.prepare('SELECT id FROM photos WHERE deleted_at IS NULL ORDER BY id DESC').all() as { id: number }[]).map((r) => r.id);
    let deleted = -1;
    const ids = await walk(ctx, `${api}/photos`, ctx.tokens.demo, 3, async (page) => {
      if (page === 0) await uploadPhotos(ctx, 2); // new photos land above the cursor: never seen this walk
      if (page === 1) {
        deleted = before[before.length - 1]; // an older photo not reached yet
        await ctx.http.delete(`${api}/admin/photos/${deleted}`).set(bearer(ctx.tokens.admin)).expect(200);
      }
    });
    expect(new Set(ids).size).toBe(ids.length);
    expect(ids).toEqual(before.filter((id) => id !== deleted));
    await ctx.http.post(`${api}/admin/photos/${deleted}/restore`).set(bearer(ctx.tokens.admin)).expect(200);
  });

  it('walks favorites in favorited order', async () => {
    const ids = await uploadPhotos(ctx, 5);
    for (const id of ids) await ctx.http.put(`${api}/photos/${id}/favorite`).set(bearer(ctx.tokens.admin)).expect(204);
    const walked = await walk(ctx, `${api}/me/favorites`, ctx.tokens.admin, 2);
    // same-second timestamps fall back to photo_id DESC
    expect(walked).toEqual([...ids].reverse());
  });

  it('clamps limit and rejects malformed or foreign cursors', async () => {
    await uploadPhotos(ctx, 1);
    const big = await ctx.http.get(`${api}/photos`).query({ limit: 500 }).expect(200);
    expect(big.body.items.length).toBeLessThanOrEqual(60);
    const zero = await ctx.http.get(`${api}/photos`).query({ limit: 0 }).expect(200);
    expect(zero.body.items).toHaveLength(1);
    await ctx.http.get(`${api}/photos`).query({ cursor: 'not-json' }).expect(400);
    await ctx.http.get(`${api}/photos`).query({ cursor: Buffer.from('{"k":"p","id":"1 OR 1=1"}').toString('base64url') }).expect(400);
    await ctx.http.get(`${api}/photos`).query({ cursor: encodeCursor('f', { t: 1, id: 1 }) }).expect(400);
    await ctx.http.get(`${api}/me/favorites`).set(bearer(ctx.tokens.demo)).query({ cursor: encodeCursor('p', { id: 5 }) }).expect(400);
    await ctx.http.get(`${api}/photos`).query({ cursor: encodeCursor('p', { id: 5 }) }).expect(200);
  });
});

describe('caching', () => {
  it('sets cache headers per audience', async () => {
    await ctx.http.get(`${api}/photos`).expect('Cache-Control', 'public, max-age=30, stale-while-revalidate=60').expect('Vary', /Authorization/);
    await ctx.http.get(`${api}/photos`).set(bearer(ctx.tokens.demo)).expect('Cache-Control', 'private, no-cache');
    await ctx.http.get(`${api}/me/favorites`).set(bearer(ctx.tokens.demo)).expect('Cache-Control', 'no-store');
    await ctx.http.get(`${api}/admin/photos`).set(bearer(ctx.tokens.admin)).expect('Cache-Control', 'no-store');
  });

  it('answers 304 for an unchanged list', async () => {
    const first = await ctx.http.get(`${api}/photos`).expect(200);
    await ctx.http.get(`${api}/photos`).set('If-None-Match', first.headers.etag).expect(304);
  });

  it('invalidates the guest list cache on upload, soft delete, restore and hard delete', async () => {
    const top = async () => (await ctx.http.get(`${api}/photos`).query({ limit: 1 }).expect(200)).body.items[0]?.id;
    await top(); // warm
    const [id] = await uploadPhotos(ctx, 1);
    expect(await top()).toBe(id);
    await ctx.http.delete(`${api}/admin/photos/${id}`).set(bearer(ctx.tokens.admin)).expect(200);
    expect(await top()).not.toBe(id);
    await ctx.http.post(`${api}/admin/photos/${id}/restore`).set(bearer(ctx.tokens.admin)).expect(200);
    expect(await top()).toBe(id);
    await ctx.http.delete(`${api}/admin/photos/${id}/permanent`).set(bearer(ctx.tokens.admin)).expect(204);
    expect(await top()).not.toBe(id);
  });
});
