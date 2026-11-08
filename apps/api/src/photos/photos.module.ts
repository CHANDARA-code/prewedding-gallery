import { Module } from '@nestjs/common';
import { MulterModule } from '@nestjs/platform-express';
import { diskStorage } from 'multer';
import { randomUUID } from 'crypto';
import { APP_CONFIG, AppConfig } from '../config/env';
import { PhotosController } from './photos.controller';
import { AdminPhotosController } from './admin-photos.controller';
import { PhotosService } from './photos.service';
import { PhotosRepository } from './photos.repository';
import { StorageService } from './storage.service';
import { PhotoCacheService } from './photo-cache.service';
import { StorageModule } from './storage.module';

@Module({
  imports: [
    StorageModule,
    MulterModule.registerAsync({
      imports: [StorageModule],
      inject: [APP_CONFIG, StorageService],
      // Stream to disk (never buffer whole files in memory).
      useFactory: (config: AppConfig, storage: StorageService) => ({
        storage: diskStorage({
          destination: storage.tmp,
          filename: (_req, _file, cb) => cb(null, randomUUID()),
        }),
        limits: { fileSize: config.maxUploadMb * 1024 * 1024, files: 20, fields: 10 },
      }),
    }),
  ],
  controllers: [PhotosController, AdminPhotosController],
  providers: [PhotosService, PhotosRepository, PhotoCacheService],
  exports: [PhotosService],
})
export class PhotosModule {}
