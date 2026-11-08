/**
 * `pnpm --filter api db:backfill` (or `node dist/db/backfill-media.js` in production) fills the
 * columns added in migration 0001 for photos stored before it:
 *   - original_name and source_archive (A.zip / B.zip) from data/import-manifest.json (source path -> photo id),
 *   - preview_filename: renders the 2048px WebP viewer image,
 *   - exif: camera/lens/exposure fields read from the original.
 * Resumable and safe to run while the API is serving: only rows with preview_filename IS NULL are
 * processed, each row is committed as soon as its preview exists. Posts progress to Telegram.
 */
import 'dotenv/config';
import { existsSync, readFileSync } from 'fs';
import { basename, dirname, join, resolve } from 'path';
import sharp from 'sharp';
import { eq, isNull, sql } from 'drizzle-orm';
import { loadConfig } from '../config/env';
import { openDb, runMigrations } from './client';
import { photos } from './schema';
import { parseExif, PhotoStorage } from '../photos/storage.service';
import { escapeHtml, TelegramClient } from '../alerts/telegram.client';

async function main() {
  const config = loadConfig();
  const workers = Math.max(1, Number(process.env.BACKFILL_WORKERS ?? 3));
  const handle = openDb(config.databaseUrl);
  runMigrations(handle);
  const { db, sqlite } = handle;
  const storage = new PhotoStorage(config.uploadDir);
  sharp.concurrency(1);
  const telegram = new TelegramClient({ token: config.telegramBotToken, chatId: config.telegramChatId, logger: console });
  const tag = `<b>[prewedding · ${escapeHtml(config.alertLabel)}]</b>\n`;

  // 1. Original names from the import manifest.
  const manifestPath = join(dirname(resolve(config.databaseUrl)), 'import-manifest.json');
  let named = 0;
  if (existsSync(manifestPath)) {
    const manifest: Record<string, number> = JSON.parse(readFileSync(manifestPath, 'utf8'));
    const stmt = sqlite.prepare(
      'UPDATE photos SET original_name = coalesce(original_name, ?), source_archive = coalesce(source_archive, ?) WHERE id = ? AND (original_name IS NULL OR source_archive IS NULL)',
    );
    sqlite.transaction(() => {
      // Keys look like photos/B/KSNT1861.jpg: the folder is the zip it was extracted from.
      for (const [path, id] of Object.entries(manifest)) named += stmt.run(basename(path), `${basename(dirname(path))}.zip`, id).changes;
    })();
  }
  console.log(`original_name/source_archive set on ${named} photos from the import manifest`);

  // 2. Previews + EXIF.
  const todo = db
    .select({ id: photos.id, filename: photos.filename, rotation: photos.rotation, deletedAt: photos.deletedAt, exif: photos.exif })
    .from(photos)
    .where(isNull(photos.previewFilename))
    .orderBy(sql`${photos.id} DESC`) // newest first: what visitors see first gets fast soonest
    .all();
  console.log(`${todo.length} photos need a preview (${workers} workers)`);
  if (!todo.length) return;
  await telegram.send(`${tag}🖼️ Preview backfill started: ${todo.length} photos (${named} original names restored)`);

  const t0 = Date.now();
  let done = 0;
  let missing = 0;
  const failures: string[] = [];
  let nextReport = 0.25;
  let next = 0;
  await Promise.all(
    Array.from({ length: workers }, async () => {
      while (next < todo.length) {
        const row = todo[next++];
        const src = storage.originalPath(row.filename);
        if (!existsSync(src)) {
          missing++;
          continue;
        }
        try {
          const previewFilename = await storage.renderPreview(src, row.rotation, Boolean(row.deletedAt));
          let exif = row.exif;
          if (!exif) {
            const parsed = parseExif((await sharp(src).metadata()).exif);
            exif = parsed ? JSON.stringify(parsed) : null;
          }
          db.update(photos).set({ previewFilename, exif }).where(eq(photos.id, row.id)).run();
          done++;
        } catch (err) {
          failures.push(`#${row.id}: ${(err as Error).message}`);
        }
        const progress = (done + missing + failures.length) / todo.length;
        if (progress >= nextReport && nextReport < 1) {
          const pct = Math.round(nextReport * 100);
          nextReport += 0.25;
          const rate = done / ((Date.now() - t0) / 1000);
          console.log(`  ${pct}% (${done} done, ${rate.toFixed(1)}/s)`);
          await telegram.send(`${tag}⏳ Preview backfill ${pct}%: ${done}/${todo.length} (${rate.toFixed(1)} photos/s)`);
        }
      }
    }),
  );
  sqlite.close();
  const secs = Math.round((Date.now() - t0) / 1000);
  const summary =
    `✅ Preview backfill finished: ${done} rendered, ${missing} without an original file, ${failures.length} failed, in ${secs}s` +
    (failures.length ? `\n<pre>${escapeHtml(failures.slice(0, 10).join('\n'))}</pre>` : '');
  console.log(summary.replace(/<[^>]+>/g, ''));
  await telegram.send(`${tag}${summary}`);
  if (failures.length) process.exitCode = 1;
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
