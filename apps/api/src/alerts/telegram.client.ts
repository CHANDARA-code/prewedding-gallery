/**
 * Minimal Telegram Bot API client with batching. Telegram limits a bot to ~20 messages per
 * minute in a group, so alerts are queued and flushed together (at most one message every
 * `flushMs`), split at the 4096-char message limit, and 429 `retry_after` is honoured.
 */
export interface TelegramClientOptions {
  token?: string;
  chatId?: string;
  label?: string;
  flushMs?: number;
  logger?: { log(msg: string): void; warn(msg: string): void; error(msg: string): void };
}

const MAX_LEN = 4000;

export function escapeHtml(s: unknown): string {
  return String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

export class TelegramClient {
  private queue: string[] = [];
  private timer: NodeJS.Timeout | null = null;
  private sending: Promise<void> = Promise.resolve();
  private readonly flushMs: number;

  constructor(private readonly opts: TelegramClientOptions) {
    this.flushMs = opts.flushMs ?? 3000;
  }

  get enabled() {
    return Boolean(this.opts.token && this.opts.chatId);
  }

  /** Queue an HTML-formatted alert line. */
  enqueue(html: string) {
    if (!this.enabled) return;
    this.queue.push(html);
    if (!this.timer) {
      this.timer = setTimeout(() => void this.flush(), this.flushMs);
      this.timer.unref?.();
    }
  }

  /** Send everything queued now. Resolves once delivered (or given up). */
  flush(): Promise<void> {
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
    const items = this.queue.splice(0);
    if (!items.length) return this.sending;
    const header = this.opts.label ? `<b>[prewedding · ${escapeHtml(this.opts.label)}]</b>\n` : '';
    const chunks: string[] = [];
    let cur = header;
    for (const item of items) {
      const piece = item.length > MAX_LEN - header.length ? item.slice(0, MAX_LEN - header.length - 1) + '…' : item;
      if (cur.length + piece.length + 2 > MAX_LEN && cur !== header) {
        chunks.push(cur);
        cur = header;
      }
      cur += (cur === header ? '' : '\n\n') + piece;
    }
    if (cur !== header) chunks.push(cur);
    this.sending = this.sending.then(async () => {
      for (const text of chunks) await this.send(text);
    });
    return this.sending;
  }

  /** Send one message immediately (bypasses batching). */
  async send(text: string, attempt = 0): Promise<boolean> {
    if (!this.enabled) return false;
    try {
      const res = await fetch(`https://api.telegram.org/bot${this.opts.token}/sendMessage`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          chat_id: this.opts.chatId,
          text,
          parse_mode: 'HTML',
          disable_web_page_preview: true,
        }),
        signal: AbortSignal.timeout(10_000),
      });
      if (res.ok) return true;
      const body = (await res.json().catch(() => ({}))) as { description?: string; parameters?: { retry_after?: number } };
      if (res.status === 429 && attempt < 3) {
        const wait = (body.parameters?.retry_after ?? 5) * 1000;
        await new Promise((r) => setTimeout(r, wait));
        return this.send(text, attempt + 1);
      }
      this.opts.logger?.warn(`Telegram sendMessage failed: ${res.status} ${body.description ?? ''}`);
    } catch (err) {
      if (attempt < 2) {
        await new Promise((r) => setTimeout(r, 2000 * (attempt + 1)));
        return this.send(text, attempt + 1);
      }
      this.opts.logger?.warn(`Telegram sendMessage error: ${(err as Error).message}`);
    }
    return false;
  }
}
