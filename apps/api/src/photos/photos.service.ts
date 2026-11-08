import { Inject, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { count, eq, isNull } from 'drizzle-orm';
import { DRIZZLE } from '../db/db.module';
import type { Db } from '../db/client';
import { photos } from '../db/schema';
import { decodeIdCursor, decodeTimeIdCursor, encodeCursor } from '../common/cursor';
import { PhotoDto, PhotoListDto, PhotoListRow, toPhotoDto } from '../common/photo.dto';
import type { AuthUser } from '../auth/decorators/current-user.decorator';
import { AppEvents } from '../alerts/events';
import { AdminStatus, PhotosRepository } from './photos.repository';
import { StorageService } from './storage.service';
import { PhotoCacheService } from './photo-cache.service';
import type { UpdatePhotoDto } from './dto/photo-input.dto';

const toSeconds = (v: Date | number) => (v instanceof Date ? Math.floor(v.getTime() / 1000) : v);

@Injectable()
export class PhotosService {
  private readonly logger = new Logger(PhotosService.name);

  constructor(
    @Inject(DRIZZLE) private readonly db: Db,
    private readonly repo: PhotosRepository,
    private readonly storage: StorageService,
    private readonly cache: PhotoCacheService,
    private readonly events: EventEmitter2,
  ) {}

  /** Trims the `limit + 1` probe row and builds `{ items, nextCursor, hasMore }`. */
  private page<R extends PhotoListRow>(rows: R[], limit: number, cursorFor: (last: R) => string, dto: (r: R) => PhotoDto): PhotoListDto {
    const hasMore = rows.length > limit;
    const pageRows = hasMore ? rows.slice(0, limit) : rows;
    return {
      items: pageRows.map(dto),
      nextCursor: hasMore ? cursorFor(pageRows[pageRows.length - 1]) : null,
      hasMore,
    };
  }

  async listPublic(user: AuthUser | null, limit: number, cursor?: string): Promise<PhotoListDto> {
    const c = decodeIdCursor(cursor, 'p');
    if (!user) {
      const cached = await this.cache.get(limit, cursor);
      if (cached) return cached;
    }
    const rows = this.repo.listPublic(user?.id ?? null, c?.id ?? null, limit + 1);
    const result = this.page(rows, limit, (r) => encodeCursor('p', { id: r.id }), (r) => toPhotoDto(r, { withFlags: !!user }));
    if (!user) await this.cache.set(limit, cursor, result);
    return result;
  }

  listAdmin(user: AuthUser, status: AdminStatus, limit: number, cursor?: string): PhotoListDto {
    const c = decodeIdCursor(cursor, 'a');
    const rows = this.repo.listAdmin(status, user.id, c?.id ?? null, limit + 1);
    return this.page(rows, limit, (r) => encodeCursor('a', { id: r.id }), (r) => toPhotoDto(r, { withFlags: true, admin: true }));
  }

  listCollection(kind: 'favorites' | 'saves', user: AuthUser, limit: number, cursor?: string): PhotoListDto {
    const tag = kind === 'favorites' ? 'f' : 's';
    const c = decodeTimeIdCursor(cursor, tag);
    const rows = this.repo.listCollection(kind, user.id, c, limit + 1);
    return this.page(
      rows,
      limit,
      (r) => encodeCursor(tag, { t: toSeconds(r.listedAt), id: r.id }),
      (r) => toPhotoDto(r, { withFlags: true }),
    );
  }

  getOne(id: number, user: AuthUser | null): PhotoDto {
    const row = this.repo.findById(id, user?.id ?? null);
    const isAdmin = user?.role === 'admin';
    if (!row || (row.deletedAt && !isAdmin)) throw new NotFoundException('Photo not found');
    return toPhotoDto(row, { withFlags: !!user, admin: isAdmin });
  }

  /** Throws 404 unless the photo exists and is active. */
  assertActive(id: number) {
    const row = this.db.select({ deletedAt: photos.deletedAt }).from(photos).where(eq(photos.id, id)).get();
    if (!row || row.deletedAt) throw new NotFoundException('Photo not found');
  }

  private findRaw(id: number) {
    const row = this.db.select().from(photos).where(eq(photos.id, id)).get();
    if (!row) throw new NotFoundException('Photo not found');
    return row;
  }

  async upload(user: AuthUser, files: Express.Multer.File[], meta: UpdatePhotoDto): Promise<PhotoDto[]> {
    const stored = await this.storage.storeUploads(files);
    let ids: number[];
    try {
      ids = this.db.transaction((tx) =>
        stored.map(
          (s) =>
            tx
              .insert(photos)
              .values({ ...s, title: meta.title || null, caption: meta.caption || null, uploadedBy: user.id })
              .returning({ id: photos.id })
              .get().id,
        ),
      );
    } catch (err) {
      await Promise.all(stored.map((s) => this.storage.unlinkAll(s.filename, s.thumbFilename).catch(() => undefined)));
      throw err;
    }
    this.cache.bump();
    this.events.emit(AppEvents.PhotosUploaded, {
      actor: user,
      photoIds: ids,
      totalBytes: stored.reduce((n, s) => n + s.sizeBytes, 0),
    });
    return ids.map((id) => this.getOne(id, user));
  }

  update(user: AuthUser, id: number, dto: UpdatePhotoDto): PhotoDto {
    this.findRaw(id);
    const patch: Partial<typeof photos.$inferInsert> = {};
    if (dto.title !== undefined) patch.title = dto.title || null;
    if (dto.caption !== undefined) patch.caption = dto.caption || null;
    if (Object.keys(patch).length) this.db.update(photos).set(patch).where(eq(photos.id, id)).run();
    this.cache.bump();
    this.events.emit(AppEvents.PhotoUpdated, { actor: user, photoId: id });
    return this.getOne(id, user);
  }

  async softDelete(user: AuthUser, id: number): Promise<PhotoDto> {
    const row = this.findRaw(id);
    if (!row.deletedAt) {
      await this.storage.moveFiles(row.filename, row.thumbFilename, 'trash');
      try {
        this.db.update(photos).set({ deletedAt: new Date() }).where(eq(photos.id, id)).run();
      } catch (err) {
        await this.storage.moveFiles(row.filename, row.thumbFilename, 'live');
        throw err;
      }
      this.cache.bump();
      this.events.emit(AppEvents.PhotoSoftDeleted, { actor: user, photoId: id, title: row.title });
    }
    return this.getOne(id, user);
  }

  async restore(user: AuthUser, id: number): Promise<PhotoDto> {
    const row = this.findRaw(id);
    if (row.deletedAt) {
      await this.storage.moveFiles(row.filename, row.thumbFilename, 'live');
      try {
        this.db.update(photos).set({ deletedAt: null }).where(eq(photos.id, id)).run();
      } catch (err) {
        await this.storage.moveFiles(row.filename, row.thumbFilename, 'trash');
        throw err;
      }
      this.cache.bump();
      this.events.emit(AppEvents.PhotoRestored, { actor: user, photoId: id, title: row.title });
    }
    return this.getOne(id, user);
  }

  async hardDelete(user: AuthUser, id: number): Promise<void> {
    const row = this.findRaw(id);
    this.db.delete(photos).where(eq(photos.id, id)).run(); // favorites/saves cascade
    this.cache.bump();
    try {
      await this.storage.unlinkAll(row.filename, row.thumbFilename);
    } catch (err) {
      // Orphaned files are tolerable, dangling rows are not (spec 6.4).
      this.logger.error(`Hard delete of photo ${id}: file unlink failed: ${(err as Error).message}`);
    }
    this.events.emit(AppEvents.PhotoHardDeleted, { actor: user, photoId: id, title: row.title });
  }

  /** Startup stat only — never on a request path. */
  countActive(): number {
    return this.db.select({ n: count() }).from(photos).where(isNull(photos.deletedAt)).get()?.n ?? 0;
  }
}
