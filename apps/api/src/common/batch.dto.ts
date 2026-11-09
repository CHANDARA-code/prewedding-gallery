import { ApiProperty } from '@nestjs/swagger';
import { ArrayMaxSize, ArrayMinSize, IsArray, IsInt, IsPositive } from 'class-validator';

/** Most photo ids one batch request takes (the selection bar sends bigger selections in several). */
export const BATCH_MAX = 1000;

export class PhotoIdsDto {
  @ApiProperty({ type: [Number], example: [12, 9, 4], description: `1 to ${BATCH_MAX} photo ids` })
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(BATCH_MAX)
  @IsInt({ each: true })
  @IsPositive({ each: true })
  photoIds: number[];
}

export class BatchResultDto {
  @ApiProperty({ example: 3, description: 'How many photos actually changed (missing ones, or ones already in that state, are skipped).' })
  changed: number;
}

/** Splits ids into chunks that stay well under SQLite's bound-parameter limit. */
export function chunks<T>(items: T[], size = 500): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size));
  return out;
}
