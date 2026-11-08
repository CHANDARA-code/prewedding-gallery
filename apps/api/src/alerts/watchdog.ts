/**
 * Uptime watchdog, run as its own pm2 process next to the API (so it still reports when the API
 * itself is down). Every WATCH_INTERVAL_S it probes each URL in WATCH_URLS; after WATCH_FAILS
 * consecutive failures it sends a Telegram "DOWN" alert, and an "UP" alert with the downtime
 * when the check recovers. It also warns when free disk space under UPLOAD_DIR drops below
 * WATCH_MIN_FREE_GB.
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

const telegram = new TelegramClient({ token: config.telegramBotToken, chatId: config.telegramChatId, logger: console });
const tag = `<b>[prewedding · ${e(config.alertLabel)}]</b>\n`;
const state = new Map<string, { fails: number; down: boolean; since: number; lastError: string }>();
let diskWarned = false;

async function probe(url: string): Promise<string | null> {
  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(10_000), headers: { 'user-agent': 'prewedding-watchdog' } });
    if (!res.ok) return `HTTP ${res.status}`;
    return null;
  } catch (err) {
    return (err as Error).message;
  }
}

const fmt = (ms: number) => (ms < 120_000 ? `${Math.round(ms / 1000)}s` : `${Math.round(ms / 60_000)} min`);

async function tick() {
  for (const url of urls) {
    const s = state.get(url) ?? { fails: 0, down: false, since: Date.now(), lastError: '' };
    state.set(url, s);
    const error = await probe(url);
    if (error) {
      s.fails++;
      s.lastError = error;
      if (!s.down && s.fails >= failsNeeded) {
        s.down = true;
        s.since = Date.now();
        await telegram.send(`${tag}🔴 <b>DOWN</b>: ${e(url)}\n${e(error)} (${s.fails} failed checks)`);
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
void tick();
setInterval(() => void tick(), intervalMs);
