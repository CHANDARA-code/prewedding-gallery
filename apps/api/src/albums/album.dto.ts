import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { ArrayMaxSize, ArrayMinSize, IsArray, IsBoolean, IsInt, IsOptional, IsPositive, IsString, Matches, MaxLength, MinLength, ValidateIf } from 'class-validator';
import { Transform } from 'class-transformer';

export const SLUG_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
export const MAX_PHOTOS_PER_CALL = 1000;

export class AlbumCoverDto {
  @ApiProperty({ example: 41 }) id: number;
  @ApiProperty({ example: '/uploads/thumbs/8f2c1a.webp' }) thumbUrl: string;
  @ApiProperty({ example: '/uploads/previews/77ab.webp' }) previewUrl: string;
  @ApiProperty({ example: 3000 }) width: number;
  @ApiProperty({ example: 2000 }) height: number;
}

export class AlbumDto {
  @ApiProperty({ example: 3 }) id: number;
  @ApiProperty({ example: 'barsat-angkor-wat', description: 'Used in links: `/albums/{slug}`.' }) slug: string;
  @ApiProperty({ example: 'Barsat Angkor Wat' }) name: string;
  @ApiProperty({ example: 'Sunrise at the west gate', nullable: true, type: String }) description: string | null;
  @ApiProperty({ example: false, description: 'Hidden albums are only listed for accounts with `albums.manage`.' }) hidden: boolean;
  @ApiProperty({ example: 48, description: 'Active (not trashed) photos in the album.' }) photoCount: number;
  @ApiProperty({ type: AlbumCoverDto, nullable: true, description: 'The chosen cover, else the newest photo in the album.' })
  cover: AlbumCoverDto | null;
  @ApiProperty({ example: null, nullable: true, type: Number, description: 'The explicitly chosen cover photo id (null = automatic).' })
  coverPhotoId: number | null;
  @ApiProperty({ example: '2026-11-08T08:30:00.000Z' }) createdAt: string;
  @ApiProperty({ example: '2026-11-08T09:10:00.000Z' }) updatedAt: string;
}

/** The albums a photo belongs to (photo detail). */
export class AlbumRefDto {
  @ApiProperty({ example: 3 }) id: number;
  @ApiProperty({ example: 'barsat-angkor-wat' }) slug: string;
  @ApiProperty({ example: 'Barsat Angkor Wat' }) name: string;
}

const trim = ({ value }: { value: unknown }) => (typeof value === 'string' ? value.trim() : value);

export class CreateAlbumDto {
  @ApiProperty({ example: 'Barsat Angkor Wat' })
  @Transform(trim)
  @IsString()
  @MinLength(1)
  @MaxLength(120)
  name: string;

  @ApiPropertyOptional({ example: 'Sunrise at the west gate', nullable: true, type: String })
  @IsOptional()
  @Transform(trim)
  @IsString()
  @MaxLength(1000)
  description?: string | null;

  @ApiPropertyOptional({ example: 'barsat-angkor-wat', description: 'Lowercase letters, digits and dashes. Generated from the name when omitted.' })
  @IsOptional()
  @Transform(trim)
  @IsString()
  @MaxLength(60)
  @Matches(SLUG_PATTERN, { message: 'slug may only contain lowercase letters, digits and single dashes' })
  slug?: string;

  @ApiPropertyOptional({ example: false, default: false, description: 'Hide from guests and users while you build it.' })
  @IsOptional()
  @IsBoolean()
  hidden?: boolean;

  @ApiPropertyOptional({ example: [12, 13, 14], description: 'Photos to put in the album straight away.', type: [Number] })
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(MAX_PHOTOS_PER_CALL)
  @IsInt({ each: true })
  @IsPositive({ each: true })
  photoIds?: number[];
}

export class UpdateAlbumDto {
  @ApiPropertyOptional({ example: 'Barsat Angkor Wat' })
  @IsOptional()
  @Transform(trim)
  @IsString()
  @MinLength(1)
  @MaxLength(120)
  name?: string;

  @ApiPropertyOptional({ example: 'Sunrise at the west gate', nullable: true, type: String })
  @IsOptional()
  @Transform(trim)
  @IsString()
  @MaxLength(1000)
  description?: string | null;

  @ApiPropertyOptional({ example: 'barsat-angkor-wat', description: 'Changing it breaks links shared with the old one.' })
  @IsOptional()
  @Transform(trim)
  @IsString()
  @MaxLength(60)
  @Matches(SLUG_PATTERN, { message: 'slug may only contain lowercase letters, digits and single dashes' })
  slug?: string;

  @ApiPropertyOptional({ example: false })
  @IsOptional()
  @IsBoolean()
  hidden?: boolean;

  @ApiPropertyOptional({ example: 41, nullable: true, type: Number, description: 'A photo in the album, or null for automatic (newest photo).' })
  @IsOptional()
  @ValidateIf((_o, v) => v !== null)
  @IsInt()
  @IsPositive()
  coverPhotoId?: number | null;
}

export class AlbumPhotosDto {
  @ApiProperty({ example: [12, 13, 14], type: [Number], description: `1 to ${MAX_PHOTOS_PER_CALL} photo ids.` })
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(MAX_PHOTOS_PER_CALL)
  @IsInt({ each: true })
  @IsPositive({ each: true })
  photoIds: number[];
}

export class AlbumPhotosResultDto {
  @ApiProperty({ example: 3, description: 'How many photos were actually added / removed (already-there or missing ones are skipped).' })
  changed: number;
  @ApiProperty({ type: AlbumDto }) album: AlbumDto;
}
