import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class PhotoDto {
  @ApiProperty({ example: 12 }) id: number;
  @ApiProperty({ example: 'Golden hour', nullable: true, type: String }) title: string | null;
  @ApiProperty({ example: 'Angkor Wat, sunrise', nullable: true, type: String }) caption: string | null;
  @ApiProperty({ example: '/uploads/8f2c1a.jpg', description: 'The untouched original file (download).' }) url: string;
  @ApiProperty({ example: '/uploads/previews/77ab.webp', description: '2048px WebP for viewing, rotation applied. Falls back to `url` until generated.' })
  previewUrl: string;
  @ApiProperty({ example: '/uploads/thumbs/8f2c1a.webp' }) thumbUrl: string;
  @ApiProperty({ example: 3000, description: 'Displayed width in pixels (EXIF orientation and admin rotation applied).' }) width: number;
  @ApiProperty({ example: 2000 }) height: number;
  @ApiProperty({ example: 0, enum: [0, 90, 180, 270], description: 'Clockwise rotation an admin applied on top of EXIF orientation.' })
  rotation: number;
  @ApiProperty({ example: '2026-11-01T08:30:00.000Z' }) createdAt: string;
  @ApiPropertyOptional({ example: false, description: 'Present only when a valid token was sent.' }) isFavorite?: boolean;
  @ApiPropertyOptional({ example: true, description: 'Present only when a valid token was sent.' }) isSaved?: boolean;
  @ApiProperty({ example: null, nullable: true, type: String, description: 'Only ever non-null on admin responses.' }) deletedAt: string | null;
  @ApiPropertyOptional({ example: 'image/jpeg', description: 'Detail only.' }) mimeType?: string;
  @ApiPropertyOptional({ example: 2119246, description: 'Size of the original. Detail only.' }) sizeBytes?: number;
  @ApiPropertyOptional({
    description: 'Camera/lens/exposure EXIF of the original. Detail only. GPS and serial numbers are never included.',
    example: { make: 'Canon', model: 'Canon EOS R6', lens: 'EF70-200mm f/2.8L IS III USM', focalLength: 135, fNumber: 2.8, exposureTime: 0.00125, iso: 500, takenAt: '2026-11-06T16:44:27+07:00' },
    nullable: true,
    type: Object,
  })
  exif?: Record<string, unknown> | null;
  @ApiPropertyOptional({ example: 2, description: 'Admin detail only.' }) uploadedBy?: number;
  @ApiPropertyOptional({ example: 'KSNT0990.jpg', nullable: true, type: String, description: 'Admin only: the uploaded file name.' })
  originalName?: string | null;
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
  previewFilename?: string | null;
  rotation?: number;
  width: number;
  height: number;
  createdAt: Date | number;
  deletedAt?: Date | number | null;
  isFavorite?: number | boolean | null;
  isSaved?: number | boolean | null;
  mimeType?: string;
  sizeBytes?: number;
  uploadedBy?: number;
  originalName?: string | null;
  exif?: string | null;
}

const toIso = (v: Date | number) => (v instanceof Date ? v : new Date(v * 1000)).toISOString();

function parseJson(v: string | null | undefined): Record<string, unknown> | null {
  if (!v) return null;
  try {
    return JSON.parse(v) as Record<string, unknown>;
  } catch {
    return null;
  }
}

export function toPhotoDto(row: PhotoListRow, opts: { withFlags: boolean; admin?: boolean; detail?: boolean }): PhotoDto {
  const url = `/uploads/${row.filename}`;
  const dto: PhotoDto = {
    id: row.id,
    title: row.title,
    caption: row.caption,
    url,
    previewUrl: row.previewFilename ? `/uploads/previews/${row.previewFilename}` : url,
    thumbUrl: `/uploads/thumbs/${row.thumbFilename}`,
    width: row.width,
    height: row.height,
    rotation: row.rotation ?? 0,
    createdAt: toIso(row.createdAt),
    deletedAt: opts.admin && row.deletedAt ? toIso(row.deletedAt) : null,
  };
  if (opts.withFlags) {
    dto.isFavorite = Boolean(row.isFavorite);
    dto.isSaved = Boolean(row.isSaved);
  }
  if (opts.detail && row.mimeType !== undefined) {
    dto.mimeType = row.mimeType;
    dto.sizeBytes = row.sizeBytes;
    dto.exif = parseJson(row.exif);
  }
  if (opts.admin && row.uploadedBy !== undefined) dto.uploadedBy = row.uploadedBy;
  if (opts.admin && row.originalName !== undefined) dto.originalName = row.originalName;
  return dto;
}
