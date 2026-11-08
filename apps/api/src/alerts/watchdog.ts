/**
 * Uptime watchdog, run as its own pm2 process next to the API (so it still reports when the API
 * itself is down). Every WATCH_INTERVAL_S it probes each URL in WATCH_URLS; after WATCH_FAILS
 * consecutive failures it sends a Telegram "DOWN" alert, and an "UP" alert with the downtime
 * when the check recovers. It also warns when free disk space under UPLOAD_DIR drops below
 * WATCH_MIN_FREE_GB.
 *
 * Each check retries up to WATCH_RETRIES times (a few seconds apart) before counting as a failure,
 * so a single dropped packet between this server and Cloudflare doesn't page anyone. When a public
 * URL is down while the localhost URL is healthy, the alert says the origin is fine and the problem
 * is on the network/CDN path.
 */
import 'dotenv/config';
import { statfsSync } from 'fs';
import { loadConfig } from '../config/env';
import { escapeHtml as e, TelegramClient } from './telegram.client';

const config = loadConfig();
const urls = (process.env.WATCH_URLS ?? `http://127.0.0.1:${config.port}/api/v1/health`).split(',').map((s) => s.trim()).filter(Boolean);
const intervalMs = Number(process.env.WATCH_INTERVAL_S ?? 60) * 1000;
const failsNeeded = Number(process.env.WATCH_FAILS ?? 2);
const minFreeGb = Number(process.env.WATCH_MIN_FREE_GB ?? 5);
const retries = Number(process.env.WATCH_RETRIES ?? 3);
const timeoutMs = Number(process.env.WATCH_TIMEOUT_S ?? 15) * 1000;
const isLocal = (url: string) => /^https?:\/\/(127\.0\.0\.1|localhost|\[::1\])[:/]/.test(url);

const telegram = new TelegramClient({ token: config.telegramBotToken, chatId: config.telegramChatId, logger: console });
const tag = `<b>[prewedding · ${e(config.alertLabel)}]</b>\n`;
const state = new Map<string, { fails: number; down: boolean; since: number; lastError: string }>();
let diskWarned = false;

async function probeOnce(url: string): Promise<string | null> {
  try {
    const res = await fetch(url, {
      signal: AbortSignal.timeout(timeoutMs),
      headers: { 'user-agent': 'prewedding-watchdog', 'cache-control': 'no-cache' },
    });
    if (!res.ok) return `HTTP ${res.status}`;
    return null;
  } catch (err) {
    const e = err as Error & { cause?: { code?: string } };
    return e.cause?.code ? `${e.message} (${e.cause.code})` : e.message;
  }
}

/** Returns null as soon as one attempt succeeds, otherwise the last error. */
async function probe(url: string): Promise<string | null> {
  let error: string | null = null;
  for (let attempt = 1; attempt <= retries; attempt++) {
    error = await probeOnce(url);
    if (!error) return null;
    if (attempt < retries) await new Promise((r) => setTimeout(r, 3000 * attempt));
  }
  return `${error} after ${retries} attempts`;
}

const fmt = (ms: number) => (ms < 120_000 ? `${Math.round(ms / 1000)}s` : `${Math.round(ms / 60_000)} min`);

async function tick() {
  const errors = new Map(await Promise.all(urls.map(async (url) => [url, await probe(url)] as const)));
  const originHealthy = urls.some((u) => isLocal(u) && errors.get(u) === null);
  for (const url of urls) {
    const s = state.get(url) ?? { fails: 0, down: false, since: Date.now(), lastError: '' };
    state.set(url, s);
    const error = errors.get(url) ?? null;
    if (error) {
      s.fails++;
      s.lastError = error;
      if (!s.down && s.fails >= failsNeeded) {
        s.down = true;
        s.since = Date.now();
        const hint =
          !isLocal(url) && originHealthy
            ? '\nℹ️ Origin is healthy (localhost check OK): the server → Cloudflare path is failing, not the app.'
            : '';
        await telegram.send(`${tag}🔴 <b>DOWN</b>: ${e(url)}\n${e(error)} (${s.fails} failed checks)${hint}`);
      }
    } else {
      if (s.down) await telegram.send(`${tag}🟢 <b>UP again</b>: ${e(url)} after ${fmt(Date.now() - s.since)}`);
      s.fails = 0;
      s.down = false;
    }
  }
  try {
    const fs = statfsSync(config.uploadDir);
    const freeGb = (fs.bavail * fs.bsize) / 1024 ** 3;
    if (freeGb < minFreeGb && !diskWarned) {
      diskWarned = true;
      await telegram.send(`${tag}💾 Low disk space: ${freeGb.toFixed(1)} GB free for uploads`);
    } else if (freeGb >= minFreeGb * 1.2) diskWarned = false;
  } catch {
    /* upload dir not created yet */
  }
}

console.log(`Watchdog: checking ${urls.join(', ')} every ${intervalMs / 1000}s (alerts ${telegram.enabled ? 'on' : 'off'})`);
let running = false;
const run = async () => {
  if (running) return; // a slow tick (retries) never overlaps the next one
  running = true;
  try {
    await tick();
  } finally {
    running = false;
  }
};
void run();
setInterval(() => void run(), intervalMs);
