import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import { ArrayMaxSize, ArrayMinSize, IsArray, IsIn, IsInt, IsOptional, IsPositive, IsString, Max, MaxLength, Min, ValidateIf } from 'class-validator';
import { AlbumCoverDto } from '../albums/album.dto';

/** Most photos one link can hold (a Ctrl+A over a long scroll can be big). */
export const SHARE_MAX_PHOTOS = 5000;
export const SHARE_MAX_PEOPLE = 100;
export const SHARE_TOKEN = /^[A-Za-z0-9_-]{16,64}$/;
export type ShareVisibility = 'public' | 'private';

const trim = ({ value }: { value: unknown }) => (typeof value === 'string' ? value.trim() : value);

export class PersonDto {
  @ApiProperty({ example: 4 }) id: number;
  @ApiProperty({ example: 'dara' }) username: string;
}

export class ShareDto {
  @ApiProperty({ example: 7 }) id: number;
  @ApiProperty({ example: 'q8WcR1vX0yKp3mTz5LbN2a', description: 'The unguessable part of the link.' }) token: string;
  @ApiProperty({ example: '/s/q8WcR1vX0yKp3mTz5LbN2a', description: 'Path of the share page on the web app.' }) path: string;
  @ApiProperty({ example: 'For Mom & Dad', nullable: true, type: String }) title: string | null;
  @ApiProperty({ enum: ['public', 'private'], description: '`public`: anyone with the link. `private`: only the listed people (signed in), the creator and admins.' })
  visibility: ShareVisibility;
  @ApiProperty({ example: 24, description: 'Active (not trashed) photos in the link.' }) photoCount: number;
  @ApiProperty({ type: AlbumCoverDto, nullable: true, description: 'Newest photo in the link.' }) cover: AlbumCoverDto | null;
  @ApiProperty({ type: PersonDto }) createdBy: PersonDto;
  @ApiProperty({ example: '2026-11-09T08:30:00.000Z' }) createdAt: string;
  @ApiProperty({ example: null, nullable: true, type: String, description: 'When the link stops working (null = never).' }) expiresAt: string | null;
  @ApiProperty({ example: false }) expired: boolean;
  @ApiProperty({ example: true, description: 'The caller can edit or delete this link (its creator, or an admin).' }) canManage: boolean;
  @ApiPropertyOptional({ type: [PersonDto], description: 'Who a private link is for. Only sent to people who can manage the link.' })
  people?: PersonDto[];
}

export class MySharesDto {
  @ApiProperty({ type: [ShareDto], description: 'Links you created, newest first.' }) created: ShareDto[];
  @ApiProperty({ type: [ShareDto], description: 'Private links shared with you (not expired), newest first.' }) received: ShareDto[];
  @ApiPropertyOptional({ type: [ShareDto], description: "Admins only: everyone else's links." }) others?: ShareDto[];
}

class ShareOptionsDto {
  @ApiPropertyOptional({ example: 'For Mom & Dad', nullable: true, type: String })
  @IsOptional()
  @Transform(trim)
  @IsString()
  @MaxLength(120)
  title?: string | null;

  @ApiPropertyOptional({ enum: ['public', 'private'], default: 'public' })
  @IsOptional()
  @IsIn(['public', 'private'])
  visibility?: ShareVisibility;

  @ApiPropertyOptional({ type: [Number], example: [4], description: 'Account ids a private link is for (required when private).' })
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(SHARE_MAX_PEOPLE)
  @IsInt({ each: true })
  @IsPositive({ each: true })
  userIds?: number[];

  @ApiPropertyOptional({ example: 30, nullable: true, type: Number, description: 'Days until the link stops working (1–365); null or omitted = never.' })
  @IsOptional()
  @ValidateIf((_o, v) => v !== null)
  @IsInt()
  @Min(1)
  @Max(365)
  expiresInDays?: number | null;
}

export class CreateShareDto extends ShareOptionsDto {
  @ApiProperty({ type: [Number], example: [12, 9, 4], description: `1 to ${SHARE_MAX_PHOTOS} photo ids. Missing or trashed ones are skipped.` })
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(SHARE_MAX_PHOTOS)
  @IsInt({ each: true })
  @IsPositive({ each: true })
  photoIds: number[];
}

export class UpdateShareDto extends ShareOptionsDto {}
