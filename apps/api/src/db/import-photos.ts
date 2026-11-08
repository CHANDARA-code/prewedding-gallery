/**
 * `pnpm --filter api db:import [dir ...]` imports real photos from folders (default: the
 * extracted A.zip and B.zip in ../../photos/A and ../../photos/B).
 *
 * - Every file is validated by magic bytes, gets a 600px WebP thumbnail, a 2048px WebP preview and a
 *   random UUID name (the source file name is kept in original_name),
 *   and the original is hard-linked into UPLOAD_DIR (copied if linking fails).
 * - Ids grow with upload time and the gallery shows the newest first, so files are inserted in
 *   reverse order: the first photo of folder A ends up at the top of the gallery.
 * - Resumable: data/import-manifest.json maps each source file to its photo id, so re-running
 *   skips what was already imported.
 * - Posts a start and a summary alert to Telegram when TELEGRAM_* are configured.
 */
import 'dotenv/config';
import { existsSync, promises as fs, readFileSync, writeFileSync } from 'fs';
import { cpus } from 'os';
import { basename, dirname, join, relative, resolve } from 'path';
import sharp from 'sharp';
import { eq } from 'drizzle-orm';
import { loadConfig } from '../config/env';
import { openDb, runMigrations } from './client';
import { photos, users } from './schema';
import { PhotoStorage, ProcessedImage } from '../photos/storage.service';
import { escapeHtml, TelegramClient } from '../alerts/telegram.client';

const IMAGE_RE = /\.(jpe?g|png|webp)$/i;

async function main() {
  const config = loadConfig();
  const args = process.argv.slice(2);
  const repoRoot = resolve(__dirname, '..', '..', '..', '..');
  const dirs = (args.length ? args : [join(repoRoot, 'photos', 'A'), join(repoRoot, 'photos', 'B')]).map((d) => resolve(d));

  const handle = openDb(config.databaseUrl);
  runMigrations(handle);
  const { db, sqlite } = handle;
  const admin =
    db.select().from(users).where(eq(users.role, 'admin')).orderBy(users.id).get() ??
    (() => {
      throw new Error('No admin user exists. Run db:seed (dev) or user:create <name> admin first.');
    })();

  const manifestPath = join(dirname(resolve(config.databaseUrl)), 'import-manifest.json');
  const manifest: Record<string, number> = existsSync(manifestPath) ? JSON.parse(readFileSync(manifestPath, 'utf8')) : {};

  const files: string[] = [];
  for (const dir of dirs) {
    const names = (await fs.readdir(dir)).filter((n) => IMAGE_RE.test(n)).sort((a, b) => a.localeCompare(b, 'en', { numeric: true }));
    files.push(...names.map((n) => join(dir, n)));
  }
  const keyOf = (f: string) => relative(repoRoot, f);
  const todo = files.filter((f) => !manifest[keyOf(f)]).reverse();

  const telegram = new TelegramClient({
    token: config.telegramBotToken,
    chatId: config.telegramChatId,
    label: config.alertLabel,
    logger: console,
  });
  const storage = new PhotoStorage(config.uploadDir);
  const workers = Math.max(1, cpus().length - 1);
  sharp.concurrency(1); // parallelism comes from running `workers` files at once

  console.log(`Found ${files.length} images in ${dirs.join(', ')}; ${todo.length} to import with ${workers} workers.`);
  if (!todo.length) return;
  await telegram.send(
    `<b>[prewedding · ${escapeHtml(config.alertLabel)}]</b>\n📥 Photo import started: ${todo.length} photos from ${dirs.map((d) => escapeHtml(basename(d))).join(', ')}`,
  );

  const t0 = Date.now();
  let done = 0;
  let bytes = 0;
  const failures: string[] = [];
  const batchSize = workers * 4;
  for (let i = 0; i < todo.length; i += batchSize) {
    const batch = todo.slice(i, i + batchSize);
    // Process the batch in parallel, then insert in order so ids follow the intended order.
    const results: (ProcessedImage | null)[] = new Array(batch.length).fill(null);
    let next = 0;
    await Promise.all(
      Array.from({ length: Math.min(workers, batch.length) }, async () => {
        while (next < batch.length) {
          const idx = next++;
          try {
            results[idx] = await storage.store(batch[idx], 'link', basename(batch[idx]));
          } catch (err) {
            failures.push(`${keyOf(batch[idx])}: ${(err as Error).message}`);
          }
        }
      }),
    );
    db.transaction((tx) => {
      batch.forEach((file, idx) => {
        const r = results[idx];
        if (!r) return;
        const id = tx.insert(photos).values({ ...r, uploadedBy: admin.id }).returning({ id: photos.id }).get().id;
        manifest[keyOf(file)] = id;
        done++;
        bytes += r.sizeBytes;
      });
    });
    writeFileSync(manifestPath, JSON.stringify(manifest));
    const secs = (Date.now() - t0) / 1000;
    console.log(`  ${Math.min(i + batch.length, todo.length)}/${todo.length} processed (${(done / secs).toFixed(1)} photos/s)`);
  }
  sqlite.exec('ANALYZE');
  sqlite.close();

  const secs = Math.round((Date.now() - t0) / 1000);
  const summary =
    `✅ Photo import finished: ${done} imported, ${failures.length} failed, ${(bytes / 1024 ** 3).toFixed(2)} GB in ${secs}s` +
    (failures.length ? `\n<pre>${escapeHtml(failures.slice(0, 10).join('\n'))}</pre>` : '');
  console.log(summary.replace(/<[^>]+>/g, ''));
  await telegram.send(`<b>[prewedding · ${escapeHtml(config.alertLabel)}]</b>\n${summary}`);
  if (failures.length) process.exitCode = 1;
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
