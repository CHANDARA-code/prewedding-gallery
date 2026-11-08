import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Param,
  ParseIntPipe,
  Patch,
  Post,
  Query,
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
import type { Response } from 'express';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { Roles } from '../auth/decorators/roles.decorator';
import { AuthUser, CurrentUser } from '../auth/decorators/current-user.decorator';
import { AdminListQueryDto } from '../common/list-query.dto';
import { ErrorDto, PhotoDto, PhotoListDto } from '../common/photo.dto';
import { setNoStore } from '../common/cache-headers';
import { PhotosService } from './photos.service';
import { UpdatePhotoDto, UploadPhotosBodyDoc, UploadPhotosDto } from './dto/photo-input.dto';

@ApiTags('Admin')
@ApiBearerAuth()
@ApiResponse({ status: 401, type: ErrorDto, description: 'Missing or invalid token' })
@ApiResponse({ status: 403, type: ErrorDto, description: 'Not an admin' })
@Controller('admin/photos')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles('admin')
export class AdminPhotosController {
  constructor(private readonly photos: PhotosService) {}

  @Get()
  @ApiOperation({ summary: 'List photos (admin)', description: 'All photos including soft-deleted ones, newest first, cursor-paginated. Filter with `status`.' })
  @ApiOkResponse({ type: PhotoListDto })
  list(@Query() q: AdminListQueryDto, @CurrentUser() user: AuthUser, @Res({ passthrough: true }) res: Response) {
    setNoStore(res);
    return this.photos.listAdmin(user, q.status, q.limit, q.cursor);
  }

  @Post()
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
  @ApiOperation({ summary: 'Update photo', description: 'Update the title and/or caption.' })
  @ApiOkResponse({ type: PhotoDto })
  @ApiResponse({ status: 404, type: ErrorDto })
  update(@Param('id', ParseIntPipe) id: number, @Body() dto: UpdatePhotoDto, @CurrentUser() user: AuthUser, @Res({ passthrough: true }) res: Response) {
    setNoStore(res);
    return this.photos.update(user, id, dto);
  }

  @Delete(':id')
  @ApiOperation({ summary: 'Soft delete', description: 'Moves the photo to trash. It disappears from every public and personal list and its files stop being served. Can be restored.' })
  @ApiOkResponse({ type: PhotoDto })
  @ApiResponse({ status: 404, type: ErrorDto })
  softDelete(@Param('id', ParseIntPipe) id: number, @CurrentUser() user: AuthUser, @Res({ passthrough: true }) res: Response) {
    setNoStore(res);
    return this.photos.softDelete(user, id);
  }

  @Post(':id/restore')
  @HttpCode(200)
  @ApiOperation({ summary: 'Restore', description: 'Restores a soft-deleted photo to every list it was in.' })
  @ApiOkResponse({ type: PhotoDto })
  @ApiResponse({ status: 404, type: ErrorDto })
  restore(@Param('id', ParseIntPipe) id: number, @CurrentUser() user: AuthUser, @Res({ passthrough: true }) res: Response) {
    setNoStore(res);
    return this.photos.restore(user, id);
  }

  @Delete(':id/permanent')
  @HttpCode(204)
  @ApiOperation({ summary: 'Hard delete', description: 'Permanently deletes the photo row, its files, and all favorites and saves of it. Cannot be undone.' })
  @ApiNoContentResponse()
  @ApiResponse({ status: 404, type: ErrorDto })
  async hardDelete(@Param('id', ParseIntPipe) id: number, @CurrentUser() user: AuthUser, @Res({ passthrough: true }) res: Response) {
    setNoStore(res);
    await this.photos.hardDelete(user, id);
  }
}
