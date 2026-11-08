import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsBoolean, IsIn, IsOptional, IsString, MaxLength } from 'class-validator';
import { Transform, Type } from 'class-transformer';

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
}
