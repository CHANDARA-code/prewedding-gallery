import { Inject, Injectable } from '@nestjs/common';
import { and, eq, inArray, sql } from 'drizzle-orm';
import { chunks } from '../common/batch.dto';
import { DRIZZLE } from '../db/db.module';
import type { Db } from '../db/client';
import { favorites, saves } from '../db/schema';

/** Idempotent add/remove for the favorites and saves join tables. Returns whether anything changed. */
@Injectable()
export class CollectionService {
  constructor(@Inject(DRIZZLE) private readonly db: Db) {}

  add(kind: 'favorites' | 'saves', userId: number, photoId: number): boolean {
    const table = kind === 'favorites' ? favorites : saves;
    return this.db.insert(table).values({ userId, photoId }).onConflictDoNothing().run().changes > 0;
  }

  remove(kind: 'favorites' | 'saves', userId: number, photoId: number): boolean {
    const table = kind === 'favorites' ? favorites : saves;
    return this.db.delete(table).where(and(eq(table.userId, userId), eq(table.photoId, photoId))).run().changes > 0;
  }

  /** Adds many at once; only active photos. Returns how many were new. */
  addMany(kind: 'favorites' | 'saves', userId: number, photoIds: number[]): number {
    const table = kind === 'favorites' ? sql`favorites` : sql`saves`;
    return this.db.transaction((tx) =>
      chunks([...new Set(photoIds)]).reduce(
        (n, chunk) =>
          n +
          tx.run(sql`
            INSERT INTO ${table} (user_id, photo_id)
            SELECT ${userId}, id FROM photos WHERE id IN (${sql.join(chunk.map((x) => sql`${x}`), sql`, `)}) AND deleted_at IS NULL
            ON CONFLICT DO NOTHING`).changes,
        0,
      ),
    );
  }

  /** Removes many at once. Returns how many were there. */
  removeMany(kind: 'favorites' | 'saves', userId: number, photoIds: number[]): number {
    const table = kind === 'favorites' ? favorites : saves;
    return this.db.transaction((tx) =>
      chunks([...new Set(photoIds)]).reduce(
        (n, chunk) => n + tx.delete(table).where(and(eq(table.userId, userId), inArray(table.photoId, chunk))).run().changes,
        0,
      ),
    );
  }
}
