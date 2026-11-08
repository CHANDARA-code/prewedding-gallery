/** `pnpm --filter api openapi:export` writes docs/openapi.json from the Nest Swagger metadata. */
import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { mkdtempSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { join, resolve } from 'path';
import { loadConfig } from './config/env';
import { AppModule } from './app.module';
import { buildOpenApi, setupApp } from './setup-app';

async function main() {
  const tmp = mkdtempSync(join(tmpdir(), 'pw-openapi-'));
  const config = loadConfig({
    ...process.env,
    NODE_ENV: 'test',
    JWT_SECRET: process.env.JWT_SECRET || 'openapi-export-secret-openapi-export',
    DATABASE_URL: ':memory:',
    UPLOAD_DIR: join(tmp, 'uploads'),
    WEB_DIST_DIR: '',
  });
  const app = await NestFactory.create<NestExpressApplication>(AppModule.forRoot(config), { logger: ['error'] });
  setupApp(app, config);
  await app.init();
  const out = resolve(__dirname, '..', '..', '..', 'docs', 'openapi.json');
  writeFileSync(out, JSON.stringify(buildOpenApi(app), null, 2) + '\n');
  await app.close();
  console.log(`Wrote ${out}`);
}
void main();
