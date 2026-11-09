import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { ArrayMaxSize, ArrayMinSize, IsArray, IsBoolean, IsIn, IsInt, IsOptional, IsPositive, IsString, MaxLength } from 'class-validator';
import { Transform, Type } from 'class-transformer';
import { PhotoDto } from '../../common/photo.dto';
import { BATCH_MAX, PhotoIdsDto } from '../../common/batch.dto';

/** `ids=3,9,12` (or repeated `ids=`) → [3, 9, 12]; anything unparsable stays and fails validation. */
const idList = ({ value }: { value: unknown }) =>
  (Array.isArray(value) ? value : String(value ?? '').split(','))
    .map((v) => String(v).trim())
    .filter(Boolean)
    .map((v) => (/^\d+$/.test(v) ? Number(v) : v));

/** Most photos in one ZIP download (keeps it well under 4 GB and a reasonable wait). */
export const DOWNLOAD_MAX = 200;

export class DownloadQueryDto {
  @ApiProperty({ type: String, example: '12,9,4', description: `Comma-separated ids of active photos, 1 to ${DOWNLOAD_MAX}.` })
  @Transform(idList)
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(DOWNLOAD_MAX)
  @IsInt({ each: true })
  @IsPositive({ each: true })
  ids: number[];
}

export class BatchEditDto extends PhotoIdsDto {
  @ApiPropertyOptional({ example: 'Angkor Wat', nullable: true, type: String, description: 'Omit to keep each title; empty clears it.' })
  @IsOptional()
  @IsString()
  @MaxLength(200)
  title?: string | null;

  @ApiPropertyOptional({ example: 'Sunrise at the west gate', nullable: true, type: String, description: 'Omit to keep each caption; empty clears it.' })
  @IsOptional()
  @IsString()
  @MaxLength(1000)
  caption?: string | null;
}

export class UpdatePhotoDto {
  @ApiPropertyOptional({ example: 'Golden hour', nullable: true, type: String })
  @IsOptional()
  @IsString()
  @MaxLength(200)
  title?: string | null;

  @ApiPropertyOptional({ example: 'Angkor Wat, sunrise', nullable: true, type: String })
  @IsOptional()
  @IsString()
  @MaxLength(1000)
  caption?: string | null;
}

export class UploadPhotosDto extends UpdatePhotoDto {}

export class UploadPhotosBodyDoc {
  @ApiProperty({ type: 'array', items: { type: 'string', format: 'binary' }, description: '1 to 20 JPEG, PNG or WebP files, max 15 MB each' })
  files: unknown[];
  @ApiPropertyOptional({ example: 'Golden hour', description: 'Applied to every uploaded photo' })
  title?: string;
  @ApiPropertyOptional({ example: 'Angkor Wat, sunrise', description: 'Applied to every uploaded photo' })
  caption?: string;
}

export class RotatePhotoDto {
  @ApiProperty({ enum: [90, -90, 180], example: 90, description: 'Clockwise degrees; -90 rotates left.' })
  @Type(() => Number)
  @IsIn([90, -90, 180, 270])
  degrees: number;
}

/** Most photos one rotate request may re-render (about 1 s each); clients send larger selections in batches. */
export const ROTATE_BATCH_MAX = 24;

export class RotatePhotosDto extends RotatePhotoDto {
  @ApiProperty({ type: [Number], example: [12, 9, 4], description: `1 to ${ROTATE_BATCH_MAX} photo ids` })
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(ROTATE_BATCH_MAX)
  @IsInt({ each: true })
  @IsPositive({ each: true })
  photoIds: number[];
}

export class RotatePhotosResultDto {
  @ApiProperty({ type: () => PhotoDto, isArray: true, description: 'The photos that were rotated, as they are now.' })
  photos: PhotoDto[];
  @ApiProperty({ type: [Number], description: 'Ids whose re-render failed; those photos are unchanged.' })
  failed: number[];
}

export class ExportQueryDto {
  @ApiPropertyOptional({ enum: ['active', 'deleted', 'all'], default: 'all' })
  @IsOptional()
  @IsIn(['active', 'deleted', 'all'])
  status: 'active' | 'deleted' | 'all' = 'all';

  @ApiPropertyOptional({ enum: ['all', 'favorites', 'saves'], default: 'all', description: 'Only photos someone favorited / saved.' })
  @IsOptional()
  @IsIn(['all', 'favorites', 'saves'])
  collection: 'all' | 'favorites' | 'saves' = 'all';

  @ApiPropertyOptional({ type: Boolean, default: false, description: 'With `collection`: only your own favorites / saves.' })
  @IsOptional()
  // Read the raw query string: implicit conversion would turn "false" into true.
  @Transform(({ obj, key }) => [true, 'true', '1'].includes((obj as Record<string, unknown>)[key] as string))
  @IsBoolean()
  mine = false;

  @ApiPropertyOptional({ type: Number, example: 3, description: 'Only photos in this album (its `id`).' })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @IsPositive()
  album?: number;

  @ApiPropertyOptional({ type: String, example: '12,9,4', description: `Only these photo ids (comma-separated, up to ${BATCH_MAX}).` })
  @IsOptional()
  @Transform(idList)
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(BATCH_MAX)
  @IsInt({ each: true })
  @IsPositive({ each: true })
  ids?: number[];
}
