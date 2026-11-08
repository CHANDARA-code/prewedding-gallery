import Database from 'better-sqlite3';
import { drizzle, BetterSQLite3Database } from 'drizzle-orm/better-sqlite3';
import { migrate } from 'drizzle-orm/better-sqlite3/migrator';
import { mkdirSync } from 'fs';
import { dirname, join } from 'path';
import * as schema from './schema';

export type Db = BetterSQLite3Database<typeof schema>;
export interface DbHandle {
  sqlite: Database.Database;
  db: Db;
}

export const MIGRATIONS_DIR = join(__dirname, '..', '..', 'drizzle');

/** Opens the SQLite file with the tuning pragmas from spec 6.7.2. */
export function openDb(url: string): DbHandle {
  if (url !== ':memory:') mkdirSync(dirname(url), { recursive: true });
  const sqlite = new Database(url);
  sqlite.pragma('journal_mode = WAL'); // readers don't block the writer
  sqlite.pragma('synchronous = NORMAL'); // safe with WAL, far fewer fsyncs
  sqlite.pragma('foreign_keys = ON');
  sqlite.pragma('busy_timeout = 5000'); // wait instead of failing with SQLITE_BUSY
  sqlite.pragma('cache_size = -65536'); // 64 MB page cache
  sqlite.pragma('temp_store = MEMORY');
  sqlite.pragma('mmap_size = 268435456'); // 256 MB memory-mapped reads
  return { sqlite, db: drizzle(sqlite, { schema }) };
}

export function runMigrations(handle: DbHandle) {
  migrate(handle.db, { migrationsFolder: MIGRATIONS_DIR });
}
