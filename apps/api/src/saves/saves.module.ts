import { Module } from '@nestjs/common';
import { PhotosModule } from '../photos/photos.module';
import { createCollectionController, SavesSpec } from '../favorites/collection.controller';
import { CollectionService } from '../favorites/collection.service';

@Module({
  imports: [PhotosModule],
  controllers: [createCollectionController(SavesSpec)],
  providers: [CollectionService],
})
export class SavesModule {}
