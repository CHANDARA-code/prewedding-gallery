import 'reflect-metadata';
import { Logger } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { loadConfig } from './config/env';
import { AppModule } from './app.module';
import { setupApp } from './setup-app';
import { AppEvents } from './alerts/events';
import { PhotosService } from './photos/photos.service';

async function bootstrap() {
  const config = loadConfig(); // throws (refuses to boot) on a missing/weak JWT_SECRET
  const app = await NestFactory.create<NestExpressApplication>(AppModule.forRoot(config));
  setupApp(app, config);

  const events = app.get(EventEmitter2);
  process.on('unhandledRejection', (reason) => {
    const err = reason instanceof Error ? reason : new Error(String(reason));
    Logger.error(`Unhandled rejection: ${err.message}`, err.stack);
    events.emit(AppEvents.AppError, { message: `Unhandled rejection: ${err.message}`, stack: err.stack });
  });

  await app.listen(config.port, config.host);
  const url = `http://${config.host}:${config.port}`;
  Logger.log(`API listening on ${url} (Swagger at /api/docs)`, 'Bootstrap');
  events.emit(AppEvents.AppStarted, { url: config.isProd ? 'production' : url, photos: app.get(PhotosService).countActive() });
}

void bootstrap();
