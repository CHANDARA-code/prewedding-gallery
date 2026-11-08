import { Inject, Injectable } from '@nestjs/common';
import { and, desc, eq, isNotNull, isNull, lt, sql } from 'drizzle-orm';
import { DRIZZLE } from '../db/db.module';
import type { Db } from '../db/client';
import { favorites, photos, saves } from '../db/schema';
import type { PhotoListRow } from '../common/photo.dto';

/** Larger than any real id / unix timestamp; used as the "no cursor" upper bound. */
export const MAX_KEY = Number.MAX_SAFE_INTEGER;

// Only the columns the list DTO needs (spec 6.7.1).
const listCols = {
  id: photos.id,
  title: photos.title,
  caption: photos.caption,
  filename: photos.filename,
  thumbFilename: photos.thumbFilename,
  width: photos.width,
  height: photos.height,
  createdAt: photos.createdAt,
};
const p = (name: string) => sql.placeholder(name);
const isFavoriteCol = sql<number>`${favorites.photoId} IS NOT NULL`.as('is_favorite');
const isSavedCol = sql<number>`${saves.photoId} IS NOT NULL`.as('is_saved');

export type AdminStatus = 'active' | 'deleted' | 'all';

/**
 * Hot list queries, built once as prepared statements and re-executed with parameters.
 * Every query is an index-backed keyset walk (see the plan tests).
 */
@Injectable()
export class PhotosRepository {
  constructor(@Inject(DRIZZLE) private readonly db: Db) {}

  private readonly guestList = this.db
    .select(listCols)
    .from(photos)
    .where(and(isNull(photos.deletedAt), lt(photos.id, p('cursorId'))))
    .orderBy(desc(photos.id))
    .limit(p('limit'))
    .prepare();

  private readonly userList = this.db
    .select({ ...listCols, isFavorite: isFavoriteCol, isSaved: isSavedCol })
    .from(photos)
    .leftJoin(favorites, and(eq(favorites.userId, p('uid')), eq(favorites.photoId, photos.id)))
    .leftJoin(saves, and(eq(saves.userId, p('uid')), eq(saves.photoId, photos.id)))
    .where(and(isNull(photos.deletedAt), lt(photos.id, p('cursorId'))))
    .orderBy(desc(photos.id))
    .limit(p('limit'))
    .prepare();

  private adminListFor(status: AdminStatus) {
    const statusCond =
      status === 'active' ? isNull(photos.deletedAt) : status === 'deleted' ? isNotNull(photos.deletedAt) : undefined;
    return this.db
      .select({ ...listCols, deletedAt: photos.deletedAt, isFavorite: isFavoriteCol, isSaved: isSavedCol })
      .from(photos)
      .leftJoin(favorites, and(eq(favorites.userId, p('uid')), eq(favorites.photoId, photos.id)))
      .leftJoin(saves, and(eq(saves.userId, p('uid')), eq(saves.photoId, photos.id)))
      .where(and(statusCond, lt(photos.id, p('cursorId'))))
      .orderBy(desc(photos.id))
      .limit(p('limit'))
      .prepare();
  }
  private readonly adminLists = {
    active: this.adminListFor('active'),
    deleted: this.adminListFor('deleted'),
    all: this.adminListFor('all'),
  };

  /** Favorite tab (and, with the tables swapped, the Save tab). */
  private collectionList(kind: 'favorites' | 'saves') {
    const own = kind === 'favorites' ? favorites : saves;
    const other = kind === 'favorites' ? saves : favorites;
    const otherFlag = sql<number>`${other.photoId} IS NOT NULL`;
    return this.db
      .select({
        ...listCols,
        isFavorite: kind === 'favorites' ? sql<number>`1` : otherFlag,
        isSaved: kind === 'saves' ? sql<number>`1` : otherFlag,
        listedAt: sql<number>`${own.createdAt}`.as('listed_at'),
      })
      .from(own)
      // The soft-delete filter sits inside the join so a page is never short because of hidden photos.
      .innerJoin(photos, and(eq(photos.id, own.photoId), isNull(photos.deletedAt)))
      .leftJoin(other, and(eq(other.userId, own.userId), eq(other.photoId, own.photoId)))
      .where(and(eq(own.userId, p('uid')), sql`(${own.createdAt}, ${own.photoId}) < (${p('t')}, ${p('id')})`))
      .orderBy(desc(own.createdAt), desc(own.photoId))
      .limit(p('limit'))
      .prepare();
  }
  private readonly favoritesList = this.collectionList('favorites');
  private readonly savesList = this.collectionList('saves');

  private readonly detail = this.db
    .select({
      ...listCols,
      deletedAt: photos.deletedAt,
      mimeType: photos.mimeType,
      sizeBytes: photos.sizeBytes,
      uploadedBy: photos.uploadedBy,
      isFavorite: isFavoriteCol,
      isSaved: isSavedCol,
    })
    .from(photos)
    .leftJoin(favorites, and(eq(favorites.userId, p('uid')), eq(favorites.photoId, photos.id)))
    .leftJoin(saves, and(eq(saves.userId, p('uid')), eq(saves.photoId, photos.id)))
    .where(eq(photos.id, p('id')))
    .prepare();

  listPublic(uid: number | null, cursorId: number | null, limitPlusOne: number): PhotoListRow[] {
    const params = { cursorId: cursorId ?? MAX_KEY, limit: limitPlusOne };
    return uid === null ? this.guestList.all(params) : this.userList.all({ ...params, uid });
  }

  listAdmin(status: AdminStatus, uid: number, cursorId: number | null, limitPlusOne: number): PhotoListRow[] {
    return this.adminLists[status].all({ uid, cursorId: cursorId ?? MAX_KEY, limit: limitPlusOne });
  }

  listCollection(
    kind: 'favorites' | 'saves',
    uid: number,
    cursor: { t: number; id: number } | null,
    limitPlusOne: number,
  ): (PhotoListRow & { listedAt: number })[] {
    const stmt = kind === 'favorites' ? this.favoritesList : this.savesList;
    return stmt.all({ uid, t: cursor?.t ?? MAX_KEY, id: cursor?.id ?? MAX_KEY, limit: limitPlusOne });
  }

  findById(id: number, uid: number | null): (PhotoListRow & { deletedAt: Date | null }) | undefined {
    return this.detail.get({ id, uid: uid ?? 0 });
  }
}
