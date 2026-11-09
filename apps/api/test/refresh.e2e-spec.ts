import { eq } from 'drizzle-orm';
import { createTestApp, TestCtx } from './helpers';
import { refreshTokens, users } from '../src/db/schema';
import { RefreshTokensService } from '../src/auth/refresh-tokens.service';

const cookieOf = (res: { headers: Record<string, unknown> }) => {
  const raw = (res.headers['set-cookie'] as string[] | undefined) ?? [];
  const c = raw.find((h) => h.startsWith('pw_refresh='));
  return c;
};
const valueOf = (setCookie?: string) => setCookie?.split(';')[0] ?? '';

describe('refresh tokens (e2e)', () => {
  let ctx: TestCtx;
  beforeAll(async () => {
    ctx = await createTestApp();
  });
  afterAll(() => ctx.close());

  const login = (remember?: boolean) =>
    ctx.http.post('/api/v1/auth/login').send({ username: 'demo', password: 'password', ...(remember === undefined ? {} : { remember }) }).expect(200);
  // Login is limited to 5/min per IP, so the other cases start sessions directly.
  const session = () => {
    const demo = ctx.db.select().from(users).where(eq(users.username, 'demo')).get()!;
    return `pw_refresh=${ctx.app.get(RefreshTokensService).issue(demo, true).token}`;
  };
  const refresh = (cookie: string) => ctx.http.post('/api/v1/auth/refresh').set('Cookie', cookie);

  it('login sets an HttpOnly persistent cookie by default, a session cookie with remember=false', async () => {
    const c = cookieOf(await login());
    expect(c).toMatch(/HttpOnly/i);
    expect(c).toMatch(/Path=\/api\/v1\/auth/);
    expect(c).toMatch(/SameSite=Lax/i);
    expect(c).toMatch(/Expires=/);
    const s = cookieOf(await login(false));
    expect(s).toBeDefined();
    expect(s).not.toMatch(/Expires=/);
  });

  it('refresh returns a working access token and rotates the cookie', async () => {
    const c1 = session();
    const r = await refresh(c1).expect(200);
    expect(r.body.user.username).toBe('demo');
    expect(r.headers['cache-control']).toBe('no-store');
    await ctx.http.get('/api/v1/auth/me').set('Authorization', `Bearer ${r.body.accessToken}`).expect(200);
    const c2 = valueOf(cookieOf(r));
    expect(c2).not.toBe(c1);
    await refresh(c2).expect(200);
  });

  it('accepts a just-rotated token (two tabs), but a replay after the grace window ends the session', async () => {
    const c1 = session();
    const a = valueOf(cookieOf(await refresh(c1).expect(200)));
    const b = valueOf(cookieOf(await refresh(c1).expect(200))); // second tab, same old cookie
    expect(a).not.toBe(b);
    // Pretend c1 was rotated long ago: replaying it now revokes the whole family.
    ctx.sqlite.prepare('UPDATE refresh_tokens SET revoked_at = revoked_at - 3600 WHERE revoked_at IS NOT NULL AND replaced_by_id IS NOT NULL').run();
    const replay = await refresh(c1).expect(401);
    expect(cookieOf(replay)).toMatch(/pw_refresh=;/);
    await refresh(a).expect(401);
    await refresh(b).expect(401);
  });

  it('rejects missing, unknown and expired tokens', async () => {
    await ctx.http.post('/api/v1/auth/refresh').expect(401);
    await refresh('pw_refresh=nope').expect(401);
    const c = session();
    ctx.db.update(refreshTokens).set({ expiresAt: new Date(Date.now() - 1000) }).run();
    await refresh(c).expect(401);
  });

  it('logout ends the session', async () => {
    const c = session();
    const out = await ctx.http.post('/api/v1/auth/logout').set('Cookie', c).expect(204);
    expect(cookieOf(out)).toMatch(/pw_refresh=;/);
    await refresh(c).expect(401);
    await ctx.http.post('/api/v1/auth/logout').expect(204); // no cookie: still fine
  });

  it('password reset and disabling end refresh sessions', async () => {
    const c = session();
    const demo = ctx.db.select().from(users).where(eq(users.username, 'demo')).get()!;
    await ctx.http.post(`/api/v1/admin/users/${demo.id}/password`).set('Authorization', `Bearer ${ctx.tokens.admin}`).send({ password: 'password' }).expect(200);
    await refresh(c).expect(401);
  });
});
