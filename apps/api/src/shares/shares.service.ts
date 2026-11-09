import { BadRequestException, ForbiddenException, GoneException, Inject, Injectable, NotFoundException, UnauthorizedException } from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { randomBytes } from 'crypto';
import { and, asc, desc, eq, inArray, isNull, lt, ne, sql } from 'drizzle-orm';
import { DRIZZLE } from '../db/db.module';
import type { Db } from '../db/client';
import { favorites, photos, saves, sharePhotos, shares, shareUsers, users, type Share } from '../db/schema';
import { decodeIdCursor, encodeCursor } from '../common/cursor';
import { PhotoListDto, PhotoListRow, toPage, toPhotoDto } from '../common/photo.dto';
import { chunks } from '../common/batch.dto';
import type { AuthUser } from '../auth/decorators/current-user.decorator';
import { hasPermission } from '../auth/permissions';
import { AppEvents } from '../alerts/events';
import { MAX_KEY } from '../photos/photos.repository';
import { CreateShareDto, MySharesDto, PersonDto, ShareDto, UpdateShareDto } from './share.dto';

const p = (name: string) => sql.placeholder(name);
const toIso = (v: Date | number) => (v instanceof Date ? v : new Date(v * 1000)).toISOString();
const DAY = 86_400_000;

const listCols = {
  id: photos.id,
  title: photos.title,
  caption: photos.caption,
  filename: photos.filename,
  thumbFilename: photos.thumbFilename,
  previewFilename: photos.previewFilename,
  rotation: photos.rotation,
  width: photos.width,
  height: photos.height,
  createdAt: photos.createdAt,
};

/** Admins see and manage every link. */
const isAdmin = (user: AuthUser | null | undefined) => hasPermission(user, 'users.manage');
const isExpired = (s: Share, now = Date.now()) => !!s.expiresAt && s.expiresAt.getTime() <= now;

interface StatsRow {
  id: number;
  photo_count: number;
  cover_id: number | null;
}

/**
 * Share links: a set of photos behind an unguessable token. Anyone signed in can make one from a
 * selection. Public links open for anyone; private ones only for the chosen accounts, the creator and
 * admins. Trashed photos are hidden from a link until restored; deleting a photo removes it.
 */
@Injectable()
export class SharesService {
  constructor(
    @Inject(DRIZZLE) private readonly db: Db,
    private readonly events: EventEmitter2,
  ) {}

  // Same keyset walk as an album page, over the (share_id, photo_id) primary key.
  private readonly guestPhotos = this.db
    .select(listCols)
    .from(sharePhotos)
    .crossJoin(photos)
    .where(and(eq(sharePhotos.shareId, p('shareId')), lt(sharePhotos.photoId, p('cursorId')), eq(photos.id, sharePhotos.photoId), isNull(photos.deletedAt)))
    .orderBy(desc(sharePhotos.photoId))
    .limit(p('limit'))
    .prepare();

  private readonly userPhotos = this.db
    .select({
      ...listCols,
      isFavorite: sql<number>`${favorites.photoId} IS NOT NULL`.as('is_favorite'),
      isSaved: sql<number>`${saves.photoId} IS NOT NULL`.as('is_saved'),
    })
    .from(sharePhotos)
    .crossJoin(photos)
    .leftJoin(favorites, and(eq(favorites.userId, p('uid')), eq(favorites.photoId, sharePhotos.photoId)))
    .leftJoin(saves, and(eq(saves.userId, p('uid')), eq(saves.photoId, sharePhotos.photoId)))
    .where(and(eq(sharePhotos.shareId, p('shareId')), lt(sharePhotos.photoId, p('cursorId')), eq(photos.id, sharePhotos.photoId), isNull(photos.deletedAt)))
    .orderBy(desc(sharePhotos.photoId))
    .limit(p('limit'))
    .prepare();

  /* ---------- opening a link ---------- */

  get(token: string, user: AuthUser | null): ShareDto {
    return this.toDtos([this.open(token, user)], user)[0];
  }

  listPhotos(token: string, user: AuthUser | null, limit: number, cursor?: string): PhotoListDto {
    const share = this.open(token, user);
    const c = decodeIdCursor(cursor, 'h');
    const params = { shareId: share.id, cursorId: c?.id ?? MAX_KEY, limit: limit + 1 };
    const rows: PhotoListRow[] = user ? this.userPhotos.all({ ...params, uid: user.id }) : this.guestPhotos.all(params);
    return toPage(rows, limit, (r) => encodeCursor('h', { id: r.id }), (r) => toPhotoDto(r, { withFlags: !!user }));
  }

  /** Open Graph card data for `/s/:token`: only for public, live links (private ones get the generic card). */
  findPublicForOg(token: string): ShareDto | undefined {
    const row = this.db.select().from(shares).where(eq(shares.token, token)).get();
    return row && row.visibility === 'public' && !isExpired(row) ? this.toDtos([row], null)[0] : undefined;
  }

  /* ---------- my links ---------- */

  mine(user: AuthUser): MySharesDto {
    const created = this.db.select().from(shares).where(eq(shares.createdBy, user.id)).orderBy(desc(shares.id)).all();
    const received = this.db
      .select({ s: shares })
      .from(shareUsers)
      .innerJoin(shares, eq(shares.id, shareUsers.shareId))
      .where(and(eq(shareUsers.userId, user.id), eq(shares.visibility, 'private'), ne(shares.createdBy, user.id)))
      .orderBy(desc(shares.id))
      .all()
      .map((r) => r.s)
      .filter((s) => !isExpired(s));
    const out: MySharesDto = { created: this.toDtos(created, user), received: this.toDtos(received, user) };
    if (isAdmin(user)) {
      out.others = this.toDtos(this.db.select().from(shares).where(ne(shares.createdBy, user.id)).orderBy(desc(shares.id)).all(), user);
    }
    return out;
  }

  /** Accounts a private link can be shared with. */
  people(user: AuthUser): PersonDto[] {
    return this.db
      .select({ id: users.id, username: users.username })
      .from(users)
      .where(and(eq(users.disabled, false), ne(users.id, user.id)))
      .orderBy(asc(users.username))
      .all();
  }

  /* ---------- writes ---------- */

  create(user: AuthUser, dto: CreateShareDto): ShareDto {
    const visibility = dto.visibility ?? 'public';
    const people = visibility === 'private' ? this.checkPeople(dto.userIds, user) : [];
    const id = this.db.transaction((tx) => {
      const row = tx
        .insert(shares)
        .values({ token: randomBytes(16).toString('base64url'), title: dto.title || null, visibility, createdBy: user.id, expiresAt: expiry(dto.expiresInDays) })
        .returning({ id: shares.id })
        .get();
      let added = 0;
      for (const chunk of chunks([...new Set(dto.photoIds)])) {
        added += tx.run(sql`
          INSERT INTO share_photos (share_id, photo_id)
          SELECT ${row.id}, id FROM photos WHERE id IN (${sql.join(chunk.map((x) => sql`${x}`), sql`, `)}) AND deleted_at IS NULL
          ON CONFLICT DO NOTHING`).changes;
      }
      if (!added) throw new BadRequestException('None of these photos can be shared (they may have been deleted)');
      if (people.length) tx.insert(shareUsers).values(people.map((u) => ({ shareId: row.id, userId: u.id }))).run();
      return row.id;
    });
    const share = this.byId(id, user);
    this.emit(user, share, 'created');
    return share;
  }

  update(user: AuthUser, id: number, dto: UpdateShareDto): ShareDto {
    const row = this.managed(id, user);
    const visibility = dto.visibility ?? row.visibility;
    const patch: Partial<typeof shares.$inferInsert> = {};
    if (dto.title !== undefined) patch.title = dto.title || null;
    if (dto.visibility !== undefined) patch.visibility = dto.visibility;
    if (dto.expiresInDays !== undefined) patch.expiresAt = expiry(dto.expiresInDays);
    // Going private needs people; staying private may swap them.
    const people =
      visibility === 'private' && (dto.userIds !== undefined || row.visibility !== 'private') ? this.checkPeople(dto.userIds, user) : undefined;
    this.db.transaction((tx) => {
      if (Object.keys(patch).length) tx.update(shares).set(patch).where(eq(shares.id, id)).run();
      if (people) {
        tx.delete(shareUsers).where(eq(shareUsers.shareId, id)).run();
        tx.insert(shareUsers).values(people.map((u) => ({ shareId: id, userId: u.id }))).run();
      }
    });
    const share = this.byId(id, user);
    this.emit(user, share, 'updated');
    return share;
  }

  remove(user: AuthUser, id: number) {
    const share = this.byId(this.managed(id, user).id, user);
    this.db.delete(shares).where(eq(shares.id, id)).run();
    this.emit(user, share, 'deleted');
  }

  /* ---------- helpers ---------- */

  /** The share behind a token, if this caller may open it. */
  private open(token: string, user: AuthUser | null): Share {
    const row = this.db.select().from(shares).where(eq(shares.token, token)).get();
    if (!row) throw new NotFoundException('This link does not exist or was deleted');
    const manager = this.canManage(row, user);
    if (isExpired(row) && !manager) throw new GoneException('This link has expired');
    if (row.visibility === 'private' && !manager) {
      if (!user) throw new UnauthorizedException('Log in to see the photos shared with you');
      const invited = this.db
        .select({ id: shareUsers.userId })
        .from(shareUsers)
        .where(and(eq(shareUsers.shareId, row.id), eq(shareUsers.userId, user.id)))
        .get();
      if (!invited) throw new ForbiddenException('This link was shared with someone else');
    }
    return row;
  }

  private canManage(row: Share, user: AuthUser | null | undefined) {
    return !!user && (row.createdBy === user.id || isAdmin(user));
  }

  private managed(id: number, user: AuthUser): Share {
    const row = this.db.select().from(shares).where(eq(shares.id, id)).get();
    if (!row || !this.canManage(row, user)) throw new NotFoundException('Share link not found');
    return row;
  }

  private checkPeople(userIds: number[] | undefined, user: AuthUser): PersonDto[] {
    const ids = [...new Set(userIds ?? [])].filter((x) => x !== user.id);
    if (!ids.length) throw new BadRequestException('Choose at least one person to share with');
    const found = this.db
      .select({ id: users.id, username: users.username })
      .from(users)
      .where(and(inArray(users.id, ids), eq(users.disabled, false)))
      .all();
    if (found.length !== ids.length) throw new BadRequestException('Some of those people do not exist');
    return found;
  }

  private byId(id: number, user: AuthUser): ShareDto {
    return this.toDtos([this.db.select().from(shares).where(eq(shares.id, id)).get()!], user)[0];
  }

  private emit(user: AuthUser, share: ShareDto, change: 'created' | 'updated' | 'deleted') {
    this.events.emit(AppEvents.ShareChanged, {
      actor: user,
      change,
      title: share.title,
      photoCount: share.photoCount,
      visibility: share.visibility,
      people: share.people?.map((u) => u.username) ?? [],
      expiresAt: share.expiresAt,
    });
  }

  /** Counts, covers, creators and (for managers) recipients in a few queries for the whole list. */
  private toDtos(rows: Share[], user: AuthUser | null): ShareDto[] {
    if (!rows.length) return [];
    const ids = rows.map((r) => r.id);
    const inIds = sql.join(ids.map((x) => sql`${x}`), sql`, `);
    const stats = this.db.all<StatsRow>(sql`
      SELECT s.id,
             (SELECT count(*) FROM share_photos sp JOIN photos p ON p.id = sp.photo_id AND p.deleted_at IS NULL
               WHERE sp.share_id = s.id) AS photo_count,
             (SELECT max(sp.photo_id) FROM share_photos sp JOIN photos p ON p.id = sp.photo_id AND p.deleted_at IS NULL
               WHERE sp.share_id = s.id) AS cover_id
      FROM shares s WHERE s.id IN (${inIds})`);
    const byId = new Map(stats.map((s) => [s.id, s]));
    const coverIds = stats.map((s) => s.cover_id).filter((x): x is number => x !== null);
    const covers = new Map(
      (coverIds.length
        ? this.db
            .select({ id: photos.id, thumbFilename: photos.thumbFilename, previewFilename: photos.previewFilename, filename: photos.filename, width: photos.width, height: photos.height })
            .from(photos)
            .where(inArray(photos.id, coverIds))
            .all()
        : []
      ).map((c) => [c.id, c]),
    );
    const creatorIds = [...new Set(rows.map((r) => r.createdBy))];
    const creators = new Map(
      this.db.select({ id: users.id, username: users.username }).from(users).where(inArray(users.id, creatorIds)).all().map((u) => [u.id, u]),
    );
    const managed = rows.filter((r) => this.canManage(r, user)).map((r) => r.id);
    const people = new Map<number, PersonDto[]>();
    if (managed.length) {
      for (const r of this.db
        .select({ shareId: shareUsers.shareId, id: users.id, username: users.username })
        .from(shareUsers)
        .innerJoin(users, eq(users.id, shareUsers.userId))
        .where(inArray(shareUsers.shareId, managed))
        .orderBy(asc(users.username))
        .all()) {
        people.set(r.shareId, [...(people.get(r.shareId) ?? []), { id: r.id, username: r.username }]);
      }
    }
    const now = Date.now();
    return rows.map((r) => {
      const s = byId.get(r.id);
      const c = s?.cover_id ? covers.get(s.cover_id) : undefined;
      const canManage = this.canManage(r, user);
      return {
        id: r.id,
        token: r.token,
        path: `/s/${r.token}`,
        title: r.title,
        visibility: r.visibility,
        photoCount: s?.photo_count ?? 0,
        cover: c
          ? {
              id: c.id,
              thumbUrl: `/uploads/thumbs/${c.thumbFilename}`,
              previewUrl: c.previewFilename ? `/uploads/previews/${c.previewFilename}` : `/uploads/${c.filename}`,
              width: c.width,
              height: c.height,
            }
          : null,
        createdBy: creators.get(r.createdBy) ?? { id: r.createdBy, username: 'unknown' },
        createdAt: toIso(r.createdAt),
        expiresAt: r.expiresAt ? toIso(r.expiresAt) : null,
        expired: isExpired(r, now),
        canManage,
        ...(canManage && { people: r.visibility === 'private' ? (people.get(r.id) ?? []) : [] }),
      };
    });
  }
}

function expiry(days: number | null | undefined): Date | null {
  return days ? new Date(Date.now() + days * DAY) : null;
}
