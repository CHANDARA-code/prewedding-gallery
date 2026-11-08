/**
 * `pnpm --filter api db:seed:bulk [count]` adds synthetic photo rows (placeholder filenames, no
 * real files) plus 1,000 random favorites and saves for the demo user, then runs ANALYZE.
 * Intended for performance testing on a separate DATABASE_URL.
 */
import 'dotenv/config';
import { eq } from 'drizzle-orm';
import { openDb, runMigrations } from './client';
import { favorites, photos, saves, users } from './schema';
import { assertSeedAllowed, seedUsers } from './seed';

export function seedBulk(handle: ReturnType<typeof openDb>, count: number, perUser = 1000) {
  seedUsers(handle);
  const { db, sqlite } = handle;
  const admin = db.select().from(users).where(eq(users.username, 'admin')).get()!;
  const demo = db.select().from(users).where(eq(users.username, 'demo')).get()!;
  const now = Math.floor(Date.now() / 1000);
  const ids: number[] = [];
  db.transaction((tx) => {
    for (let i = 0; i < count; i++) {
      const landscape = Math.random() < 0.6;
      const id = tx
        .insert(photos)
        .values({
          title: `Synthetic photo ${i + 1}`,
          caption: null,
          filename: `bulk-${i}.jpg`,
          thumbFilename: `bulk-${i}.webp`,
          mimeType: 'image/jpeg',
          sizeBytes: 2_000_000,
          width: landscape ? 6000 : 4000,
          height: landscape ? 4000 : 6000,
          uploadedBy: admin.id,
          createdAt: new Date((now - (count - i) * 60) * 1000),
        })
        .returning({ id: photos.id })
        .get().id;
      ids.push(id);
    }
    for (const table of [favorites, saves]) {
      const picked = new Set<number>();
      while (picked.size < Math.min(perUser, ids.length)) picked.add(ids[Math.floor(Math.random() * ids.length)]);
      for (const photoId of picked) {
        tx.insert(table)
          .values({ userId: demo.id, photoId, createdAt: new Date((now - Math.floor(Math.random() * 86400 * 30)) * 1000) })
          .onConflictDoNothing()
          .run();
      }
    }
  });
  sqlite.exec('ANALYZE');
  return ids.length;
}

if (require.main === module) {
  assertSeedAllowed();
  const count = Number(process.argv[2] ?? 10000);
  const handle = openDb(process.env.DATABASE_URL ?? './data/app.db');
  runMigrations(handle);
  const t0 = Date.now();
  const n = seedBulk(handle, count);
  console.log(`Inserted ${n} synthetic photos + favorites/saves for "demo" in ${Date.now() - t0} ms; ANALYZE done.`);
  handle.sqlite.close();
}
