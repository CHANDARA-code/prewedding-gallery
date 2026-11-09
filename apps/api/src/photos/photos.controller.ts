import { BadRequestException, Controller, Get, Inject, Logger, NotFoundException, Param, ParseIntPipe, Query, Req, Res, UseGuards } from '@nestjs/common';
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
import { DownloadQueryDto } from './dto/photo-input.dto';
import { prepareZip, writeZip, ZIP_MAX_BYTES } from './zip-stream';

@ApiTags('Photos')
@ApiBearerAuth()
@Controller('photos')
@UseGuards(OptionalJwtAuthGuard)
export class PhotosController {
  private readonly logger = new Logger(PhotosController.name);

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

  // Declared before `:id` so "download.zip" is never parsed as an id.
  @Get('download.zip')
  @ApiOperation({
    summary: 'Download several as ZIP',
    description: 'The original files of up to 200 active photos, streamed as one ZIP (`prewedding-<id>.<ext>` inside). Public, like single downloads.',
  })
  @ApiProduces('application/zip')
  @ApiResponse({ status: 200, description: 'ZIP archive' })
  @ApiResponse({ status: 404, type: ErrorDto, description: 'None of the ids is an active photo' })
  async downloadZip(@Query() q: DownloadQueryDto, @Res() res: Response) {
    const zip = await prepareZip(this.photos.downloadable(q.ids));
    if (!zip.entries.length) throw new NotFoundException('None of these photos can be downloaded');
    if (zip.totalBytes > ZIP_MAX_BYTES) throw new BadRequestException('Too much for one download; select fewer photos');
    const date = new Date().toISOString().slice(0, 10);
    res.setHeader('Cache-Control', 'no-store');
    res.setHeader('Content-Type', 'application/zip');
    res.setHeader('Content-Length', String(zip.totalBytes));
    res.setHeader('Content-Disposition', `attachment; filename="prewedding-${zip.entries.length}-photos-${date}.zip"`);
    try {
      await writeZip(zip, res);
      res.end();
    } catch (err) {
      // Headers are gone; all we can do is cut the connection so the browser reports a failed download.
      this.logger.error(`ZIP download failed: ${(err as Error).message}`);
      res.destroy(err as Error);
    }
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
