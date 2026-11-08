import { ValidationPipe } from '@nestjs/common';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { DocumentBuilder, OpenAPIObject, SwaggerModule } from '@nestjs/swagger';
import { EventEmitter2 } from '@nestjs/event-emitter';
import compression from 'compression';
import helmet from 'helmet';
import express, { NextFunction, Request, Response } from 'express';
import { existsSync, readFileSync, statSync } from 'fs';
import { join, resolve } from 'path';
import { AppConfig } from './config/env';
import { HttpExceptionFilter } from './common/http-exception.filter';
import { PhotoStorage } from './photos/storage.service';
import { PhotosRepository } from './photos/photos.repository';
import { injectOgTags } from './share/og-tags';
import { AlbumsService } from './albums/albums.service';

const SITE_NAME = 'Pre-Wedding View';
const SHARE_PATH = /^\/photo\/(\d{1,12})\/?$/;
const ALBUM_PATH = /^\/albums\/([a-z0-9-]{1,60})\/?$/;

/** index.html, re-read only when the file changes (a web rebuild without an API restart). */
function htmlReader(path: string) {
  let cached = { mtimeMs: -1, html: '' };
  return () => {
    const { mtimeMs } = statSync(path);
    if (mtimeMs !== cached.mtimeMs) cached = { mtimeMs, html: readFileSync(path, 'utf8') };
    return cached.html;
  };
}

export function buildOpenApi(app: NestExpressApplication): OpenAPIObject {
  const config = new DocumentBuilder()
    .setTitle('Pre-Wedding View API')
    .setDescription('Public pre-wedding photo gallery with per-user favorites and saves, and admin photo management.')
    .setVersion('1.1')
    .addServer('https://prewedding.leavchandara.com', 'Production')
    .addServer('http://localhost:3000', 'Local development')
    .addBearerAuth({ type: 'http', scheme: 'bearer', bearerFormat: 'JWT' })
    .build();
  return SwaggerModule.createDocument(app, config);
}

/** Applies middleware, pipes, filters, static serving and Swagger. Shared by main.ts and tests. */
export function setupApp(app: NestExpressApplication, config: AppConfig) {
  if (config.trustProxy !== undefined) app.set('trust proxy', config.trustProxy);
  app.set('etag', 'weak'); // unchanged lists answer 304
  app.set('x-powered-by', false);

  app.use(
    helmet({
      crossOriginResourcePolicy: { policy: 'cross-origin' }, // the Vite dev server loads /uploads cross-origin
      contentSecurityPolicy: {
        directives: { 'img-src': ["'self'", 'data:', 'blob:'] },
      },
    }),
  );
  app.use(compression({ threshold: 1024 }));
  app.useBodyParser('json', { limit: '100kb' });
  app.useBodyParser('urlencoded', { limit: '100kb', extended: false });
  app.enableCors({ origin: config.webOrigin, methods: ['GET', 'HEAD', 'POST', 'PUT', 'PATCH', 'DELETE'] });

  // Filenames are random UUIDs and never reused, so files can be cached forever. Soft-deleted
  // files live in uploads/.trash, which (as a dotfile path) is never served.
  const storage = new PhotoStorage(config.uploadDir);
  app.use(
    '/uploads',
    express.static(storage.root, { immutable: true, maxAge: '365d', dotfiles: 'ignore', index: false, fallthrough: true }),
  );

  if (config.webDistDir) {
    const dist = resolve(config.webDistDir);
    const indexHtml = join(dist, 'index.html');
    if (existsSync(indexHtml)) {
      app.use(
        express.static(dist, {
          index: false,
          setHeaders: (res, path) => {
            res.setHeader('Cache-Control', path.includes(`${join(dist, 'assets')}`) ? 'public, max-age=31536000, immutable' : 'no-cache');
          },
        }),
      );
      const readIndex = htmlReader(indexHtml);
      const repo = app.get(PhotosRepository, { strict: false });
      const albumsService = app.get(AlbumsService, { strict: false });
      // SPA fallback for client-side routes (/favorite, /save, /photo/:id, ...). Every page carries
      // Open Graph tags; a /photo/:id page gets that photo's title, caption and share card, and an
      // /albums/:slug page the album's name, description and cover.
      app.use((req: Request, res: Response, next: NextFunction) => {
        if ((req.method !== 'GET' && req.method !== 'HEAD') || req.path.startsWith('/api/') || req.path.startsWith('/uploads/')) {
          return next();
        }
        if (!req.accepts('html')) return next();
        const origin = config.publicUrl ?? `${req.protocol}://${req.get('host')}`;
        let og = {
          title: SITE_NAME,
          description: 'Our pre-wedding photo gallery.',
          url: `${origin}${req.path === '/' ? '/' : req.path}`,
          image: '',
          imageAlt: SITE_NAME,
          siteName: SITE_NAME,
        };
        const m = SHARE_PATH.exec(req.path);
        const shared = m ? repo.findById(Number(m[1]), null) : undefined;
        const am = ALBUM_PATH.exec(req.path);
        const album = am ? albumsService.findPublicForShare(am[1]) : undefined;
        const cardOf = (r: { id: number; previewFilename?: string | null; thumbFilename: string }) =>
          `${origin}/api/v1/photos/${r.id}/og.jpg?v=${encodeURIComponent((r.previewFilename ?? r.thumbFilename).slice(0, 8))}`;
        if (shared && !shared.deletedAt) {
          const name = shared.title || `Photo #${shared.id}`;
          og = {
            ...og,
            title: `${name} · ${SITE_NAME}`,
            description: shared.caption || 'Tap to view this photo from our pre-wedding gallery.',
            url: `${origin}/photo/${shared.id}`,
            image: cardOf(shared),
            imageAlt: shared.caption || name,
          };
        } else if (album) {
          const coverRow = album.cover ? repo.findById(album.cover.id, null) : undefined;
          og = {
            ...og,
            title: `${album.name} · ${SITE_NAME}`,
            description: album.description || `${album.photoCount} photo${album.photoCount === 1 ? '' : 's'} from our pre-wedding gallery.`,
            url: `${origin}/albums/${album.slug}`,
            imageAlt: album.name,
          };
          if (coverRow) og.image = cardOf(coverRow);
        }
        if (!og.image) {
          const cover = repo.listPublic(null, null, 1)[0]; // newest photo as the gallery's cover
          if (cover) og.image = cardOf(cover);
        }
        const html = og.image ? injectOgTags(readIndex(), og) : readIndex();
        res.setHeader('Cache-Control', 'no-cache');
        res.type('html').send(html);
      });
    }
  }

  app.setGlobalPrefix('api/v1');
  app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true }));
  app.useGlobalFilters(new HttpExceptionFilter(app.get(EventEmitter2)));
  app.enableShutdownHooks();

  SwaggerModule.setup('api/docs', app, () => buildOpenApi(app), { jsonDocumentUrl: 'api/docs/openapi.json' });
}
