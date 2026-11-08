import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsIn, IsOptional, IsString, MaxLength } from 'class-validator';
import { Type } from 'class-transformer';

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
}
