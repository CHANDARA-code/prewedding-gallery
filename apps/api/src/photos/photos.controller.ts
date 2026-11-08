import { Controller, Get, Param, ParseIntPipe, Query, Req, Res, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOkResponse, ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger';
import type { Request, Response } from 'express';
import { OptionalJwtAuthGuard } from '../auth/guards/optional-jwt-auth.guard';
import { AuthUser, CurrentUser } from '../auth/decorators/current-user.decorator';
import { ListQueryDto } from '../common/list-query.dto';
import { ErrorDto, PhotoDto, PhotoListDto } from '../common/photo.dto';
import { setPublicCacheHeaders } from '../common/cache-headers';
import { PhotosService } from './photos.service';

@ApiTags('Photos')
@ApiBearerAuth()
@Controller('photos')
@UseGuards(OptionalJwtAuthGuard)
export class PhotosController {
  constructor(private readonly photos: PhotosService) {}

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
    description: 'Photo detail. Soft-deleted photos return 404 except for admins, who also get `mimeType`, `sizeBytes` and `uploadedBy`.',
  })
  @ApiOkResponse({ type: PhotoDto })
  @ApiResponse({ status: 404, type: ErrorDto })
  get(@Param('id', ParseIntPipe) id: number, @CurrentUser() user: AuthUser | null, @Req() req: Request, @Res({ passthrough: true }) res: Response) {
    setPublicCacheHeaders(req, res);
    return this.photos.getOne(id, user);
  }
}
