import { ApiPropertyOptional } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import { IsIn, IsInt, IsOptional, IsString, MaxLength } from 'class-validator';
import { clampLimit, DEFAULT_LIMIT, MAX_LIMIT } from './cursor';

export class ListQueryDto {
  @ApiPropertyOptional({ description: `Page size. Clamped to 1-${MAX_LIMIT}.`, default: DEFAULT_LIMIT, minimum: 1, maximum: MAX_LIMIT, example: 24 })
  @IsOptional()
  @Transform(({ value }) => clampLimit(value))
  @IsInt()
  limit: number = DEFAULT_LIMIT;

  @ApiPropertyOptional({ description: "Opaque cursor from the previous page's `nextCursor`. Omit for the first page.", example: 'eyJrIjoicCIsImlkIjoxMDB9' })
  @IsOptional()
  @IsString()
  @MaxLength(200)
  cursor?: string;
}

export class AdminListQueryDto extends ListQueryDto {
  @ApiPropertyOptional({ enum: ['active', 'deleted', 'all'], default: 'all' })
  @IsOptional()
  @IsIn(['active', 'deleted', 'all'])
  status: 'active' | 'deleted' | 'all' = 'all';
}
