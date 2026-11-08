import { Module } from '@nestjs/common';
import { PhotosModule } from '../photos/photos.module';
import { createCollectionController, FavoritesSpec } from './collection.controller';
import { CollectionService } from './collection.service';

@Module({
  imports: [PhotosModule],
  controllers: [createCollectionController(FavoritesSpec)],
  providers: [CollectionService],
  exports: [CollectionService],
})
export class FavoritesModule {}
