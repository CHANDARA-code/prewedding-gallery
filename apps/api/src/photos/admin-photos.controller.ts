import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  NotFoundException,
  Param,
  ParseIntPipe,
  Patch,
  Post,
  Query,
  Req,
  Res,
  UploadedFiles,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { FilesInterceptor } from '@nestjs/platform-express';
import {
  ApiBearerAuth,
  ApiBody,
  ApiConsumes,
  ApiCreatedResponse,
  ApiNoContentResponse,
  ApiOkResponse,
  ApiOperation,
  ApiResponse,
  ApiTags,
} from '@nestjs/swagger';
import type { Request, Response } from 'express';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { Inject } from '@nestjs/common';
import { DRIZZLE } from '../db/db.module';
import { albums } from '../db/schema';
import { eq } from 'drizzle-orm';
import type { Db } from '../db/client';
import { APP_CONFIG, AppConfig } from '../config/env';
import { AppEvents } from '../alerts/events';
import { buildPhotosCsv } from './photo-export';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { PermissionsGuard } from '../auth/guards/permissions.guard';
import { RequirePermissions } from '../auth/decorators/permissions.decorator';
import { AuthUser, CurrentUser } from '../auth/decorators/current-user.decorator';
import { AdminListQueryDto } from '../common/list-query.dto';
import { ErrorDto, PhotoDto, PhotoListDto } from '../common/photo.dto';
import { setNoStore } from '../common/cache-headers';
import { PhotosService } from './photos.service';
import { ExportQueryDto, RotatePhotoDto, UpdatePhotoDto, UploadPhotosBodyDoc, UploadPhotosDto } from './dto/photo-input.dto';

@ApiTags('Admin')
@ApiBearerAuth()
@ApiResponse({ status: 401, type: ErrorDto, description: 'Missing or invalid token' })
@ApiResponse({ status: 403, type: ErrorDto, description: 'Missing the permission this action needs (admins have all of them)' })
@Controller('admin/photos')
@UseGuards(JwtAuthGuard, PermissionsGuard)
export class AdminPhotosController {
  constructor(
    private readonly photos: PhotosService,
    private readonly events: EventEmitter2,
    @Inject(DRIZZLE) private readonly db: Db,
    @Inject(APP_CONFIG) private readonly config: AppConfig,
  ) {}

  @Get('export.csv')
  @RequirePermissions('photos.export')
  @ApiOperation({
    summary: 'Export photos as CSV',
    description:
      'One row per photo: source zip, original file name, detail link, favorite/save counts and who favorited/saved it, then title, caption, size, dimensions, camera EXIF, uploader and dates. `collection=favorites|saves` keeps only photos someone favorited/saved (`mine=true`: only yours); `album=<id>` keeps only the photos in that album. The `albums` column lists every album a photo is in. UTF-8 with BOM (opens correctly in Excel).',
  })
  @ApiOkResponse({ description: 'text/csv attachment', content: { 'text/csv': { schema: { type: 'string' } } } })
  exportCsv(@Query() q: ExportQueryDto, @CurrentUser() user: AuthUser, @Req() req: Request, @Res() res: Response) {
    const album = q.album ? this.db.select({ slug: albums.slug, name: albums.name }).from(albums).where(eq(albums.id, q.album)).get() : undefined;
    if (q.album && !album) throw new NotFoundException('Album not found');
    const publicUrl = this.config.publicUrl ?? `${req.protocol}://${req.get('host')}`;
    const { csv, rows } = buildPhotosCsv(this.db, {
      status: q.status,
      collection: q.collection,
      mineUserId: q.collection !== 'all' && q.mine ? user.id : undefined,
      albumId: q.album,
      publicUrl,
    });
    const date = new Date().toISOString().slice(0, 10);
    const base = q.collection === 'all' ? `photos-${q.status}` : `${q.mine ? `${user.username}-` : ''}${q.collection}`;
    const what = album ? `album-${album.slug}${q.collection === 'all' ? '' : `-${base}`}` : base;
    res.setHeader('Cache-Control', 'no-store');
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="prewedding-${what}-${date}.csv"`);
    res.send(csv);
    this.events.emit(AppEvents.PhotosExported, { actor: user, rows, status: `${q.collection === 'all' ? q.status : `${q.mine ? 'my ' : ''}${q.collection}`}${album ? ` in album ${album.name}` : ''}` });
  }

  @Get()
  @RequirePermissions('photos.delete')
  @ApiOperation({ summary: 'List photos (admin)', description: 'All photos including soft-deleted ones, newest first, cursor-paginated. Filter with `status`.' })
  @ApiOkResponse({ type: PhotoListDto })
  list(@Query() q: AdminListQueryDto, @CurrentUser() user: AuthUser, @Res({ passthrough: true }) res: Response) {
    setNoStore(res);
    return this.photos.listAdmin(user, q.status, q.limit, q.cursor);
  }

  @Post()
  @RequirePermissions('photos.upload')
  @UseInterceptors(FilesInterceptor('files', 20))
  @ApiOperation({
    summary: 'Upload photos',
    description:
      'Upload 1 to 20 images (JPEG, PNG or WebP, max 15 MB each) as multipart field `files`. Types are checked by magic bytes. If any file is invalid the whole request fails and nothing is kept.',
  })
  @ApiConsumes('multipart/form-data')
  @ApiBody({ type: UploadPhotosBodyDoc })
  @ApiCreatedResponse({ type: [PhotoDto] })
  @ApiResponse({ status: 400, type: ErrorDto, description: 'Invalid file' })
  @ApiResponse({ status: 413, type: ErrorDto, description: 'File too large' })
  async upload(
    @UploadedFiles() files: Express.Multer.File[] | undefined,
    @Body() body: UploadPhotosDto,
    @CurrentUser() user: AuthUser,
    @Res({ passthrough: true }) res: Response,
  ) {
    setNoStore(res);
    if (!files?.length) throw new BadRequestException('At least one file is required in field "files"');
    return this.photos.upload(user, files, body);
  }

  @Patch(':id')
  @RequirePermissions('photos.edit')
  @ApiOperation({ summary: 'Update photo', description: 'Update the title and/or caption.' })
  @ApiOkResponse({ type: PhotoDto })
  @ApiResponse({ status: 404, type: ErrorDto })
  update(@Param('id', ParseIntPipe) id: number, @Body() dto: UpdatePhotoDto, @CurrentUser() user: AuthUser, @Res({ passthrough: true }) res: Response) {
    setNoStore(res);
    return this.photos.update(user, id, dto);
  }

  @Post(':id/rotate')
  @RequirePermissions('photos.edit')
  @HttpCode(200)
  @ApiOperation({
    summary: 'Rotate',
    description:
      'Rotates how the photo is displayed everywhere (grid, viewer, share card) by `degrees` clockwise, relative to its current rotation. The original file is never changed.',
  })
  @ApiOkResponse({ type: PhotoDto })
  @ApiResponse({ status: 404, type: ErrorDto })
  rotate(@Param('id', ParseIntPipe) id: number, @Body() dto: RotatePhotoDto, @CurrentUser() user: AuthUser, @Res({ passthrough: true }) res: Response) {
    setNoStore(res);
    return this.photos.rotate(user, id, dto.degrees);
  }

  @Delete(':id')
  @RequirePermissions('photos.delete')
  @ApiOperation({ summary: 'Soft delete', description: 'Moves the photo to trash. It disappears from every public and personal list and its files stop being served. Can be restored.' })
  @ApiOkResponse({ type: PhotoDto })
  @ApiResponse({ status: 404, type: ErrorDto })
  softDelete(@Param('id', ParseIntPipe) id: number, @CurrentUser() user: AuthUser, @Res({ passthrough: true }) res: Response) {
    setNoStore(res);
    return this.photos.softDelete(user, id);
  }

  @Post(':id/restore')
  @RequirePermissions('photos.delete')
  @HttpCode(200)
  @ApiOperation({ summary: 'Restore', description: 'Restores a soft-deleted photo to every list it was in.' })
  @ApiOkResponse({ type: PhotoDto })
  @ApiResponse({ status: 404, type: ErrorDto })
  restore(@Param('id', ParseIntPipe) id: number, @CurrentUser() user: AuthUser, @Res({ passthrough: true }) res: Response) {
    setNoStore(res);
    return this.photos.restore(user, id);
  }

  @Delete(':id/permanent')
  @RequirePermissions('photos.purge')
  @HttpCode(204)
  @ApiOperation({ summary: 'Hard delete', description: 'Permanently deletes the photo row, its files, and all favorites and saves of it. Cannot be undone.' })
  @ApiNoContentResponse()
  @ApiResponse({ status: 404, type: ErrorDto })
  async hardDelete(@Param('id', ParseIntPipe) id: number, @CurrentUser() user: AuthUser, @Res({ passthrough: true }) res: Response) {
    setNoStore(res);
    await this.photos.hardDelete(user, id);
  }
}
