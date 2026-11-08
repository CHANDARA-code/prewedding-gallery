import { DynamicModule, Module } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { CacheModule } from '@nestjs/cache-manager';
import { EventEmitterModule } from '@nestjs/event-emitter';
import { ThrottlerGuard, ThrottlerModule } from '@nestjs/throttler';
import { Keyv } from 'keyv';
import { CacheableMemory } from 'cacheable';
import { AppConfig } from './config/env';
import { AppConfigModule } from './config/config.module';
import { DbModule } from './db/db.module';
import { AlertsModule } from './alerts/alerts.module';
import { AuthModule } from './auth/auth.module';
import { PhotosModule } from './photos/photos.module';
import { FavoritesModule } from './favorites/favorites.module';
import { SavesModule } from './saves/saves.module';
import { UsersModule } from './users/users.module';
import { HealthController } from './health.controller';

@Module({})
export class AppModule {
  static forRoot(config: AppConfig): DynamicModule {
    return {
      module: AppModule,
      imports: [
        AppConfigModule.forRoot(config),
        EventEmitterModule.forRoot(),
        // Guest list pages: in-memory LRU, max 200 entries, 30 s TTL (spec 6.7.3).
        CacheModule.register({
          isGlobal: true,
          ttl: 30_000,
          stores: [new Keyv({ store: new CacheableMemory({ ttl: 30_000, lruSize: 200 }) })],
        }),
        // 120 req/min per IP by default; login overrides this with 5/min.
        ThrottlerModule.forRoot([{ name: 'default', ttl: 60_000, limit: config.throttleLimit }]),
        DbModule,
        AlertsModule,
        AuthModule,
        PhotosModule,
        FavoritesModule,
        SavesModule,
        UsersModule,
      ],
      controllers: [HealthController],
      providers: [{ provide: APP_GUARD, useClass: ThrottlerGuard }],
    };
  }
}
