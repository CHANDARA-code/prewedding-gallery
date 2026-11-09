import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { createTestApp, TestCtx, uploadPhotos } from './helpers';

let ctx: TestCtx;
let webDir: string;
let ids: number[];

beforeAll(async () => {
  webDir = mkdtempSync(join(tmpdir(), 'pw-web-'));
  mkdirSync(join(webDir, 'assets'));
  writeFileSync(join(webDir, 'index.html'), '<!doctype html><html><head><meta name="description" content="x" /><title>Pre-Wedding View</title></head><body><div id="root"></div></body></html>');
  // A fresh database numbers photos from 1, so photo 2 is the chosen site cover.
  ctx = await createTestApp({ WEB_DIST_DIR: webDir, PUBLIC_URL: 'https://example.test', SITE_COVER_PHOTO_ID: '2' });
  ids = await uploadPhotos(ctx, 3);
});
afterAll(async () => {
  await ctx.close();
  rmSync(webDir, { recursive: true, force: true });
});

const ogImage = async (path: string) =>
  /<meta property="og:image" content="([^"]+)"/.exec((await ctx.http.get(path).set('Accept', 'text/html').expect(200)).text)?.[1];

describe('site link preview', () => {
  it('uses SITE_COVER_PHOTO_ID for the home page, and the newest photo once that one is trashed', async () => {
    expect(ids).toEqual([1, 2, 3]);
    expect(await ogImage('/')).toMatch(/^https:\/\/example\.test\/api\/v1\/photos\/2\/og\.jpg\?v=/);
    expect(await ogImage('/favorite')).toMatch(/\/photos\/2\/og\.jpg/); // pages without their own image
    expect(await ogImage(`/photo/${ids[0]}`)).toMatch(/\/photos\/1\/og\.jpg/); // a photo link keeps its own card
    const card = await ctx.http.get('/api/v1/photos/2/og.jpg').buffer(true).expect(200).expect('Content-Type', /image\/jpeg/);
    expect((card.body as Buffer).length).toBeGreaterThan(1000);

    await ctx.http.delete('/api/v1/admin/photos/2').set('Authorization', `Bearer ${ctx.tokens.admin}`).expect(200);
    expect(await ogImage('/')).toMatch(/\/photos\/3\/og\.jpg/);
  });
});
