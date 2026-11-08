import { ValidationPipe } from '@nestjs/common';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { DocumentBuilder, OpenAPIObject, SwaggerModule } from '@nestjs/swagger';
import { EventEmitter2 } from '@nestjs/event-emitter';
import compression from 'compression';
import helmet from 'helmet';
import express, { NextFunction, Request, Response } from 'express';
import { existsSync } from 'fs';
import { join, resolve } from 'path';
import { AppConfig } from './config/env';
import { HttpExceptionFilter } from './common/http-exception.filter';
import { PhotoStorage } from './photos/storage.service';

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
      // SPA fallback for client-side routes (/favorite, /save, ...).
      app.use((req: Request, res: Response, next: NextFunction) => {
        if ((req.method !== 'GET' && req.method !== 'HEAD') || req.path.startsWith('/api/') || req.path.startsWith('/uploads/')) {
          return next();
        }
        if (!req.accepts('html')) return next();
        res.setHeader('Cache-Control', 'no-cache');
        res.sendFile(indexHtml);
      });
    }
  }

  app.setGlobalPrefix('api/v1');
  app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true }));
  app.useGlobalFilters(new HttpExceptionFilter(app.get(EventEmitter2)));
  app.enableShutdownHooks();

  SwaggerModule.setup('api/docs', app, () => buildOpenApi(app), { jsonDocumentUrl: 'api/docs/openapi.json' });
}
