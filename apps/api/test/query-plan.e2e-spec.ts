import { openDb, runMigrations, DbHandle } from '../src/db/client';
import { seedBulk } from '../src/db/seed-bulk';

/** Every list query must be an index walk: no table SCAN and no temp B-tree sort (spec 6.7.1). */
const COLS = 'p.id, p.title, p.caption, p.filename, p.thumb_filename, p.width, p.height, p.created_at';
const queries: Record<string, string> = {
  'public list (guest)': `SELECT ${COLS} FROM photos p WHERE p.deleted_at IS NULL AND p.id < ? ORDER BY p.id DESC LIMIT ?`,
  'public list (user)': `SELECT ${COLS}, f.photo_id IS NOT NULL, s.photo_id IS NOT NULL FROM photos p
     LEFT JOIN favorites f ON f.user_id = ? AND f.photo_id = p.id
     LEFT JOIN saves s ON s.user_id = ? AND s.photo_id = p.id
     WHERE p.deleted_at IS NULL AND p.id < ? ORDER BY p.id DESC LIMIT ?`,
  'admin trash': `SELECT ${COLS} FROM photos p WHERE p.deleted_at IS NOT NULL AND p.id < ? ORDER BY p.id DESC LIMIT ?`,
  'admin all': `SELECT ${COLS} FROM photos p WHERE p.id < ? ORDER BY p.id DESC LIMIT ?`,
  favorites: `SELECT ${COLS}, 1 FROM favorites f JOIN photos p ON p.id = f.photo_id AND p.deleted_at IS NULL
     LEFT JOIN saves s ON s.user_id = f.user_id AND s.photo_id = f.photo_id
     WHERE f.user_id = ? AND (f.created_at, f.photo_id) < (?, ?) ORDER BY f.created_at DESC, f.photo_id DESC LIMIT ?`,
  saves: `SELECT ${COLS}, 1 FROM saves s JOIN photos p ON p.id = s.photo_id AND p.deleted_at IS NULL
     LEFT JOIN favorites f ON f.user_id = s.user_id AND f.photo_id = s.photo_id
     WHERE s.user_id = ? AND (s.created_at, s.photo_id) < (?, ?) ORDER BY s.created_at DESC, s.photo_id DESC LIMIT ?`,
  'album photos': `SELECT ${COLS}, f.photo_id IS NOT NULL, s.photo_id IS NOT NULL FROM album_photos ap
     CROSS JOIN photos p
     LEFT JOIN favorites f ON f.user_id = ? AND f.photo_id = ap.photo_id
     LEFT JOIN saves s ON s.user_id = ? AND s.photo_id = ap.photo_id
     WHERE ap.album_id = ? AND ap.photo_id < ? AND p.id = ap.photo_id AND p.deleted_at IS NULL ORDER BY ap.photo_id DESC LIMIT ?`,
};

let handle: DbHandle;
let captured: string[] = [];

beforeAll(() => {
  handle = openDb(':memory:');
  runMigrations(handle);
  seedBulk(handle, 2000, 300);
  handle.sqlite.prepare('UPDATE photos SET deleted_at = unixepoch() WHERE id % 50 = 0').run();
  // Three albums sharing a third of the photos.
  handle.sqlite.exec(`INSERT INTO albums (slug, name, created_by) SELECT 'a' || id, 'Album ' || id, (SELECT min(id) FROM users) FROM (SELECT 1 AS id UNION SELECT 2 UNION SELECT 3)`);
  handle.sqlite.exec('INSERT INTO album_photos (album_id, photo_id) SELECT (id % 3) + 1, id FROM photos WHERE id % 3 = 0 OR id % 7 = 0');
  handle.sqlite.exec('ANALYZE');
});
afterAll(() => handle.sqlite.close());

const planOf = (sql: string) =>
  (handle.sqlite.prepare(`EXPLAIN QUERY PLAN ${sql}`).all(...Array(20).fill(1).slice(0, (sql.match(/\?/g) ?? []).length)) as { detail: string }[])
    .map((r) => r.detail)
    .join('\n');

function assertIndexed(name: string, plan: string) {
  expect(plan).not.toMatch(/SCAN (photos|favorites|saves|album_photos|p|f|s|ap)\b/);
  expect(plan).not.toMatch(/USE TEMP B-TREE FOR ORDER BY/);
  expect(plan).toMatch(/SEARCH/);
  if (process.env.SHOW_PLANS) console.log(`${name}:\n${plan}`);
}

describe('EXPLAIN QUERY PLAN', () => {
  it.each(Object.entries(queries))('%s uses an index', (name, sql) => {
    assertIndexed(name, planOf(sql));
  });

  it('the SQL Drizzle actually generates is index-backed too', () => {
    // Capture the real prepared statements built by PhotosRepository.
    const { PhotosRepository } = require('../src/photos/photos.repository');
    const orig = handle.sqlite.prepare.bind(handle.sqlite);
    captured = [];
    (handle.sqlite as unknown as { prepare: (s: string) => unknown }).prepare = (s: string) => {
      captured.push(s);
      return orig(s);
    };
    new PhotosRepository(handle.db);
    const { AlbumsService } = require('../src/albums/albums.service');
    new AlbumsService(handle.db, { emit: () => true });
    (handle.sqlite as unknown as { prepare: unknown }).prepare = orig;
    const lists = captured.filter((s) => /order by/i.test(s));
    expect(lists.length).toBe(9); // guest, user, admin x3, favorites, saves, album guest + user
    for (const sql of lists) assertIndexed(sql.slice(0, 60), planOf(sql));
  });
});
