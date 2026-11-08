/** `pnpm --filter api alert:test` sends one test message using TELEGRAM_* from .env. */
import { loadConfig } from '../config/env';
import { TelegramClient } from './telegram.client';

async function main() {
  const config = loadConfig();
  const client = new TelegramClient({
    token: config.telegramBotToken,
    chatId: config.telegramChatId,
    label: config.alertLabel,
    logger: console,
  });
  if (!client.enabled) throw new Error('TELEGRAM_BOT_TOKEN and TELEGRAM_CHAT_ID must be set');
  const ok = await client.send(`<b>[prewedding · ${config.alertLabel}]</b>\n✅ Test alert: Telegram alerts are wired up.`);
  console.log(ok ? 'Sent.' : 'Failed to send.');
  process.exit(ok ? 0 : 1);
}
void main();
