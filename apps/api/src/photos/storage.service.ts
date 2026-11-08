import { BadRequestException, Inject, Injectable, Logger } from '@nestjs/common';
import { randomUUID } from 'crypto';
import { existsSync, promises as fs, mkdirSync } from 'fs';
import { join, resolve } from 'path';
import sharp from 'sharp';
import pLimit from 'p-limit';
import FileType from 'file-type';
import exifReader from 'exif-reader';
import { shareCardPath } from '../share/share-card';
import { APP_CONFIG, AppConfig } from '../config/env';

export const ALLOWED_TYPES: Record<string, string> = {
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/webp': 'webp',
};
export const THUMB_WIDTH = 600;
/** Long edge of the viewer image. ~5x smaller than a 20 MP original, sharp on 1440p screens. */
export const PREVIEW_EDGE = 2048;
export const ROTATIONS = [0, 90, 180, 270] as const;
export type Rotation = (typeof ROTATIONS)[number];

/** Photographic EXIF fields we keep. GPS and serial numbers are deliberately dropped. */
export interface PhotoExif {
  make?: string;
  model?: string;
  lens?: string;
  focalLength?: number;
  fNumber?: number;
  exposureTime?: number;
  iso?: number;
  exposureBias?: number;
  flash?: boolean;
  /** Local capture time with its UTC offset when known, e.g. 2026-11-06T16:44:27+07:00 */
  takenAt?: string;
  software?: string;
}

export interface Derivatives {
  thumbFilename: string;
  previewFilename: string;
  width: number;
  height: number;
}

export interface ProcessedImage extends Derivatives {
  filename: string;
  mimeType: string;
  sizeBytes: number;
  originalName: string | null;
  exif: string | null;
}

/** The files that make up one photo, relative to the uploads root (or `.trash`). */
export interface PhotoFiles {
  filename: string;
  thumbFilename: string;
  previewFilename?: string | null;
}

const str = (v: unknown) => (typeof v === 'string' && v.trim() ? v.trim().replace(/\0/g, '') : undefined);
const num = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) ? Math.round(v * 1e6) / 1e6 : undefined);

/** exif-reader returns local wall-clock times as if they were UTC; re-attach the real offset. */
function localTime(d: unknown, offset: unknown): string | undefined {
  if (!(d instanceof Date) || Number.isNaN(d.getTime())) return undefined;
  const wall = d.toISOString().slice(0, 19);
  return typeof offset === 'string' && /^[+-]\d{2}:\d{2}$/.test(offset) ? `${wall}${offset}` : wall;
}

export function parseExif(buf: Buffer | undefined): PhotoExif | null {
  if (!buf) return null;
  try {
    const t = exifReader(buf) as { Image?: Record<string, unknown>; Photo?: Record<string, unknown> };
    const img = t.Image ?? {};
    const ph = t.Photo ?? {};
    const out: PhotoExif = {
      make: str(img.Make),
      model: str(img.Model),
      lens: str(ph.LensModel),
      focalLength: num(ph.FocalLength),
      fNumber: num(ph.FNumber),
      exposureTime: num(ph.ExposureTime),
      iso: num(ph.ISOSpeedRatings) ?? num(ph.PhotographicSensitivity),
      exposureBias: num(ph.ExposureBiasValue),
      flash: typeof ph.Flash === 'number' ? (ph.Flash & 1) === 1 : undefined,
      takenAt: localTime(ph.DateTimeOriginal ?? img.DateTime, ph.OffsetTimeOriginal ?? ph.OffsetTime),
      software: str(img.Software),
    };
    for (const k of Object.keys(out) as (keyof PhotoExif)[]) if (out[k] === undefined) delete out[k];
    return Object.keys(out).length ? out : null;
  } catch {
    return null;
  }
}

/** Keeps a client-supplied file name printable and short (it ends up in CSV exports). */
export function cleanOriginalName(name: string | undefined | null): string | null {
  if (!name) return null;
  // multer decodes multipart names as latin1; recover UTF-8 names (e.g. Khmer) when that's what they were.
  let n = name;
  const utf8 = Buffer.from(name, 'latin1').toString('utf8');
  if (!utf8.includes('�') && utf8 !== name) n = utf8;
  n = n.split(/[\\/]/).pop()!.replace(/[\u0000-\u001f\u007f]/g, '').trim();
  return n ? n.slice(0, 255) : null;
}

/**
 * Disk layout: uploads/<original>, uploads/thumbs/<thumb>, uploads/previews/<preview>,
 * uploads/.trash/{,thumbs/,previews/}, uploads/.tmp/, uploads/og/ (share-card cache).
 */
export class PhotoStorage {
  readonly root: string;
  readonly thumbs: string;
  readonly previews: string;
  readonly trash: string;
  readonly trashThumbs: string;
  readonly trashPreviews: string;
  readonly tmp: string;
  readonly og: string;

  constructor(uploadDir: string) {
    this.root = resolve(uploadDir);
    this.thumbs = join(this.root, 'thumbs');
    this.previews = join(this.root, 'previews');
    this.trash = join(this.root, '.trash');
    this.trashThumbs = join(this.trash, 'thumbs');
    this.trashPreviews = join(this.trash, 'previews');
    this.tmp = join(this.root, '.tmp');
    this.og = join(this.root, '.og');
    for (const d of [this.root, this.thumbs, this.previews, this.trash, this.trashThumbs, this.trashPreviews, this.tmp, this.og]) {
      mkdirSync(d, { recursive: true });
    }
  }

  /** Detects the real type from magic bytes; returns the MIME type or null if not allowed. */
  async sniff(path: string): Promise<string | null> {
    const ft = await FileType.fromFile(path).catch(() => undefined);
    return ft && ALLOWED_TYPES[ft.mime] ? ft.mime : null;
  }

  /** Path of the original, whether the photo is live or in trash. */
  originalPath(filename: string): string {
    const live = join(this.root, filename);
    return existsSync(live) ? live : join(this.trash, filename);
  }

  /**
   * Writes a new thumbnail and preview (fresh random names, so the immutable HTTP cache never serves
   * a stale rotation) from the original: EXIF orientation first, then the admin `rotation`.
   * Returns the displayed width/height. Metadata is stripped from both.
   */
  async renderDerivatives(src: string, rotation: number, intoTrash = false): Promise<Derivatives> {
    const id = randomUUID();
    const thumbFilename = `${id}.webp`;
    const previewFilename = `${id}.webp`;
    const thumbPath = join(intoTrash ? this.trashThumbs : this.thumbs, thumbFilename);
    const previewPath = join(intoTrash ? this.trashPreviews : this.previews, previewFilename);
    try {
      const base = sharp(src, { sequentialRead: true }).autoOrient();
      if (rotation) base.rotate(rotation);
      await Promise.all([
        base.clone().resize({ width: THUMB_WIDTH, withoutEnlargement: true }).webp({ quality: 75 }).toFile(thumbPath),
        base
          .clone()
          .resize({ width: PREVIEW_EDGE, height: PREVIEW_EDGE, fit: 'inside', withoutEnlargement: true })
          .webp({ quality: 82, smartSubsample: true })
          .toFile(previewPath),
      ]);
      const meta = await sharp(src).metadata();
      const oriented = (meta.orientation ?? 1) >= 5;
      let width = oriented ? meta.height! : meta.width!;
      let height = oriented ? meta.width! : meta.height!;
      if (rotation === 90 || rotation === 270) [width, height] = [height, width];
      return { thumbFilename, previewFilename, width, height };
    } catch (err) {
      await this.removeQuietly([thumbPath, previewPath]);
      throw err;
    }
  }

  /** Preview only (backfill of photos stored before previews existed); keeps the existing thumbnail. */
  async renderPreview(src: string, rotation: number, intoTrash = false): Promise<string> {
    const previewFilename = `${randomUUID()}.webp`;
    const previewPath = join(intoTrash ? this.trashPreviews : this.previews, previewFilename);
    const img = sharp(src, { sequentialRead: true }).autoOrient();
    if (rotation) img.rotate(rotation);
    await img
      .resize({ width: PREVIEW_EDGE, height: PREVIEW_EDGE, fit: 'inside', withoutEnlargement: true })
      .webp({ quality: 82, smartSubsample: true })
      .toFile(previewPath)
      .catch(async (err) => {
        await this.removeQuietly([previewPath]);
        throw err;
      });
    return previewFilename;
  }

  /**
   * Validates and stores one image: renders the thumbnail and preview, reads EXIF and places the
   * original under a random name. `mode: 'move'` renames the source (uploads), `'link'` hard-links
   * it (bulk import, falls back to copy).
   */
  async store(src: string, mode: 'move' | 'link', originalName?: string | null): Promise<ProcessedImage> {
    const mimeType = await this.sniff(src);
    if (!mimeType) throw new BadRequestException('Unsupported or invalid image file');
    const filename = `${randomUUID()}.${ALLOWED_TYPES[mimeType]}`;
    const dest = join(this.root, filename);
    let derived: Derivatives | undefined;
    try {
      const meta = await sharp(src).metadata();
      if (!meta.width || !meta.height) throw new Error('missing dimensions');
      derived = await this.renderDerivatives(src, 0);
      if (mode === 'move') await fs.rename(src, dest);
      else await fs.link(src, dest).catch(() => fs.copyFile(src, dest));
      const { size } = await fs.stat(dest);
      const exif = parseExif(meta.exif);
      return {
        filename,
        mimeType,
        sizeBytes: size,
        originalName: cleanOriginalName(originalName),
        exif: exif ? JSON.stringify(exif) : null,
        ...derived,
      };
    } catch (err) {
      await this.removeQuietly(derived ? [dest, join(this.thumbs, derived.thumbFilename), join(this.previews, derived.previewFilename)] : [dest]);
      if (err instanceof BadRequestException) throw err;
      throw new BadRequestException('Unsupported or invalid image file');
    }
  }

  async removeQuietly(paths: string[]) {
    await Promise.all(paths.map((p) => fs.rm(p, { force: true }).catch(() => undefined)));
  }

  /** Live and trashed paths of a photo's files, in matching order. */
  paths(f: PhotoFiles) {
    const live = [join(this.root, f.filename), join(this.thumbs, f.thumbFilename)];
    const trashed = [join(this.trash, f.filename), join(this.trashThumbs, f.thumbFilename)];
    if (f.previewFilename) {
      live.push(join(this.previews, f.previewFilename));
      trashed.push(join(this.trashPreviews, f.previewFilename));
    }
    return { live, trashed };
  }

  /** Move a photo's files into/out of `.trash`. Missing files (e.g. synthetic bulk rows) are ignored. */
  async moveFiles(f: PhotoFiles, to: 'trash' | 'live') {
    const { live, trashed } = this.paths(f);
    const [from, dest] = to === 'trash' ? [live, trashed] : [trashed, live];
    for (let i = 0; i < from.length; i++) {
      await fs.rename(from[i], dest[i]).catch((err: NodeJS.ErrnoException) => {
        if (err.code !== 'ENOENT') throw err;
      });
    }
  }

  async unlinkAll(f: PhotoFiles) {
    const { live, trashed } = this.paths(f);
    const results = await Promise.allSettled(
      [...live, ...trashed].map((p) =>
        fs.unlink(p).catch((err: NodeJS.ErrnoException) => {
          if (err.code !== 'ENOENT') throw err;
        }),
      ),
    );
    const failed = results.find((r): r is PromiseRejectedResult => r.status === 'rejected');
    if (failed) throw failed.reason;
  }

  /** Removes only the derived files (thumb + preview) of an old rendering, live or trashed. */
  async unlinkDerivatives(thumbFilename: string, previewFilename: string | null | undefined) {
    const paths = [join(this.thumbs, thumbFilename), join(this.trashThumbs, thumbFilename)];
    if (previewFilename) paths.push(join(this.previews, previewFilename), join(this.trashPreviews, previewFilename));
    await this.removeQuietly(paths);
  }
}

@Injectable()
export class StorageService extends PhotoStorage {
  private readonly logger = new Logger(StorageService.name);
  // Bounds image work so a 20-file upload can't starve list requests (spec 6.7.4).
  private readonly limit = pLimit(2);

  constructor(@Inject(APP_CONFIG) config: AppConfig) {
    super(config.uploadDir);
    sharp.concurrency(2);
  }

  /** All-or-nothing: if any file is invalid, every stored file and temp file is removed. */
  async storeUploads(files: Express.Multer.File[]): Promise<ProcessedImage[]> {
    const results = await Promise.allSettled(files.map((f) => this.limit(() => this.store(f.path, 'move', f.originalname))));
    const failed = results.find((r): r is PromiseRejectedResult => r.status === 'rejected');
    if (failed) {
      const stored = results.filter((r): r is PromiseFulfilledResult<ProcessedImage> => r.status === 'fulfilled');
      await Promise.all(stored.map((r) => this.unlinkAll(r.value).catch(() => undefined)));
      await this.removeQuietly(files.map((f) => f.path));
      const idx = results.indexOf(failed);
      throw new BadRequestException(`File "${files[idx]?.originalname ?? idx}" is not a valid JPEG, PNG or WebP image`);
    }
    return results.map((r) => (r as PromiseFulfilledResult<ProcessedImage>).value);
  }

  /** Re-renders thumbnail + preview with a new rotation, through the same concurrency limit. */
  rerender(filename: string, rotation: number, intoTrash: boolean) {
    return this.limit(() => this.renderDerivatives(this.originalPath(filename), rotation, intoTrash));
  }

  /** og:image for a photo, rendered once per rendering (`key` = preview/thumb name) and cached on disk. */
  shareCard(key: string, src: string, label: string) {
    return this.limit(() => shareCardPath(this.og, key, src, label));
  }

  logWarn(msg: string) {
    this.logger.warn(msg);
  }
}
