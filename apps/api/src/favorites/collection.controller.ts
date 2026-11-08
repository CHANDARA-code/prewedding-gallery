import { Controller, Delete, Get, HttpCode, Param, ParseIntPipe, Put, Query, Res, Type, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiNoContentResponse, ApiOkResponse, ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger';
import { EventEmitter2 } from '@nestjs/event-emitter';
import type { Response } from 'express';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { AuthUser, CurrentUser } from '../auth/decorators/current-user.decorator';
import { ListQueryDto } from '../common/list-query.dto';
import { ErrorDto, PhotoListDto } from '../common/photo.dto';
import { setNoStore } from '../common/cache-headers';
import { PhotosService } from '../photos/photos.service';
import { CollectionService } from './collection.service';
import { AppEvents } from '../alerts/events';

interface CollectionSpec {
  kind: 'favorites' | 'saves';
  /** Path segment under /photos/:id, e.g. "favorite". */
  verb: 'favorite' | 'save';
  tag: string;
  noun: string;
  added: string;
  removed: string;
}

/** Builds the Favorite and Save controllers, which differ only in table and wording. */
export function createCollectionController(spec: CollectionSpec): Type<unknown> {
  @ApiTags(spec.tag)
  @ApiBearerAuth()
  @ApiResponse({ status: 401, type: ErrorDto, description: 'Missing or invalid token' })
  @Controller()
  @UseGuards(JwtAuthGuard)
  class CollectionController {
    constructor(
      readonly service: CollectionService,
      readonly photos: PhotosService,
      readonly events: EventEmitter2,
    ) {}

    @Get(`me/${spec.kind}`)
    @ApiOperation({
      summary: `List my ${spec.kind}`,
      description: `The current user's ${spec.noun} active photos, most recently ${spec.verb === 'favorite' ? 'favorited' : 'saved'} first, cursor-paginated.`,
    })
    @ApiOkResponse({ type: PhotoListDto })
    @ApiResponse({ status: 400, type: ErrorDto, description: 'Malformed cursor' })
    list(@Query() q: ListQueryDto, @CurrentUser() user: AuthUser, @Res({ passthrough: true }) res: Response) {
      setNoStore(res);
      return this.photos.listCollection(spec.kind, user, q.limit, q.cursor);
    }

    @Put(`photos/:id/${spec.verb}`)
    @HttpCode(204)
    @ApiOperation({ summary: `${spec.verb === 'favorite' ? 'Favorite' : 'Save'} a photo`, description: 'Idempotent: repeating it has no further effect.' })
    @ApiNoContentResponse()
    @ApiResponse({ status: 404, type: ErrorDto })
    add(@Param('id', ParseIntPipe) id: number, @CurrentUser() user: AuthUser, @Res({ passthrough: true }) res: Response) {
      setNoStore(res);
      this.photos.assertActive(id);
      if (this.service.add(spec.kind, user.id, id)) this.events.emit(spec.added, { actor: user, photoId: id });
    }

    @Delete(`photos/:id/${spec.verb}`)
    @HttpCode(204)
    @ApiOperation({ summary: `Remove ${spec.verb}`, description: 'Idempotent: removing something that is not there succeeds.' })
    @ApiNoContentResponse()
    remove(@Param('id', ParseIntPipe) id: number, @CurrentUser() user: AuthUser, @Res({ passthrough: true }) res: Response) {
      setNoStore(res);
      if (this.service.remove(spec.kind, user.id, id)) this.events.emit(spec.removed, { actor: user, photoId: id });
    }
  }
  Object.defineProperty(CollectionController, 'name', { value: `${spec.tag}Controller` });
  return CollectionController;
}

export const FavoritesSpec: CollectionSpec = {
  kind: 'favorites',
  verb: 'favorite',
  tag: 'Favorites',
  noun: 'favorited',
  added: AppEvents.FavoriteAdded,
  removed: AppEvents.FavoriteRemoved,
};
export const SavesSpec: CollectionSpec = {
  kind: 'saves',
  verb: 'save',
  tag: 'Saves',
  noun: 'saved',
  added: AppEvents.SaveAdded,
  removed: AppEvents.SaveRemoved,
};
