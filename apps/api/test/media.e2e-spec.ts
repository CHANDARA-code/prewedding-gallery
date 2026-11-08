import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import sharp from 'sharp';
import { createTestApp, TestCtx } from './helpers';
import { csvField } from '../src/photos/photo-export';

const api = '/api/v1';
const bearer = (t: string) => ({ Authorization: `Bearer ${t}` });
let ctx: TestCtx;
let webDir: string;

/** 80x60 JPEG with EXIF camera fields (and a GPS block that must never be exposed). */
const exifJpeg = () =>
  sharp({ create: { width: 80, height: 60, channels: 3, background: { r: 200, g: 100, b: 50 } } })
    .withExif({
      IFD0: { Make: 'Canon', Model: 'Canon EOS R6' },
      IFD2: { FNumber: '28/10', ExposureTime: '1/800', ISOSpeedRatings: '500', DateTimeOriginal: '2026:11:06 16:44:27', OffsetTimeOriginal: '+07:00' },
      IFD3: { GPSLatitudeRef: 'N', GPSLatitude: '13/1 24/1 0/1' },
    })
    .jpeg()
    .toBuffer();

async function upload(name = 'KSNT0990.jpg', title?: string) {
  const req = ctx.http.post(`${api}/admin/photos`).set(bearer(ctx.tokens.admin)).attach('files', await exifJpeg(), name);
  if (title) req.field('title', title);
  return (await req.expect(201)).body[0];
}

beforeAll(async () => {
  webDir = mkdtempSync(join(tmpdir(), 'pw-web-'));
  mkdirSync(join(webDir, 'assets'));
  writeFileSync(
    join(webDir, 'index.html'),
    '<!doctype html><html><head><meta name="description" content="x" /><title>Pre-Wedding View</title></head><body><div id="root"></div></body></html>',
  );
  ctx = await createTestApp({ WEB_DIST_DIR: webDir, PUBLIC_URL: 'https://example.test/' });
});
afterAll(async () => {
  await ctx.close();
  rmSync(webDir, { recursive: true, force: true });
});

describe('previews, EXIF and original names', () => {
  it('stores a preview, the original name (admin only) and safe EXIF', async () => {
    const p = await upload();
    expect(p.previewUrl).toMatch(/^\/uploads\/previews\/[0-9a-f-]{36}\.webp$/);
    await ctx.http.get(p.previewUrl).expect(200).expect('Cache-Control', /immutable/);
    expect(p.originalName).toBe('KSNT0990.jpg');

    const guest = (await ctx.http.get(`${api}/photos/${p.id}`).expect(200)).body;
    expect(guest.originalName).toBeUndefined();
    expect(guest.exif).toMatchObject({ make: 'Canon', model: 'Canon EOS R6', fNumber: 2.8, iso: 500, takenAt: '2026-11-06T16:44:27+07:00' });
    expect(JSON.stringify(guest.exif)).not.toMatch(/GPS|lat/i);
    expect(guest).toMatchObject({ mimeType: 'image/jpeg', rotation: 0, width: 80, height: 60 });
  });
});

describe('rotate', () => {
  it('re-renders thumbnail + preview with swapped dimensions and keeps the original', async () => {
    const p = await upload();
    const res = await ctx.http.post(`${api}/admin/photos/${p.id}/rotate`).set(bearer(ctx.tokens.admin)).send({ degrees: 90 }).expect(200);
    expect(res.body).toMatchObject({ rotation: 90, width: 60, height: 80, url: p.url });
    expect(res.body.thumbUrl).not.toBe(p.thumbUrl);
    expect(res.body.previewUrl).not.toBe(p.previewUrl);
    const meta = await sharp(join(ctx.uploadDir, res.body.previewUrl.replace('/uploads/', ''))).metadata();
    expect([meta.width, meta.height]).toEqual([60, 80]);
    expect(existsSync(join(ctx.uploadDir, p.thumbUrl.replace('/uploads/', '')))).toBe(false);

    const left = await ctx.http.post(`${api}/admin/photos/${p.id}/rotate`).set(bearer(ctx.tokens.admin)).send({ degrees: -90 }).expect(200);
    expect(left.body).toMatchObject({ rotation: 0, width: 80, height: 60 });
  });

  it('is admin only and validates degrees', async () => {
    const p = await upload();
    await ctx.http.post(`${api}/admin/photos/${p.id}/rotate`).set(bearer(ctx.tokens.demo)).send({ degrees: 90 }).expect(403);
    await ctx.http.post(`${api}/admin/photos/${p.id}/rotate`).set(bearer(ctx.tokens.admin)).send({ degrees: 45 }).expect(400);
  });
});

describe('CSV export', () => {
  it('exports every photo with its original file name', async () => {
    const p = await upload('IMG_0001.jpg', '=HYPERLINK("x")');
    const res = await ctx.http.get(`${api}/admin/photos/export.csv?status=active`).set(bearer(ctx.tokens.admin)).expect(200);
    expect(res.headers['content-type']).toMatch(/text\/csv/);
    expect(res.headers['content-disposition']).toMatch(/attachment; filename="prewedding-photos-active-/);
    const lines = res.text.replace(/^﻿/, '').trim().split('\r\n');
    expect(lines[0]).toMatch(/^id,original_file_name,stored_file_name,title/);
    const row = lines.find((l) => l.startsWith(`${p.id},`))!;
    expect(row).toContain('IMG_0001.jpg');
    expect(row).toContain(`"'=HYPERLINK(""x"")"`); // formula injection defused
    expect(row).toContain(`https://example.test/photo/${p.id}`);
    expect(row).toContain('Canon EOS R6');
  });

  it('is admin only', async () => {
    await ctx.http.get(`${api}/admin/photos/export.csv`).set(bearer(ctx.tokens.demo)).expect(403);
    await ctx.http.get(`${api}/admin/photos/export.csv`).expect(401);
  });

  it('escapes CSV fields', () => {
    expect(csvField('a,b')).toBe('"a,b"');
    expect(csvField('say "hi"')).toBe('"say ""hi"""');
    expect(csvField(null)).toBe('');
    expect(csvField(-5)).toBe('-5');
  });
});

describe('sharing', () => {
  it('serves a 1200x630 JPEG share card, 404 once deleted', async () => {
    const p = await upload();
    const res = await ctx.http.get(`${api}/photos/${p.id}/og.jpg`).buffer(true).expect(200).expect('Content-Type', /image\/jpeg/);
    const meta = await sharp(res.body as Buffer).metadata();
    expect([meta.width, meta.height]).toEqual([1200, 630]);
    await ctx.http.delete(`${api}/admin/photos/${p.id}`).set(bearer(ctx.tokens.admin)).expect(200);
    await ctx.http.get(`${api}/photos/${p.id}/og.jpg`).expect(404);
  });

  it('injects Open Graph tags into /photo/:id for crawlers', async () => {
    const p = await upload('a.jpg', 'Golden <hour>');
    const res = await ctx.http.get(`/photo/${p.id}`).set('Accept', 'text/html').set('User-Agent', 'facebookexternalhit/1.1').expect(200);
    expect(res.text).toContain('<title>Golden &#60;hour&#62; · Pre-Wedding View</title>');
    expect(res.text).toContain(`<meta property="og:url" content="https://example.test/photo/${p.id}" />`);
    expect(res.text).toMatch(new RegExp(`og:image" content="https://example.test/api/v1/photos/${p.id}/og.jpg\\?v=`));
    expect(res.text).toContain('twitter:card" content="summary_large_image"');
    expect(res.text).toContain('<div id="root"></div>');
  });

  it('falls back to the site card for unknown photos', async () => {
    const res = await ctx.http.get('/photo/99999999').set('Accept', 'text/html').expect(200);
    expect(res.text).toContain('<title>Pre-Wedding View</title>');
  });
});
