import { sql } from 'drizzle-orm';
import type { Db } from '../db/client';
import type { AdminStatus } from './photos.repository';

interface ExportRow {
  id: number;
  source_archive: string | null;
  original_name: string | null;
  filename: string;
  title: string | null;
  caption: string | null;
  deleted_at: number | null;
  width: number;
  height: number;
  rotation: number;
  mime_type: string;
  size_bytes: number;
  exif: string | null;
  uploaded_by: string | null;
  created_at: number;
  favorites: number;
  favorited_by: string | null;
  saves: number;
  saved_by: string | null;
}

export type ExportCollection = 'all' | 'favorites' | 'saves';

export interface ExportOptions {
  status: AdminStatus;
  /** Limit to photos someone favorited / saved. */
  collection: ExportCollection;
  /** With a collection: only the requesting user's favorites / saves. */
  mineUserId?: number;
  publicUrl: string;
}

// The columns people look for first (which zip, which file, link, who picked it) come first.
const COLUMNS = [
  'id',
  'source_zip',
  'original_file_name',
  'detail_url',
  'favorites',
  'favorited_by',
  'saves',
  'saved_by',
  'title',
  'caption',
  'status',
  'width',
  'height',
  'orientation',
  'rotation_deg',
  'mime_type',
  'size_bytes',
  'size_mb',
  'camera',
  'lens',
  'focal_length_mm',
  'aperture',
  'shutter',
  'iso',
  'taken_at',
  'uploaded_by',
  'uploaded_at',
  'deleted_at',
  'original_url',
  'stored_file_name',
] as const;

/** RFC 4180 field; also defuses spreadsheet formula injection (=, +, -, @ at the start). */
export function csvField(v: unknown): string {
  if (v === null || v === undefined) return '';
  let s = String(v);
  if (typeof v === 'string' && /^[=+\-@\t\r]/.test(s)) s = `'${s}`;
  return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

const iso = (secs: number | null) => (secs ? new Date(secs * 1000).toISOString() : '');
const shutter = (t?: number) => (!t ? '' : t >= 1 ? `${t}s` : `1/${Math.round(1 / t)}s`);

/** Builds the admin CSV export. UTF-8 with BOM so Excel shows Khmer titles correctly. */
export function buildPhotosCsv(db: Db, opts: ExportOptions): { csv: string; rows: number } {
  const { status, collection, mineUserId, publicUrl } = opts;
  const filters = [];
  if (status === 'active') filters.push(sql`p.deleted_at IS NULL`);
  if (status === 'deleted') filters.push(sql`p.deleted_at IS NOT NULL`);
  if (collection !== 'all') {
    const table = collection === 'favorites' ? sql`favorites` : sql`saves`;
    const who = mineUserId ? sql` AND c.user_id = ${mineUserId}` : sql``;
    filters.push(sql`EXISTS (SELECT 1 FROM ${table} c WHERE c.photo_id = p.id${who})`);
  }
  const where = filters.length ? sql`WHERE ${sql.join(filters, sql` AND `)}` : sql``;
  const rows = db.all<ExportRow>(sql`
    SELECT p.id, p.source_archive, p.original_name, p.filename, p.title, p.caption, p.deleted_at, p.width, p.height,
           p.rotation, p.mime_type, p.size_bytes, p.exif, u.username AS uploaded_by, p.created_at,
           (SELECT count(*) FROM favorites f WHERE f.photo_id = p.id) AS favorites,
           (SELECT group_concat(username, ', ') FROM (
              SELECT fu.username FROM favorites f JOIN users fu ON fu.id = f.user_id WHERE f.photo_id = p.id ORDER BY fu.username
           )) AS favorited_by,
           (SELECT count(*) FROM saves s WHERE s.photo_id = p.id) AS saves,
           (SELECT group_concat(username, ', ') FROM (
              SELECT su.username FROM saves s JOIN users su ON su.id = s.user_id WHERE s.photo_id = p.id ORDER BY su.username
           )) AS saved_by
    FROM photos p LEFT JOIN users u ON u.id = p.uploaded_by
    ${where}
    ORDER BY p.id DESC`);

  const lines = [COLUMNS.join(',')];
  for (const r of rows) {
    let x: Record<string, unknown> = {};
    try {
      x = r.exif ? JSON.parse(r.exif) : {};
    } catch {
      /* ignore malformed exif */
    }
    const camera = [x.make, x.model].filter(Boolean).join(' ').replace(/^(\w+) \1 /i, '$1 ');
    const values: Record<(typeof COLUMNS)[number], unknown> = {
      id: r.id,
      source_zip: r.source_archive ?? 'web upload',
      original_file_name: r.original_name,
      // Opens the photo viewer on the site (and renders a preview card when pasted into chats).
      detail_url: r.deleted_at ? '' : `${publicUrl}/photo/${r.id}`,
      favorites: r.favorites,
      favorited_by: r.favorited_by,
      saves: r.saves,
      saved_by: r.saved_by,
      stored_file_name: r.filename,
      title: r.title,
      caption: r.caption,
      status: r.deleted_at ? 'deleted' : 'active',
      width: r.width,
      height: r.height,
      orientation: r.width === r.height ? 'square' : r.width > r.height ? 'landscape' : 'portrait',
      rotation_deg: r.rotation,
      mime_type: r.mime_type,
      size_bytes: r.size_bytes,
      size_mb: (r.size_bytes / 1024 / 1024).toFixed(2),
      camera,
      lens: x.lens,
      focal_length_mm: x.focalLength,
      aperture: x.fNumber ? `f/${x.fNumber}` : '',
      shutter: shutter(x.exposureTime as number | undefined),
      iso: x.iso,
      taken_at: x.takenAt,
      uploaded_by: r.uploaded_by,
      uploaded_at: iso(r.created_at),
      deleted_at: iso(r.deleted_at),
      original_url: r.deleted_at ? '' : `${publicUrl}/uploads/${r.filename}`,
    };
    lines.push(COLUMNS.map((c) => csvField(values[c])).join(','));
  }
  return { csv: '﻿' + lines.join('\r\n') + '\r\n', rows: rows.length };
}
