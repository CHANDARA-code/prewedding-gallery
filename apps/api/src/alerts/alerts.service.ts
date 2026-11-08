import { BeforeApplicationShutdown, Inject, Injectable, Logger, OnApplicationShutdown } from '@nestjs/common';
import { APP_CONFIG, AppConfig } from '../config/env';
import { TelegramClient } from './telegram.client';

export type AlertGroup = 'system' | 'auth' | 'admin' | 'engagement' | 'error';

@Injectable()
export class AlertsService implements BeforeApplicationShutdown, OnApplicationShutdown {
  private readonly logger = new Logger('Alerts');
  private readonly client: TelegramClient;

  constructor(@Inject(APP_CONFIG) private readonly config: AppConfig) {
    this.client = new TelegramClient({
      token: config.nodeEnv === 'test' ? undefined : config.telegramBotToken,
      chatId: config.telegramChatId,
      label: config.alertLabel,
      logger: this.logger,
    });
    if (!this.client.enabled) this.logger.log('Telegram alerts disabled (no TELEGRAM_BOT_TOKEN / TELEGRAM_CHAT_ID)');
  }

  get enabled() {
    return this.client.enabled;
  }

  /** Queue an alert if its group is enabled via ALERT_EVENTS. `html` must already be escaped. */
  notify(group: AlertGroup, html: string) {
    if (!this.config.alertEvents.has(group)) return;
    this.client.enqueue(html);
  }

  flush() {
    return this.client.flush();
  }

  beforeApplicationShutdown(signal?: string) {
    if (signal) this.notify('system', `🔴 API stopping (${signal})`);
  }

  async onApplicationShutdown() {
    await this.client.flush();
  }
}
