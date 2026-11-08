import { Body, Controller, Delete, Get, HttpCode, Param, ParseIntPipe, Patch, Post, Query, Req, Res, UseGuards } from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiCreatedResponse,
  ApiNoContentResponse,
  ApiOkResponse,
  ApiOperation,
  ApiResponse,
  ApiTags,
} from '@nestjs/swagger';
import type { Request, Response } from 'express';
import { OptionalJwtAuthGuard } from '../auth/guards/optional-jwt-auth.guard';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { PermissionsGuard } from '../auth/guards/permissions.guard';
import { RequirePermissions } from '../auth/decorators/permissions.decorator';
import { AuthUser, CurrentUser } from '../auth/decorators/current-user.decorator';
import { ListQueryDto } from '../common/list-query.dto';
import { ErrorDto, PhotoListDto } from '../common/photo.dto';
import { setNoStore, setPublicCacheHeaders } from '../common/cache-headers';
import { AlbumsService } from './albums.service';
import { AlbumDto, AlbumPhotosDto, AlbumPhotosResultDto, CreateAlbumDto, UpdateAlbumDto } from './album.dto';

@ApiTags('Albums')
@ApiBearerAuth()
@Controller('albums')
@UseGuards(OptionalJwtAuthGuard)
export class AlbumsController {
  constructor(private readonly albums: AlbumsService) {}

  @Get()
  @ApiOperation({
    summary: 'List albums',
    description: 'Every album, newest first, with photo count and cover. Public. Hidden albums are included only for accounts with `albums.manage`.',
  })
  @ApiOkResponse({ type: [AlbumDto] })
  list(@CurrentUser() user: AuthUser | null, @Req() req: Request, @Res({ passthrough: true }) res: Response) {
    setPublicCacheHeaders(req, res); // private for token holders, so hidden albums never reach a shared cache
    return this.albums.list(user);
  }

  @Get(':slug')
  @ApiOperation({ summary: 'Get an album', description: 'Album by its link name (`slug`). Hidden albums return 404 unless you can manage albums.' })
  @ApiOkResponse({ type: AlbumDto })
  @ApiResponse({ status: 404, type: ErrorDto })
  get(@Param('slug') slug: string, @CurrentUser() user: AuthUser | null, @Req() req: Request, @Res({ passthrough: true }) res: Response) {
    setPublicCacheHeaders(req, res); // private for token holders, so hidden albums never reach a shared cache
    return this.albums.getBySlug(slug, user);
  }

  @Get(':slug/photos')
  @ApiOperation({
    summary: 'List album photos',
    description:
      "The album's active photos, newest first, cursor-paginated (same shape as `GET /photos`). Send a bearer token to also get `isFavorite` and `isSaved`.",
  })
  @ApiOkResponse({ type: PhotoListDto })
  @ApiResponse({ status: 400, type: ErrorDto, description: 'Malformed cursor' })
  @ApiResponse({ status: 404, type: ErrorDto })
  photos(
    @Param('slug') slug: string,
    @Query() q: ListQueryDto,
    @CurrentUser() user: AuthUser | null,
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ) {
    setPublicCacheHeaders(req, res); // private for token holders, so hidden albums never reach a shared cache
    return this.albums.listPhotos(slug, user, q.limit, q.cursor);
  }
}

@ApiTags('Admin')
@ApiBearerAuth()
@ApiResponse({ status: 401, type: ErrorDto, description: 'Missing or invalid token' })
@ApiResponse({ status: 403, type: ErrorDto, description: 'Needs the `albums.manage` permission (admins have it)' })
@Controller('admin/albums')
@UseGuards(JwtAuthGuard, PermissionsGuard)
@RequirePermissions('albums.manage')
export class AdminAlbumsController {
  constructor(private readonly albums: AlbumsService) {}

  @Post()
  @ApiOperation({
    summary: 'Create album',
    description: 'The link name (`slug`) is generated from the name unless given. Optionally pass `photoIds` to fill it straight away.',
  })
  @ApiCreatedResponse({ type: AlbumDto })
  @ApiResponse({ status: 409, type: ErrorDto, description: 'Slug already in use' })
  create(@Body() dto: CreateAlbumDto, @CurrentUser() user: AuthUser, @Res({ passthrough: true }) res: Response) {
    setNoStore(res);
    return this.albums.create(user, dto);
  }

  @Patch(':id')
  @ApiOperation({ summary: 'Update album', description: 'Rename, describe, hide/publish, change the link name or pick the cover photo.' })
  @ApiOkResponse({ type: AlbumDto })
  @ApiResponse({ status: 404, type: ErrorDto })
  @ApiResponse({ status: 409, type: ErrorDto, description: 'Slug already in use' })
  update(@Param('id', ParseIntPipe) id: number, @Body() dto: UpdateAlbumDto, @CurrentUser() user: AuthUser, @Res({ passthrough: true }) res: Response) {
    setNoStore(res);
    return this.albums.update(user, id, dto);
  }

  @Delete(':id')
  @HttpCode(204)
  @ApiOperation({ summary: 'Delete album', description: 'Deletes the album only. Its photos, favorites and saves are untouched.' })
  @ApiNoContentResponse()
  @ApiResponse({ status: 404, type: ErrorDto })
  remove(@Param('id', ParseIntPipe) id: number, @CurrentUser() user: AuthUser, @Res({ passthrough: true }) res: Response) {
    setNoStore(res);
    this.albums.remove(user, id);
  }

  @Post(':id/photos')
  @HttpCode(200)
  @ApiOperation({
    summary: 'Add photos to album',
    description: 'Idempotent. Photos already in the album, missing or in the trash are skipped; `changed` says how many were added.',
  })
  @ApiOkResponse({ type: AlbumPhotosResultDto })
  @ApiResponse({ status: 404, type: ErrorDto })
  addPhotos(@Param('id', ParseIntPipe) id: number, @Body() dto: AlbumPhotosDto, @CurrentUser() user: AuthUser, @Res({ passthrough: true }) res: Response) {
    setNoStore(res);
    return this.albums.addPhotos(user, id, dto.photoIds);
  }

  @Post(':id/photos/remove')
  @HttpCode(200)
  @ApiOperation({ summary: 'Remove photos from album', description: 'Idempotent. The photos themselves are not deleted.' })
  @ApiOkResponse({ type: AlbumPhotosResultDto })
  @ApiResponse({ status: 404, type: ErrorDto })
  removePhotos(@Param('id', ParseIntPipe) id: number, @Body() dto: AlbumPhotosDto, @CurrentUser() user: AuthUser, @Res({ passthrough: true }) res: Response) {
    setNoStore(res);
    return this.albums.removePhotos(user, id, dto.photoIds);
  }
}
