import { BadRequestException, Inject, Injectable, Logger } from '@nestjs/common';
import { randomUUID } from 'crypto';
import { promises as fs, mkdirSync } from 'fs';
import { join, resolve } from 'path';
import sharp from 'sharp';
import pLimit from 'p-limit';
import FileType from 'file-type';
import { APP_CONFIG, AppConfig } from '../config/env';

export const ALLOWED_TYPES: Record<string, string> = {
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/webp': 'webp',
};
export const THUMB_WIDTH = 600;

export interface ProcessedImage {
  filename: string;
  thumbFilename: string;
  mimeType: string;
  sizeBytes: number;
  width: number;
  height: number;
}

/** Disk layout: uploads/<file>, uploads/thumbs/<thumb>, uploads/.trash/{,thumbs/}, uploads/.tmp/. */
export class PhotoStorage {
  readonly root: string;
  readonly thumbs: string;
  readonly trash: string;
  readonly trashThumbs: string;
  readonly tmp: string;

  constructor(uploadDir: string) {
    this.root = resolve(uploadDir);
    this.thumbs = join(this.root, 'thumbs');
    this.trash = join(this.root, '.trash');
    this.trashThumbs = join(this.trash, 'thumbs');
    this.tmp = join(this.root, '.tmp');
    for (const d of [this.root, this.thumbs, this.trash, this.trashThumbs, this.tmp]) mkdirSync(d, { recursive: true });
  }

  /** Detects the real type from magic bytes; returns the MIME type or null if not allowed. */
  async sniff(path: string): Promise<string | null> {
    const ft = await FileType.fromFile(path).catch(() => undefined);
    return ft && ALLOWED_TYPES[ft.mime] ? ft.mime : null;
  }

  /**
   * Validates and stores one image: reads oriented dimensions, writes the 600px WebP thumbnail
   * (EXIF orientation applied, metadata stripped) and places the original under a random name.
   * `mode: 'move'` renames the source (uploads), `'link'` hard-links it (bulk import, falls back to copy).
   */
  async store(src: string, mode: 'move' | 'link'): Promise<ProcessedImage> {
    const mimeType = await this.sniff(src);
    if (!mimeType) throw new BadRequestException('Unsupported or invalid image file');
    const id = randomUUID();
    const filename = `${id}.${ALLOWED_TYPES[mimeType]}`;
    const thumbFilename = `${id}.webp`;
    const thumbPath = join(this.thumbs, thumbFilename);
    const dest = join(this.root, filename);
    try {
      const meta = await sharp(src).metadata();
      if (!meta.width || !meta.height) throw new Error('missing dimensions');
      const rotated = (meta.orientation ?? 1) >= 5;
      await sharp(src)
        .rotate()
        .resize({ width: THUMB_WIDTH, withoutEnlargement: true })
        .webp({ quality: 75 })
        .toFile(thumbPath);
      if (mode === 'move') await fs.rename(src, dest);
      else await fs.link(src, dest).catch(() => fs.copyFile(src, dest));
      const { size } = await fs.stat(dest);
      return {
        filename,
        thumbFilename,
        mimeType,
        sizeBytes: size,
        width: rotated ? meta.height : meta.width,
        height: rotated ? meta.width : meta.height,
      };
    } catch (err) {
      await this.removeQuietly([thumbPath, dest]);
      if (err instanceof BadRequestException) throw err;
      throw new BadRequestException('Unsupported or invalid image file');
    }
  }

  async removeQuietly(paths: string[]) {
    await Promise.all(paths.map((p) => fs.rm(p, { force: true }).catch(() => undefined)));
  }

  private pairs(filename: string, thumb: string) {
    return {
      live: [join(this.root, filename), join(this.thumbs, thumb)],
      trashed: [join(this.trash, filename), join(this.trashThumbs, thumb)],
    };
  }

  /** Move a photo's files into/out of `.trash`. Missing files (e.g. synthetic bulk rows) are ignored. */
  async moveFiles(filename: string, thumb: string, to: 'trash' | 'live') {
    const { live, trashed } = this.pairs(filename, thumb);
    const [from, dest] = to === 'trash' ? [live, trashed] : [trashed, live];
    for (let i = 0; i < from.length; i++) {
      await fs.rename(from[i], dest[i]).catch((err: NodeJS.ErrnoException) => {
        if (err.code !== 'ENOENT') throw err;
      });
    }
  }

  async unlinkAll(filename: string, thumb: string) {
    const { live, trashed } = this.pairs(filename, thumb);
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
    const results = await Promise.allSettled(files.map((f) => this.limit(() => this.store(f.path, 'move'))));
    const failed = results.find((r): r is PromiseRejectedResult => r.status === 'rejected');
    if (failed) {
      const stored = results.filter((r): r is PromiseFulfilledResult<ProcessedImage> => r.status === 'fulfilled');
      await Promise.all(stored.map((r) => this.unlinkAll(r.value.filename, r.value.thumbFilename).catch(() => undefined)));
      await this.removeQuietly(files.map((f) => f.path));
      const idx = results.indexOf(failed);
      throw new BadRequestException(`File "${files[idx]?.originalname ?? idx}" is not a valid JPEG, PNG or WebP image`);
    }
    return results.map((r) => (r as PromiseFulfilledResult<ProcessedImage>).value);
  }

  logWarn(msg: string) {
    this.logger.warn(msg);
  }
}
