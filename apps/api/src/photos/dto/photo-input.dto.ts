import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsOptional, IsString, MaxLength } from 'class-validator';

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
