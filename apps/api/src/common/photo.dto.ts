import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class PhotoDto {
  @ApiProperty({ example: 12 }) id: number;
  @ApiProperty({ example: 'Golden hour', nullable: true, type: String }) title: string | null;
  @ApiProperty({ example: 'Angkor Wat, sunrise', nullable: true, type: String }) caption: string | null;
  @ApiProperty({ example: '/uploads/8f2c1a.jpg' }) url: string;
  @ApiProperty({ example: '/uploads/thumbs/8f2c1a.webp' }) thumbUrl: string;
  @ApiProperty({ example: 3000 }) width: number;
  @ApiProperty({ example: 2000 }) height: number;
  @ApiProperty({ example: '2026-11-01T08:30:00.000Z' }) createdAt: string;
  @ApiPropertyOptional({ example: false, description: 'Present only when a valid token was sent.' }) isFavorite?: boolean;
  @ApiPropertyOptional({ example: true, description: 'Present only when a valid token was sent.' }) isSaved?: boolean;
  @ApiProperty({ example: null, nullable: true, type: String, description: 'Only ever non-null on admin responses.' }) deletedAt: string | null;
  @ApiPropertyOptional({ example: 'image/jpeg', description: 'Admin detail only.' }) mimeType?: string;
  @ApiPropertyOptional({ example: 2119246, description: 'Admin detail only.' }) sizeBytes?: number;
  @ApiPropertyOptional({ example: 2, description: 'Admin detail only.' }) uploadedBy?: number;
}

export class PhotoListDto {
  @ApiProperty({ type: [PhotoDto] }) items: PhotoDto[];
  @ApiProperty({ example: 'eyJrIjoicCIsImlkIjoxMDB9', nullable: true, type: String }) nextCursor: string | null;
  @ApiProperty({ example: true }) hasMore: boolean;
}

export class ErrorDto {
  @ApiProperty({ example: 404 }) statusCode: number;
  @ApiProperty({ example: 'Not Found' }) error: string;
  @ApiProperty({ example: 'Photo not found' }) message: string;
}

/** Row shape returned by the list queries (only the columns the DTO needs). */
export interface PhotoListRow {
  id: number;
  title: string | null;
  caption: string | null;
  filename: string;
  thumbFilename: string;
  width: number;
  height: number;
  createdAt: Date | number;
  deletedAt?: Date | number | null;
  isFavorite?: number | boolean | null;
  isSaved?: number | boolean | null;
  mimeType?: string;
  sizeBytes?: number;
  uploadedBy?: number;
}

const toIso = (v: Date | number) => (v instanceof Date ? v : new Date(v * 1000)).toISOString();

export function toPhotoDto(row: PhotoListRow, opts: { withFlags: boolean; admin?: boolean }): PhotoDto {
  const dto: PhotoDto = {
    id: row.id,
    title: row.title,
    caption: row.caption,
    url: `/uploads/${row.filename}`,
    thumbUrl: `/uploads/thumbs/${row.thumbFilename}`,
    width: row.width,
    height: row.height,
    createdAt: toIso(row.createdAt),
    deletedAt: opts.admin && row.deletedAt ? toIso(row.deletedAt) : null,
  };
  if (opts.withFlags) {
    dto.isFavorite = Boolean(row.isFavorite);
    dto.isSaved = Boolean(row.isSaved);
  }
  if (opts.admin && row.mimeType !== undefined) {
    dto.mimeType = row.mimeType;
    dto.sizeBytes = row.sizeBytes;
    dto.uploadedBy = row.uploadedBy;
  }
  return dto;
}
