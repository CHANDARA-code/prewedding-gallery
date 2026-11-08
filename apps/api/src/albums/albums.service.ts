import { BadRequestException, ConflictException, Inject, Injectable, NotFoundException } from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { and, desc, eq, inArray, isNull, lt, sql } from 'drizzle-orm';
import { DRIZZLE } from '../db/db.module';
import type { Db } from '../db/client';
import { albumPhotos, albums, favorites, photos, saves, type Album } from '../db/schema';
import { decodeIdCursor, encodeCursor } from '../common/cursor';
import { PhotoListDto, PhotoListRow, toPage, toPhotoDto } from '../common/photo.dto';
import type { AuthUser } from '../auth/decorators/current-user.decorator';
import { hasPermission } from '../auth/permissions';
import { AppEvents } from '../alerts/events';
import { MAX_KEY } from '../photos/photos.repository';
import { AlbumDto, AlbumPhotosResultDto, AlbumRefDto, CreateAlbumDto, UpdateAlbumDto } from './album.dto';

const p = (name: string) => sql.placeholder(name);
const toIso = (v: Date | number) => (v instanceof Date ? v : new Date(v * 1000)).toISOString();

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

interface AlbumStatsRow {
  id: number;
  photo_count: number;
  cover_id: number | null;
}

/** "Barsat Angkor Wat" → "barsat-angkor-wat". Names with no Latin letters (e.g. Khmer) fall back to "album". */
export function slugify(name: string): string {
  const s = name
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 50)
    .replace(/-+$/, '');
  return s || 'album';
}

export const canManageAlbums = (user: AuthUser | null | undefined) => hasPermission(user, 'albums.manage');

/**
 * Albums: admin-curated sets of photos. Trashed photos stay in their albums but are hidden from every
 * album list and count until restored; hard-deleting a photo removes it from its albums (cascade).
 */
@Injectable()
export class AlbumsService {
  constructor(
    @Inject(DRIZZLE) private readonly db: Db,
    private readonly events: EventEmitter2,
  ) {}

  // Album page: keyset walk backwards over the (album_id, photo_id) primary key, newest photo first like
  // All. CROSS JOIN pins album_photos as the outer loop: otherwise SQLite walks every active photo and
  // sorts (see the plan tests). Trashed photos are filtered per row, so a page is never short.
  private readonly guestPhotos = this.db
    .select(listCols)
    .from(albumPhotos)
    .crossJoin(photos)
    .where(and(eq(albumPhotos.albumId, p('albumId')), lt(albumPhotos.photoId, p('cursorId')), eq(photos.id, albumPhotos.photoId), isNull(photos.deletedAt)))
    .orderBy(desc(albumPhotos.photoId))
    .limit(p('limit'))
    .prepare();

  private readonly userPhotos = this.db
    .select({
      ...listCols,
      isFavorite: sql<number>`${favorites.photoId} IS NOT NULL`.as('is_favorite'),
      isSaved: sql<number>`${saves.photoId} IS NOT NULL`.as('is_saved'),
    })
    .from(albumPhotos)
    .crossJoin(photos)
    .leftJoin(favorites, and(eq(favorites.userId, p('uid')), eq(favorites.photoId, albumPhotos.photoId)))
    .leftJoin(saves, and(eq(saves.userId, p('uid')), eq(saves.photoId, albumPhotos.photoId)))
    .where(and(eq(albumPhotos.albumId, p('albumId')), lt(albumPhotos.photoId, p('cursorId')), eq(photos.id, albumPhotos.photoId), isNull(photos.deletedAt)))
    .orderBy(desc(albumPhotos.photoId))
    .limit(p('limit'))
    .prepare();

  /* ---------- reads ---------- */

  /** Every album the caller may see, newest first. Album counts are small, so no pagination. */
  list(user: AuthUser | null): AlbumDto[] {
    const rows = this.db
      .select()
      .from(albums)
      .where(canManageAlbums(user) ? undefined : eq(albums.hidden, false))
      .orderBy(desc(albums.id))
      .all();
    return this.toDtos(rows);
  }

  /** By slug. Hidden albums 404 for anyone who can't manage albums. */
  getBySlug(slug: string, user: AuthUser | null): AlbumDto {
    return this.toDtos([this.findVisible(slug, user)])[0];
  }

  listPhotos(slug: string, user: AuthUser | null, limit: number, cursor?: string): PhotoListDto {
    const album = this.findVisible(slug, user);
    const c = decodeIdCursor(cursor, 'b');
    const params = { albumId: album.id, cursorId: c?.id ?? MAX_KEY, limit: limit + 1 };
    const rows: PhotoListRow[] = user ? this.userPhotos.all({ ...params, uid: user.id }) : this.guestPhotos.all(params);
    return toPage(rows, limit, (r) => encodeCursor('b', { id: r.id }), (r) => toPhotoDto(r, { withFlags: !!user }));
  }

  /** The albums a photo is in (photo detail); hidden ones only for album managers. */
  albumsOf(photoId: number, user: AuthUser | null): AlbumRefDto[] {
    return this.db
      .select({ id: albums.id, slug: albums.slug, name: albums.name })
      .from(albumPhotos)
      .innerJoin(albums, eq(albums.id, albumPhotos.albumId))
      .where(and(eq(albumPhotos.photoId, photoId), canManageAlbums(user) ? undefined : eq(albums.hidden, false)))
      .orderBy(albums.name)
      .all();
  }

  /** Raw row for Open Graph tags on a shared `/albums/:slug` link (guests' view). */
  findPublicForShare(slug: string): AlbumDto | undefined {
    const row = this.db.select().from(albums).where(eq(albums.slug, slug)).get();
    return row && !row.hidden ? this.toDtos([row])[0] : undefined;
  }

  /* ---------- writes (albums.manage) ---------- */

  create(user: AuthUser, dto: CreateAlbumDto): AlbumDto {
    const slug = dto.slug ?? this.uniqueSlug(slugify(dto.name));
    this.assertSlugFree(slug);
    const id = this.db.transaction((tx) => {
      const row = tx
        .insert(albums)
        .values({ slug, name: dto.name, description: dto.description || null, hidden: dto.hidden ?? false, createdBy: user.id })
        .returning({ id: albums.id })
        .get();
      if (dto.photoIds?.length) this.insertPhotos(tx, row.id, dto.photoIds, user.id);
      return row.id;
    });
    const album = this.byId(id);
    this.emit(user, album, `created${album.hidden ? ' (hidden)' : ''} with ${album.photoCount} photo(s)`);
    return album;
  }

  update(user: AuthUser, id: number, dto: UpdateAlbumDto): AlbumDto {
    const row = this.findRow(id);
    const patch: Partial<typeof albums.$inferInsert> = {};
    if (dto.name !== undefined) patch.name = dto.name;
    if (dto.description !== undefined) patch.description = dto.description || null;
    if (dto.hidden !== undefined) patch.hidden = dto.hidden;
    if (dto.slug !== undefined && dto.slug !== row.slug) {
      this.assertSlugFree(dto.slug);
      patch.slug = dto.slug;
    }
    if (dto.coverPhotoId !== undefined) {
      if (dto.coverPhotoId !== null && !this.contains(id, dto.coverPhotoId)) {
        throw new BadRequestException('The cover must be an active photo in this album');
      }
      patch.coverPhotoId = dto.coverPhotoId;
    }
    if (Object.keys(patch).length) this.db.update(albums).set({ ...patch, updatedAt: new Date() }).where(eq(albums.id, id)).run();
    const changes = Object.keys(patch).map((k) => (k === 'hidden' ? (patch.hidden ? 'hidden' : 'published') : k === 'coverPhotoId' ? 'cover' : k));
    if (changes.length) this.emit(user, this.byId(id), `updated ${changes.join(', ')}`);
    return this.byId(id);
  }

  remove(user: AuthUser, id: number) {
    const row = this.findRow(id);
    this.db.delete(albums).where(eq(albums.id, id)).run(); // album_photos cascade; photos are untouched
    this.events.emit(AppEvents.AlbumChanged, { actor: user, album: row.name, change: 'deleted (photos kept)' });
  }

  addPhotos(user: AuthUser, id: number, photoIds: number[]): AlbumPhotosResultDto {
    this.findRow(id);
    const changed = this.db.transaction((tx) => this.insertPhotos(tx, id, photoIds, user.id));
    if (changed) this.touch(id);
    const album = this.byId(id);
    if (changed) this.emit(user, album, `added ${changed} photo(s), now ${album.photoCount}`);
    return { changed, album };
  }

  removePhotos(user: AuthUser, id: number, photoIds: number[]): AlbumPhotosResultDto {
    this.findRow(id);
    const ids = [...new Set(photoIds)];
    const changed = this.db
      .delete(albumPhotos)
      .where(and(eq(albumPhotos.albumId, id), inArray(albumPhotos.photoId, ids)))
      .run().changes;
    if (changed) {
      // A removed explicit cover falls back to automatic.
      this.db.update(albums).set({ coverPhotoId: null }).where(and(eq(albums.id, id), inArray(albums.coverPhotoId, ids))).run();
      this.touch(id);
    }
    const album = this.byId(id);
    if (changed) this.emit(user, album, `removed ${changed} photo(s), now ${album.photoCount}`);
    return { changed, album };
  }

  /* ---------- helpers ---------- */

  /** Inserts the active photos among `photoIds` (missing / trashed ones are skipped). Returns how many were new. */
  private insertPhotos(tx: Pick<Db, 'run'>, albumId: number, photoIds: number[], userId: number): number {
    const ids = [...new Set(photoIds)];
    let changed = 0;
    // Stay well under SQLite's bound-parameter limit.
    for (let i = 0; i < ids.length; i += 500) {
      const chunk = ids.slice(i, i + 500);
      changed += tx.run(sql`
        INSERT INTO album_photos (album_id, photo_id, added_by)
        SELECT ${albumId}, id, ${userId} FROM photos WHERE id IN (${sql.join(chunk.map((x) => sql`${x}`), sql`, `)}) AND deleted_at IS NULL
        ON CONFLICT DO NOTHING`).changes;
    }
    return changed;
  }

  private contains(albumId: number, photoId: number): boolean {
    return !!this.db
      .select({ id: photos.id })
      .from(albumPhotos)
      .innerJoin(photos, and(eq(photos.id, albumPhotos.photoId), isNull(photos.deletedAt)))
      .where(and(eq(albumPhotos.albumId, albumId), eq(albumPhotos.photoId, photoId)))
      .get();
  }

  private touch(id: number) {
    this.db.update(albums).set({ updatedAt: new Date() }).where(eq(albums.id, id)).run();
  }

  private emit(user: AuthUser, album: AlbumDto, change: string) {
    this.events.emit(AppEvents.AlbumChanged, { actor: user, album: album.name, change });
  }

  private findRow(id: number): Album {
    const row = this.db.select().from(albums).where(eq(albums.id, id)).get();
    if (!row) throw new NotFoundException('Album not found');
    return row;
  }

  private findVisible(slug: string, user: AuthUser | null): Album {
    const row = this.db.select().from(albums).where(eq(albums.slug, slug)).get();
    if (!row || (row.hidden && !canManageAlbums(user))) throw new NotFoundException('Album not found');
    return row;
  }

  private byId(id: number): AlbumDto {
    return this.toDtos([this.findRow(id)])[0];
  }

  private assertSlugFree(slug: string) {
    if (this.db.select({ id: albums.id }).from(albums).where(eq(albums.slug, slug)).get()) {
      throw new ConflictException(`An album already uses the link name "${slug}"`);
    }
  }

  private uniqueSlug(base: string): string {
    const taken = new Set(
      this.db
        .select({ slug: albums.slug })
        .from(albums)
        .where(sql`${albums.slug} = ${base} OR ${albums.slug} LIKE ${`${base}-%`}`)
        .all()
        .map((r) => r.slug),
    );
    if (!taken.has(base)) return base;
    for (let n = 2; ; n++) if (!taken.has(`${base}-${n}`)) return `${base}-${n}`;
  }

  /** Adds photo counts and covers (two small queries for the whole list, not one per album). */
  private toDtos(rows: Album[]): AlbumDto[] {
    if (!rows.length) return [];
    const ids = rows.map((r) => r.id);
    const stats = this.db.all<AlbumStatsRow>(sql`
      SELECT a.id,
             (SELECT count(*) FROM album_photos ap JOIN photos p ON p.id = ap.photo_id AND p.deleted_at IS NULL
               WHERE ap.album_id = a.id) AS photo_count,
             COALESCE(
               (SELECT p.id FROM album_photos ap JOIN photos p ON p.id = ap.photo_id AND p.deleted_at IS NULL
                 WHERE ap.album_id = a.id AND ap.photo_id = a.cover_photo_id),
               (SELECT max(ap.photo_id) FROM album_photos ap JOIN photos p ON p.id = ap.photo_id AND p.deleted_at IS NULL
                 WHERE ap.album_id = a.id)
             ) AS cover_id
      FROM albums a WHERE a.id IN (${sql.join(ids.map((x) => sql`${x}`), sql`, `)})`);
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
    return rows.map((r) => {
      const s = byId.get(r.id);
      const c = s?.cover_id ? covers.get(s.cover_id) : undefined;
      return {
        id: r.id,
        slug: r.slug,
        name: r.name,
        description: r.description,
        hidden: r.hidden,
        photoCount: s?.photo_count ?? 0,
        coverPhotoId: r.coverPhotoId,
        cover: c
          ? {
              id: c.id,
              thumbUrl: `/uploads/thumbs/${c.thumbFilename}`,
              previewUrl: c.previewFilename ? `/uploads/previews/${c.previewFilename}` : `/uploads/${c.filename}`,
              width: c.width,
              height: c.height,
            }
          : null,
        createdAt: toIso(r.createdAt),
        updatedAt: toIso(r.updatedAt),
      };
    });
  }
}
