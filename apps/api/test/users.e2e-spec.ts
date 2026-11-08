import { JwtService } from '@nestjs/jwt';
import { eq } from 'drizzle-orm';
import { createTestApp, makeJpeg, TestCtx, uploadPhotos } from './helpers';
import { users } from '../src/db/schema';

const api = '/api/v1';
let ctx: TestCtx;
const bearer = (t: string) => ({ Authorization: `Bearer ${t}` });

/** Signs a token the way AuthService does, without spending the 5/min login budget. */
function tokenFor(username: string) {
  const u = ctx.db.select().from(users).where(eq(users.username, username)).get()!;
  return ctx.app.get(JwtService).sign({ sub: u.id, username: u.username, role: u.role, ver: u.tokenVersion }, { expiresIn: 3600 });
}
const idOf = (username: string) => ctx.db.select().from(users).where(eq(users.username, username)).get()!.id;

beforeAll(async () => {
  ctx = await createTestApp();
});
afterAll(async () => {
  await ctx.close();
});

describe('admin users API', () => {
  it('is admin-only', async () => {
    await ctx.http.get(`${api}/admin/users`).expect(401);
    await ctx.http.get(`${api}/admin/users`).set(bearer(ctx.tokens.demo)).expect(403);
    const res = await ctx.http.get(`${api}/admin/users`).set(bearer(ctx.tokens.admin)).expect(200);
    expect(res.body.map((u: { username: string }) => u.username)).toEqual(['admin', 'demo']);
    const perms = await ctx.http.get(`${api}/admin/users/permissions`).set(bearer(ctx.tokens.admin)).expect(200);
    expect(perms.body.find((p: { key: string }) => p.key === 'users.manage').grantable).toBe(false);
  });

  it('creates users with a role, grants and a generated or chosen password', async () => {
    const a = await ctx.http
      .post(`${api}/admin/users`)
      .set(bearer(ctx.tokens.admin))
      .send({ username: '  Tithya ', role: 'admin' })
      .expect(201);
    expect(a.body.user).toMatchObject({ username: 'tithya', role: 'admin', disabled: false });
    expect(a.body.user.permissions).toContain('users.manage');
    expect(a.body.generatedPassword).toMatch(/^[\w-]{16}$/);

    const d = await ctx.http
      .post(`${api}/admin/users`)
      .set(bearer(ctx.tokens.admin))
      .send({ username: 'dara', role: 'user', password: 'dara-pass-123', grants: ['photos.upload'] })
      .expect(201);
    expect(d.body.generatedPassword).toBeUndefined();
    expect(d.body.user).toMatchObject({ grants: ['photos.upload'], permissions: ['photos.upload'] });

    // Login is case-insensitive on the username and returns the permissions.
    const login = await ctx.http.post(`${api}/auth/login`).send({ username: 'Dara', password: 'dara-pass-123' }).expect(200);
    expect(login.body.user.permissions).toEqual(['photos.upload']);

    await ctx.http.post(`${api}/admin/users`).set(bearer(ctx.tokens.admin)).send({ username: 'dara', role: 'user' }).expect(409);
    await ctx.http.post(`${api}/admin/users`).set(bearer(ctx.tokens.admin)).send({ username: 'x', role: 'user' }).expect(400);
    await ctx.http.post(`${api}/admin/users`).set(bearer(ctx.tokens.admin)).send({ username: 'bob', role: 'owner' }).expect(400);
    await ctx.http.post(`${api}/admin/users`).set(bearer(ctx.tokens.admin)).send({ username: 'bob', role: 'user', password: 'short' }).expect(400);
    await ctx.http.post(`${api}/admin/users`).set(bearer(ctx.tokens.admin)).send({ username: 'bob', role: 'user', grants: ['users.manage'] }).expect(400);
  });

  it('gates photo actions by permission, and changes apply without a new login', async () => {
    const dara = tokenFor('dara');
    const up = ctx.http.post(`${api}/admin/photos`).set(bearer(dara)).attach('files', await makeJpeg(), 'KSNT0001.jpg');
    const [photo] = (await up.expect(201)).body;
    await ctx.http.get(`${api}/admin/photos/export.csv`).set(bearer(dara)).expect(403);
    await ctx.http.delete(`${api}/admin/photos/${photo.id}`).set(bearer(dara)).expect(403);
    await ctx.http.post(`${api}/admin/photos/${photo.id}/rotate`).set(bearer(dara)).send({ degrees: 90 }).expect(403);
    await ctx.http.get(`${api}/admin/users`).set(bearer(dara)).expect(403);

    await ctx.http
      .patch(`${api}/admin/users/${idOf('dara')}`)
      .set(bearer(ctx.tokens.admin))
      .send({ grants: ['photos.export', 'photos.delete'] })
      .expect(200);
    await ctx.http.get(`${api}/admin/photos/export.csv`).set(bearer(dara)).expect(200);
    await ctx.http.delete(`${api}/admin/photos/${photo.id}`).set(bearer(dara)).expect(200);
    await ctx.http.get(`${api}/photos/${photo.id}`).set(bearer(dara)).expect(200); // can open the trash
    await ctx.http.post(`${api}/admin/photos`).set(bearer(dara)).attach('files', await makeJpeg(), 'x.jpg').expect(403);
    const me = await ctx.http.get(`${api}/auth/me`).set(bearer(dara)).expect(200);
    expect(me.body.permissions).toEqual(['photos.delete', 'photos.export']);
  });

  it('disabling or resetting a password ends existing sessions', async () => {
    const id = idOf('dara');
    const before = tokenFor('dara');
    await ctx.http.patch(`${api}/admin/users/${id}`).set(bearer(ctx.tokens.admin)).send({ disabled: true }).expect(200);
    await ctx.http.get(`${api}/auth/me`).set(bearer(before)).expect(401);
    await ctx.http.post(`${api}/auth/login`).send({ username: 'dara', password: 'dara-pass-123' }).expect(401);
    await ctx.http.patch(`${api}/admin/users/${id}`).set(bearer(ctx.tokens.admin)).send({ disabled: false }).expect(200);

    const live = tokenFor('dara');
    await ctx.http.get(`${api}/auth/me`).set(bearer(live)).expect(200);
    const r = await ctx.http.post(`${api}/admin/users/${id}/password`).set(bearer(ctx.tokens.admin)).send({}).expect(200);
    expect(r.body.generatedPassword).toMatch(/^[\w-]{16}$/);
    await ctx.http.get(`${api}/auth/me`).set(bearer(live)).expect(401);
    await ctx.http.post(`${api}/auth/login`).send({ username: 'dara', password: r.body.generatedPassword }).expect(200);
  });

  it('protects against self-lockout and losing the last admin', async () => {
    const adminId = idOf('admin');
    await ctx.http.patch(`${api}/admin/users/${adminId}`).set(bearer(ctx.tokens.admin)).send({ role: 'user' }).expect(403);
    await ctx.http.patch(`${api}/admin/users/${adminId}`).set(bearer(ctx.tokens.admin)).send({ disabled: true }).expect(403);
    await ctx.http.delete(`${api}/admin/users/${adminId}`).set(bearer(ctx.tokens.admin)).expect(403);

    // tithya (another admin) may demote admin, but not then demote herself as the last one.
    const tithya = tokenFor('tithya');
    await ctx.http.patch(`${api}/admin/users/${adminId}`).set(bearer(tithya)).send({ role: 'user' }).expect(200);
    await ctx.http.get(`${api}/admin/users`).set(bearer(ctx.tokens.admin)).expect(403); // demotion is immediate
    await ctx.http.patch(`${api}/admin/users/${idOf('tithya')}`).set(bearer(tithya)).send({ role: 'user' }).expect(403);
    await ctx.http.patch(`${api}/admin/users/${adminId}`).set(bearer(tithya)).send({ role: 'admin' }).expect(200);
  });

  it('only deletes accounts that uploaded nothing', async () => {
    await uploadPhotos(ctx, 1);
    await ctx.http.delete(`${api}/admin/users/${idOf('dara')}`).set(bearer(ctx.tokens.admin)).expect(409); // uploaded a photo
    await ctx.http.delete(`${api}/admin/users/${idOf('demo')}`).set(bearer(ctx.tokens.admin)).expect(204);
    await ctx.http.get(`${api}/auth/me`).set(bearer(ctx.tokens.demo)).expect(401);
    await ctx.http.delete(`${api}/admin/users/9999`).set(bearer(ctx.tokens.admin)).expect(404);
  });
});
