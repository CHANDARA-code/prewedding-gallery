import { Inject, Injectable } from '@nestjs/common';
import { and, eq } from 'drizzle-orm';
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
}
