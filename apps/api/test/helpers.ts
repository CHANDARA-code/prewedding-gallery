import { Test } from '@nestjs/testing';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { mkdtempSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import request from 'supertest';
import sharp from 'sharp';
import type Database from 'better-sqlite3';
import { AppModule } from '../src/app.module';
import { setupApp } from '../src/setup-app';
import { loadConfig } from '../src/config/env';
import { SQLITE, DRIZZLE } from '../src/db/db.module';
import { seedUsers } from '../src/db/seed';
import type { Db } from '../src/db/client';

export interface TestCtx {
  app: NestExpressApplication;
  http: ReturnType<typeof request>;
  sqlite: Database.Database;
  db: Db;
  dir: string;
  uploadDir: string;
  tokens: { admin: string; demo: string };
  close(): Promise<void>;
}

export async function createTestApp(env: Record<string, string> = {}): Promise<TestCtx> {
  const dir = mkdtempSync(join(tmpdir(), 'pw-test-'));
  const uploadDir = join(dir, 'uploads');
  const config = loadConfig({
    NODE_ENV: 'test',
    JWT_SECRET: 'test-secret-test-secret-test-secret-123',
    DATABASE_URL: join(dir, 'test.db'),
    UPLOAD_DIR: uploadDir,
    WEB_ORIGIN: 'http://localhost:5173',
    ...env,
  });
  const moduleRef = await Test.createTestingModule({ imports: [AppModule.forRoot(config)] }).compile();
  const app = moduleRef.createNestApplication<NestExpressApplication>({ logger: false });
  setupApp(app, config);
  await app.init();
  const sqlite = app.get<Database.Database>(SQLITE);
  const db = app.get<Db>(DRIZZLE);
  seedUsers({ sqlite, db });
  const http = request(app.getHttpServer());
  const login = async (username: string) =>
    (await http.post('/api/v1/auth/login').send({ username, password: 'password' }).expect(200)).body.accessToken as string;
  const tokens = { admin: await login('admin'), demo: await login('demo') };
  return {
    app,
    http,
    sqlite,
    db,
    dir,
    uploadDir,
    tokens,
    async close() {
      await app.close();
      rmSync(dir, { recursive: true, force: true });
    },
  };
}

let seq = 0;
/** A small real JPEG with a unique colour. */
export function makeJpeg(width = 64, height = 48): Promise<Buffer> {
  seq++;
  return sharp({ create: { width, height, channels: 3, background: { r: seq % 255, g: (seq * 7) % 255, b: 120 } } })
    .jpeg()
    .toBuffer();
}

export async function uploadPhotos(ctx: TestCtx, n: number, title?: string): Promise<number[]> {
  const req = ctx.http.post('/api/v1/admin/photos').set('Authorization', `Bearer ${ctx.tokens.admin}`);
  for (let i = 0; i < n; i++) req.attach('files', await makeJpeg(), `p${i}.jpg`);
  if (title) req.field('title', title);
  const res = await req.expect(201);
  return res.body.map((p: { id: number }) => p.id);
}

/** Walks every page of a list endpoint and returns the ids in order. */
export async function walk(ctx: TestCtx, path: string, token?: string, limit = 3, between?: (page: number) => Promise<void>) {
  const ids: number[] = [];
  let cursor: string | null = null;
  let page = 0;
  do {
    const r = ctx.http.get(path).query({ limit, ...(cursor ? { cursor } : {}) });
    if (token) r.set('Authorization', `Bearer ${token}`);
    const res = await r.expect(200);
    ids.push(...res.body.items.map((p: { id: number }) => p.id));
    expect(res.body.hasMore).toBe(res.body.nextCursor !== null);
    cursor = res.body.nextCursor;
    if (between) await between(page);
    page++;
  } while (cursor);
  return ids;
}
