import { Controller, Get, Inject, Param, ParseIntPipe, Query, Req, Res, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOkResponse, ApiOperation, ApiProduces, ApiResponse, ApiTags } from '@nestjs/swagger';
import { APP_CONFIG, AppConfig } from '../config/env';
import type { Request, Response } from 'express';
import { OptionalJwtAuthGuard } from '../auth/guards/optional-jwt-auth.guard';
import { AuthUser, CurrentUser } from '../auth/decorators/current-user.decorator';
import { ListQueryDto } from '../common/list-query.dto';
import { ErrorDto, PhotoDto, PhotoListDto } from '../common/photo.dto';
import { setPublicCacheHeaders } from '../common/cache-headers';
import { PhotosService } from './photos.service';
import { AlbumsService } from '../albums/albums.service';

@ApiTags('Photos')
@ApiBearerAuth()
@Controller('photos')
@UseGuards(OptionalJwtAuthGuard)
export class PhotosController {
  constructor(
    private readonly photos: PhotosService,
    private readonly albums: AlbumsService,
    @Inject(APP_CONFIG) private readonly config: AppConfig,
  ) {}

  @Get(':id/og.jpg')
  @ApiOperation({
    summary: 'Share card image',
    description: '1200x630 JPEG used as `og:image` when a `/photo/{id}` link is shared. Rendered on first request, then cached.',
  })
  @ApiProduces('image/jpeg')
  @ApiResponse({ status: 200, description: 'JPEG image' })
  @ApiResponse({ status: 404, type: ErrorDto })
  async shareCard(@Param('id', ParseIntPipe) id: number, @Res() res: Response) {
    const label = this.config.publicUrl ? new URL(this.config.publicUrl).host : 'Pre-Wedding View';
    const path = await this.photos.shareCard(id, label);
    res.setHeader('Cache-Control', 'public, max-age=86400, stale-while-revalidate=604800');
    res.sendFile(path, { dotfiles: 'allow' }); // the cache dir is .og (never served statically)
  }

  @Get()
  @ApiOperation({
    summary: 'List photos',
    description:
      'Active photos, newest first, cursor-paginated. Public; send a bearer token to also get `isFavorite` and `isSaved` flags. Guest responses are cacheable for 30 s.',
  })
  @ApiOkResponse({ type: PhotoListDto })
  @ApiResponse({ status: 400, type: ErrorDto, description: 'Malformed cursor' })
  list(@Query() q: ListQueryDto, @CurrentUser() user: AuthUser | null, @Req() req: Request, @Res({ passthrough: true }) res: Response) {
    setPublicCacheHeaders(req, res);
    return this.photos.listPublic(user, q.limit, q.cursor);
  }

  @Get(':id')
  @ApiOperation({
    summary: 'Get a photo',
    description:
      'Photo detail with `mimeType`, `sizeBytes`, camera `exif` and the `albums` it is in. Soft-deleted photos return 404 except for admins, who also get `uploadedBy` and `originalName`.',
  })
  @ApiOkResponse({ type: PhotoDto })
  @ApiResponse({ status: 404, type: ErrorDto })
  get(@Param('id', ParseIntPipe) id: number, @CurrentUser() user: AuthUser | null, @Req() req: Request, @Res({ passthrough: true }) res: Response) {
    setPublicCacheHeaders(req, res);
    return { ...this.photos.getOne(id, user), albums: this.albums.albumsOf(id, user) };
  }
}
