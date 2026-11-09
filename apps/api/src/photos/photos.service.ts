import { Inject, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { and, count, eq, inArray, isNull } from 'drizzle-orm';
import { DRIZZLE } from '../db/db.module';
import type { Db } from '../db/client';
import { photos } from '../db/schema';
import { decodeIdCursor, decodeTimeIdCursor, encodeCursor } from '../common/cursor';
import { PhotoDto, PhotoListDto, PhotoListRow, toPage, toPhotoDto } from '../common/photo.dto';
import type { AuthUser } from '../auth/decorators/current-user.decorator';
import { hasPermission } from '../auth/permissions';
import { AppEvents, type PhotosBatchEvent } from '../alerts/events';
import { BatchResultDto, chunks } from '../common/batch.dto';
import { AdminStatus, PhotosRepository } from './photos.repository';
import { StorageService } from './storage.service';
import { PhotoCacheService } from './photo-cache.service';
import type { UpdatePhotoDto } from './dto/photo-input.dto';
import { join } from 'path';
import { existsSync } from 'fs';

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

  private page<R extends PhotoListRow>(rows: R[], limit: number, cursorFor: (last: R) => string, dto: (r: R) => PhotoDto): PhotoListDto {
    return toPage(rows, limit, cursorFor, dto);
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
    // Whoever manages the trash can open trashed photos; any photo manager sees the admin fields.
    const seesTrash = hasPermission(user, 'photos.delete');
    if (!row || (row.deletedAt && !seesTrash)) throw new NotFoundException('Photo not found');
    return toPhotoDto(row, { withFlags: !!user, admin: seesTrash || hasPermission(user, 'photos.export') || hasPermission(user, 'photos.edit'), detail: true });
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
      await Promise.all(stored.map((s) => this.storage.unlinkAll(s).catch(() => undefined)));
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
    if (await this.trashRow(row)) {
      this.cache.bump();
      this.events.emit(AppEvents.PhotoSoftDeleted, { actor: user, photoId: id, title: row.title });
    }
    return this.getOne(id, user);
  }

  async restore(user: AuthUser, id: number): Promise<PhotoDto> {
    const row = this.findRaw(id);
    if (await this.restoreRow(row)) {
      this.cache.bump();
      this.events.emit(AppEvents.PhotoRestored, { actor: user, photoId: id, title: row.title });
    }
    return this.getOne(id, user);
  }

  async hardDelete(user: AuthUser, id: number): Promise<void> {
    const row = this.findRaw(id);
    await this.purgeRow(row);
    this.cache.bump();
    this.events.emit(AppEvents.PhotoHardDeleted, { actor: user, photoId: id, title: row.title });
  }

  /* ---------- batches (the selection bar) ---------- */

  /** Sets the title and/or caption of several photos (empty string clears). */
  editMany(user: AuthUser, ids: number[], dto: UpdatePhotoDto): BatchResultDto {
    const patch: Partial<typeof photos.$inferInsert> = {};
    if (dto.title !== undefined) patch.title = dto.title || null;
    if (dto.caption !== undefined) patch.caption = dto.caption || null;
    if (!Object.keys(patch).length) return { changed: 0 };
    const changed = this.db.transaction((tx) =>
      chunks([...new Set(ids)]).reduce((n, chunk) => n + tx.update(photos).set(patch).where(inArray(photos.id, chunk)).run().changes, 0),
    );
    if (changed) this.batchDone(user, 'edited', [...new Set(ids)]);
    return { changed };
  }

  trashMany(user: AuthUser, ids: number[]) {
    return this.eachRow(user, ids, 'trashed', (row) => this.trashRow(row));
  }

  restoreMany(user: AuthUser, ids: number[]) {
    return this.eachRow(user, ids, 'restored', (row) => this.restoreRow(row));
  }

  purgeMany(user: AuthUser, ids: number[]) {
    return this.eachRow(user, ids, 'purged', async (row) => (await this.purgeRow(row), true));
  }

  /** Runs `fn` on each existing photo in turn (they move files, so not in parallel); one alert at the end. */
  private async eachRow(
    user: AuthUser,
    ids: number[],
    action: PhotosBatchEvent['action'],
    fn: (row: typeof photos.$inferSelect) => Promise<boolean>,
  ): Promise<BatchResultDto> {
    const done: number[] = [];
    for (const chunk of chunks([...new Set(ids)])) {
      for (const row of this.db.select().from(photos).where(inArray(photos.id, chunk)).all()) {
        if (await fn(row)) done.push(row.id);
      }
    }
    if (done.length) this.batchDone(user, action, done);
    return { changed: done.length };
  }

  private batchDone(user: AuthUser, action: PhotosBatchEvent['action'], photoIds: number[]) {
    this.cache.bump();
    this.events.emit(AppEvents.PhotosBatch, { actor: user, action, photoIds });
  }

  /** Moves an active photo's files to trash and marks it deleted. False if it already was. */
  private async trashRow(row: typeof photos.$inferSelect): Promise<boolean> {
    if (row.deletedAt) return false;
    await this.storage.moveFiles(row, 'trash');
    try {
      this.db.update(photos).set({ deletedAt: new Date() }).where(eq(photos.id, row.id)).run();
    } catch (err) {
      await this.storage.moveFiles(row, 'live');
      throw err;
    }
    return true;
  }

  private async restoreRow(row: typeof photos.$inferSelect): Promise<boolean> {
    if (!row.deletedAt) return false;
    await this.storage.moveFiles(row, 'live');
    try {
      this.db.update(photos).set({ deletedAt: null }).where(eq(photos.id, row.id)).run();
    } catch (err) {
      await this.storage.moveFiles(row, 'trash');
      throw err;
    }
    return true;
  }

  private async purgeRow(row: typeof photos.$inferSelect): Promise<void> {
    this.db.delete(photos).where(eq(photos.id, row.id)).run(); // favorites/saves/album entries cascade
    try {
      await this.storage.unlinkAll(row);
    } catch (err) {
      // Orphaned files are tolerable, dangling rows are not (spec 6.4).
      this.logger.error(`Hard delete of photo ${row.id}: file unlink failed: ${(err as Error).message}`);
    }
  }

  /**
   * Active photos for a ZIP download, in the order asked, with their original file paths. Each is named
   * after the uploader's file (e.g. 361A8184.jpg), falling back to prewedding-<id>.<ext>; clashes (compared
   * case-insensitively, as on Windows and macOS) get " (2)", " (3)"... before the extension.
   */
  downloadable(ids: number[]): { id: number; path: string; name: string }[] {
    const unique = [...new Set(ids)];
    const rows = chunks(unique).flatMap((chunk) =>
      this.db
        .select({ id: photos.id, filename: photos.filename, originalName: photos.originalName })
        .from(photos)
        .where(and(inArray(photos.id, chunk), isNull(photos.deletedAt)))
        .all(),
    );
    const byId = new Map(rows.map((r) => [r.id, r]));
    const taken = new Set<string>();
    return unique
      .filter((id) => byId.has(id))
      .map((id) => {
        const { filename, originalName } = byId.get(id)!;
        const ext = filename.split('.').pop() ?? 'jpg';
        const name = uniqueName(zipEntryName(originalName, ext) ?? `prewedding-${id}.${ext}`, taken);
        return { id, path: this.storage.originalPath(filename), name };
      });
  }

  /**
   * Rotates the displayed image by `degrees` (clockwise, relative to the current rotation). The original
   * file is never modified: a new thumbnail and preview are rendered from it under new names (so every
   * cache picks them up), the row is updated, then the old renderings are removed.
   */
  async rotate(user: AuthUser, id: number, degrees: number): Promise<PhotoDto> {
    const row = this.findRaw(id);
    const rotation = await this.rotateRow(row, degrees);
    if (rotation !== row.rotation) {
      this.cache.bump();
      this.events.emit(AppEvents.PhotoRotated, { actor: user, photoId: id, title: row.title, rotation });
    }
    return this.getOne(id, user);
  }

  /**
   * Rotates several photos by the same `degrees`. Ids that don't exist (or are in trash, for someone who
   * can't see trash) are skipped. Renders go through the storage concurrency limit; one that fails is
   * reported in `failed` and leaves that photo as it was.
   */
  async rotateMany(user: AuthUser, ids: number[], degrees: number): Promise<{ photos: PhotoDto[]; failed: number[] }> {
    const unique = [...new Set(ids)];
    const seesTrash = hasPermission(user, 'photos.delete');
    const rows = this.db
      .select()
      .from(photos)
      .where(inArray(photos.id, unique))
      .all()
      .filter((r) => seesTrash || !r.deletedAt);
    const results = await Promise.allSettled(rows.map((r) => this.rotateRow(r, degrees)));
    const failed: number[] = [];
    results.forEach((r, i) => {
      if (r.status === 'rejected') {
        failed.push(rows[i].id);
        this.logger.error(`Rotate photo ${rows[i].id}: ${(r.reason as Error)?.message}`);
      }
    });
    const done = rows.filter((_, i) => results[i].status === 'fulfilled').map((r) => r.id);
    if (done.length) {
      this.cache.bump();
      this.events.emit(AppEvents.PhotosRotated, { actor: user, photoIds: done, degrees });
    }
    // Keep the order the caller asked for.
    const order = new Map(unique.map((id, i) => [id, i]));
    done.sort((a, b) => order.get(a)! - order.get(b)!);
    return { photos: done.map((id) => this.getOne(id, user)), failed };
  }

  /** Re-renders one photo at its new rotation and swaps the row over; returns the new rotation. */
  private async rotateRow(row: typeof photos.$inferSelect, degrees: number): Promise<number> {
    const rotation = (((row.rotation + degrees) % 360) + 360) % 360;
    if (rotation === row.rotation) return rotation;
    const next = await this.storage.rerender(row.filename, rotation, Boolean(row.deletedAt));
    try {
      this.db
        .update(photos)
        .set({ rotation, thumbFilename: next.thumbFilename, previewFilename: next.previewFilename, width: next.width, height: next.height })
        .where(eq(photos.id, row.id))
        .run();
    } catch (err) {
      await this.storage.unlinkDerivatives(next.thumbFilename, next.previewFilename);
      throw err;
    }
    await this.storage.unlinkDerivatives(row.thumbFilename, row.previewFilename);
    return rotation;
  }

  /** Path of the 1200x630 share card (og:image) of an active photo. */
  async shareCard(id: number, label: string): Promise<string> {
    const row = this.findRaw(id);
    if (row.deletedAt) throw new NotFoundException('Photo not found');
    const preview = row.previewFilename ? join(this.storage.previews, row.previewFilename) : null;
    const src = preview && existsSync(preview) ? preview : this.storage.originalPath(row.filename);
    if (!existsSync(src)) throw new NotFoundException('Photo file not found');
    // Without a preview the original is used with only EXIF orientation, so rotation must be part of the key.
    const key = row.previewFilename ?? `${row.thumbFilename}-r${row.rotation}`;
    return this.storage.shareCard(key, src, label);
  }

  /** Startup stat only — never on a request path. */
  countActive(): number {
    return this.db.select({ n: count() }).from(photos).where(isNull(photos.deletedAt)).get()?.n ?? 0;
  }
}

/** A safe ZIP entry name from the uploader's file name, with the stored extension when it has none. */
function zipEntryName(original: string | null, ext: string): string | null {
  const n = original
    ?.split(/[\\/]/)
    .pop()!
    .replace(/[\u0000-\u001f\u007f:*?"<>|]/g, '_')
    .trim()
    .replace(/^\.+/, '');
  if (!n) return null;
  return /\.[^.]+$/.test(n) ? n : `${n}.${ext}`;
}

/** `name`, or `name (2).ext`, `name (3).ext`... whichever isn't in `taken` yet; records the result. */
function uniqueName(name: string, taken: Set<string>): string {
  const dot = name.lastIndexOf('.');
  const [base, ext] = dot > 0 ? [name.slice(0, dot), name.slice(dot)] : [name, ''];
  let candidate = name;
  for (let i = 2; taken.has(candidate.toLowerCase()); i++) candidate = `${base} (${i})${ext}`;
  taken.add(candidate.toLowerCase());
  return candidate;
}
