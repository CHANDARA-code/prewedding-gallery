import { BadRequestException } from '@nestjs/common';

/**
 * Opaque keyset cursors: base64url(JSON). `k` tags the endpoint the cursor belongs to, so a
 * cursor from one list can't be replayed against another. Everything is validated before it
 * gets anywhere near SQL.
 */
export type CursorKind = 'p' | 'a' | 'f' | 's' | 'b';
export interface IdCursor {
  id: number;
}
export interface TimeIdCursor {
  t: number;
  id: number;
}

const isPosInt = (v: unknown): v is number => typeof v === 'number' && Number.isSafeInteger(v) && v > 0;
const bad = () => new BadRequestException('Invalid cursor');

export function encodeCursor(kind: CursorKind, data: IdCursor | TimeIdCursor): string {
  return Buffer.from(JSON.stringify({ k: kind, ...data })).toString('base64url');
}

function decodeRaw(cursor: string, kind: CursorKind, keys: string[]): Record<string, number> {
  if (typeof cursor !== 'string' || cursor.length > 200 || !/^[A-Za-z0-9_-]+$/.test(cursor)) throw bad();
  let obj: unknown;
  try {
    obj = JSON.parse(Buffer.from(cursor, 'base64url').toString('utf8'));
  } catch {
    throw bad();
  }
  if (!obj || typeof obj !== 'object' || Array.isArray(obj)) throw bad();
  const rec = obj as Record<string, unknown>;
  if (rec.k !== kind) throw bad();
  const got = Object.keys(rec).filter((k) => k !== 'k').sort();
  if (got.join(',') !== [...keys].sort().join(',')) throw bad();
  for (const k of keys) if (!isPosInt(rec[k])) throw bad();
  return rec as Record<string, number>;
}

export function decodeIdCursor(cursor: string | undefined, kind: 'p' | 'a' | 'b'): IdCursor | null {
  if (cursor === undefined || cursor === '') return null;
  const r = decodeRaw(cursor, kind, ['id']);
  return { id: r.id };
}

export function decodeTimeIdCursor(cursor: string | undefined, kind: 'f' | 's'): TimeIdCursor | null {
  if (cursor === undefined || cursor === '') return null;
  const r = decodeRaw(cursor, kind, ['t', 'id']);
  return { t: r.t, id: r.id };
}

export const DEFAULT_LIMIT = 24;
export const MAX_LIMIT = 60;

/** Clamp `limit` to 1..60 (spec 9.1). Non-numeric values fall back to the default. */
export function clampLimit(raw: unknown): number {
  const n = typeof raw === 'number' ? raw : Number.parseInt(String(raw ?? ''), 10);
  if (!Number.isFinite(n)) return DEFAULT_LIMIT;
  return Math.min(MAX_LIMIT, Math.max(1, Math.trunc(n)));
}
