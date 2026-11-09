import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { createTestApp, TestCtx, uploadPhotos } from './helpers';

const api = '/api/v1';
const bearer = (t: string) => ({ Authorization: `Bearer ${t}` });
let ctx: TestCtx;
let webDir: string;
let dara: string; // a third account the links are not shared with
let darId: number;
let demoId: number;

beforeAll(async () => {
  webDir = mkdtempSync(join(tmpdir(), 'pw-web-'));
  mkdirSync(join(webDir, 'assets'));
  writeFileSync(join(webDir, 'index.html'), '<!doctype html><html><head><meta name="description" content="x" /><title>Pre-Wedding View</title></head><body><div id="root"></div></body></html>');
  ctx = await createTestApp({ WEB_DIST_DIR: webDir, PUBLIC_URL: 'https://example.test/' });
  // Same password hash as demo ("password").
  ctx.sqlite.prepare("INSERT INTO users (username, password_hash, role) SELECT 'dara', password_hash, 'user' FROM users WHERE username = 'demo'").run();
  dara = (await ctx.http.post(`${api}/auth/login`).send({ username: 'dara', password: 'password' }).expect(200)).body.accessToken;
  darId = (ctx.sqlite.prepare("SELECT id FROM users WHERE username = 'dara'").get() as { id: number }).id;
  demoId = (ctx.sqlite.prepare("SELECT id FROM users WHERE username = 'demo'").get() as { id: number }).id;
});
afterAll(async () => {
  await ctx.close();
  rmSync(webDir, { recursive: true, force: true });
});

const admin = () => bearer(ctx.tokens.admin);
const demo = () => bearer(ctx.tokens.demo);
const ids = (res: { body: { items: { id: number }[] } }) => res.body.items.map((p) => p.id);

describe('share links', () => {
  it('makes a public link anyone can open, with only the selected active photos', async () => {
    const [a, b, c, d] = await uploadPhotos(ctx, 4);
    await ctx.http.delete(`${api}/admin/photos/${c}`).set(admin()).expect(200);

    const res = await ctx.http.post(`${api}/shares`).set(demo()).send({ photoIds: [a, b, c, 999999], title: 'For Mom' }).expect(201);
    const s = res.body;
    expect(s).toMatchObject({ title: 'For Mom', visibility: 'public', photoCount: 2, canManage: true, people: [], expired: false, expiresAt: null });
    expect(s.token).toMatch(/^[A-Za-z0-9_-]{22}$/);
    expect(s.path).toBe(`/s/${s.token}`);
    expect(s.createdBy.username).toBe('demo');
    expect(s.cover.id).toBe(b);

    // Guests see it, without management details.
    const guest = (await ctx.http.get(`${api}/shares/${s.token}`).expect(200)).body;
    expect(guest).toMatchObject({ title: 'For Mom', photoCount: 2, canManage: false });
    expect(guest.people).toBeUndefined();
    expect(ids(await ctx.http.get(`${api}/shares/${s.token}/photos`).expect(200))).toEqual([b, a]);
    expect(ids(await ctx.http.get(`${api}/shares/${s.token}/photos`).expect(200))).not.toContain(d);
    // Signed in: favorite flags come along. Paging works.
    const p1 = await ctx.http.get(`${api}/shares/${s.token}/photos?limit=1`).set(demo()).expect(200);
    expect(p1.body.items[0]).toMatchObject({ id: b, isFavorite: false });
    expect(ids(await ctx.http.get(`${api}/shares/${s.token}/photos?limit=1&cursor=${p1.body.nextCursor}`).expect(200))).toEqual([a]);

    // A photo trashed when the link was made was never added, so restoring it does not bring it in.
    await ctx.http.post(`${api}/admin/photos/${c}/restore`).set(admin()).expect(200);
    expect(ids(await ctx.http.get(`${api}/shares/${s.token}/photos`).expect(200))).toEqual([b, a]);
    // Trashing one hides it until restored.
    await ctx.http.delete(`${api}/admin/photos/${a}`).set(admin()).expect(200);
    expect((await ctx.http.get(`${api}/shares/${s.token}`).expect(200)).body.photoCount).toBe(1);

    // Open Graph card for the link.
    const html = await ctx.http.get(`/s/${s.token}`).set('Accept', 'text/html').expect(200);
    expect(html.text).toContain('<title>For Mom · Pre-Wedding View</title>');
    expect(html.text).toContain(`og:url" content="https://example.test/s/${s.token}"`);
    expect(html.text).toContain('demo shared 1 photo');

    await ctx.http.get(`${api}/shares/nope`).expect(400);
    await ctx.http.get(`${api}/shares/AAAAAAAAAAAAAAAAAAAAAA`).expect(404);
    await ctx.http.post(`${api}/shares`).send({ photoIds: [b] }).expect(401);
    await ctx.http.post(`${api}/shares`).set(demo()).send({ photoIds: [] }).expect(400);
    await ctx.http.post(`${api}/shares`).set(demo()).send({ photoIds: [999998] }).expect(400);
  });

  it('keeps a private link to the chosen people, the creator and admins', async () => {
    const [a] = await uploadPhotos(ctx, 1);
    await ctx.http.post(`${api}/shares`).set(admin()).send({ photoIds: [a], visibility: 'private' }).expect(400); // nobody chosen
    await ctx.http.post(`${api}/shares`).set(admin()).send({ photoIds: [a], visibility: 'private', userIds: [424242] }).expect(400);

    const people = (await ctx.http.get(`${api}/shares/people`).set(admin()).expect(200)).body.map((u: { username: string }) => u.username);
    expect(people).toEqual(expect.arrayContaining(['dara', 'demo']));
    expect(people).not.toContain('admin');

    const s = (await ctx.http.post(`${api}/shares`).set(admin()).send({ photoIds: [a], visibility: 'private', userIds: [demoId], expiresInDays: 7 }).expect(201)).body;
    expect(s.people).toEqual([{ id: demoId, username: 'demo' }]);
    expect(new Date(s.expiresAt).getTime()).toBeGreaterThan(Date.now() + 6 * 86_400_000);

    await ctx.http.get(`${api}/shares/${s.token}`).expect(401);
    await ctx.http.get(`${api}/shares/${s.token}/photos`).expect(401);
    await ctx.http.get(`${api}/shares/${s.token}`).set(bearer(dara)).expect(403);
    expect(ids(await ctx.http.get(`${api}/shares/${s.token}/photos`).set(demo()).expect(200))).toEqual([a]);
    const asDemo = (await ctx.http.get(`${api}/shares/${s.token}`).set(demo()).expect(200)).body;
    expect(asDemo.canManage).toBe(false);
    expect(asDemo.people).toBeUndefined();

    // The private card gives nothing away.
    const html = await ctx.http.get(`/s/${s.token}`).set('Accept', 'text/html').expect(200);
    expect(html.text).toContain('Photos shared with you · Pre-Wedding View');

    // It shows up under "shared with me"; the recipient can't edit it.
    const mine = (await ctx.http.get(`${api}/me/shares`).set(demo()).expect(200)).body;
    expect(mine.received.map((x: { id: number }) => x.id)).toContain(s.id);
    expect(mine.others).toBeUndefined();
    await ctx.http.patch(`${api}/shares/${s.id}`).set(demo()).send({ title: 'x' }).expect(404);
    await ctx.http.delete(`${api}/shares/${s.id}`).set(demo()).expect(404);

    // Swap who it's for.
    const moved = (await ctx.http.patch(`${api}/shares/${s.id}`).set(admin()).send({ userIds: [darId] }).expect(200)).body;
    expect(moved.people.map((u: { username: string }) => u.username)).toEqual(['dara']);
    await ctx.http.get(`${api}/shares/${s.token}`).set(demo()).expect(403);
    await ctx.http.get(`${api}/shares/${s.token}`).set(bearer(dara)).expect(200);

    // Make it public, then expire it.
    await ctx.http.patch(`${api}/shares/${s.id}`).set(admin()).send({ visibility: 'public' }).expect(200);
    await ctx.http.get(`${api}/shares/${s.token}`).expect(200);
    ctx.sqlite.prepare('UPDATE shares SET expires_at = unixepoch() - 1 WHERE id = ?').run(s.id);
    await ctx.http.get(`${api}/shares/${s.token}`).expect(410);
    expect((await ctx.http.get(`${api}/shares/${s.token}`).set(admin()).expect(200)).body.expired).toBe(true); // the creator still can

    await ctx.http.delete(`${api}/shares/${s.id}`).set(admin()).expect(204);
    await ctx.http.get(`${api}/shares/${s.token}`).set(admin()).expect(404);
  });

  it('lists my links, and admins see everyone else’s and can delete them', async () => {
    const [a] = await uploadPhotos(ctx, 1);
    const s = (await ctx.http.post(`${api}/shares`).set(bearer(dara)).send({ photoIds: [a], title: 'Dara’s' }).expect(201)).body;
    const mine = (await ctx.http.get(`${api}/me/shares`).set(bearer(dara)).expect(200)).body;
    expect(mine.created[0]).toMatchObject({ id: s.id, title: 'Dara’s' });
    const adm = (await ctx.http.get(`${api}/me/shares`).set(admin()).expect(200)).body;
    expect(adm.others.find((x: { id: number }) => x.id === s.id)).toMatchObject({ canManage: true, createdBy: { username: 'dara' } });
    await ctx.http.delete(`${api}/shares/${s.id}`).set(admin()).expect(204);
    await ctx.http.get(`${api}/me/shares`).expect(401);
  });
});
