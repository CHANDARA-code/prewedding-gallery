import 'dotenv/config';

export interface AppConfig {
  nodeEnv: string;
  isProd: boolean;
  port: number;
  host: string;
  databaseUrl: string;
  jwtSecret: string;
  jwtExpiresIn: string;
  uploadDir: string;
  maxUploadMb: number;
  webOrigin: string[];
  allowDemoSeed: boolean;
  trustProxy: string | number | boolean | undefined;
  webDistDir?: string;
  telegramBotToken?: string;
  telegramChatId?: string;
  alertEvents: Set<string>;
  alertLabel: string;
  throttleLimit: number;
}

const ALERT_GROUPS = ['system', 'auth', 'admin', 'engagement', 'error'];

/** Reads and validates the environment. Throws (so the app refuses to boot) on invalid config. */
export function loadConfig(env: NodeJS.ProcessEnv = process.env): AppConfig {
  const nodeEnv = env.NODE_ENV ?? 'development';
  const isProd = nodeEnv === 'production';

  const jwtSecret = env.JWT_SECRET;
  if (!jwtSecret) throw new Error('JWT_SECRET is required');
  if (isProd && jwtSecret.length < 32) {
    throw new Error('JWT_SECRET must be at least 32 characters when NODE_ENV=production');
  }

  const port = Number(env.PORT ?? 3000);
  if (!Number.isInteger(port) || port <= 0) throw new Error('PORT must be a positive integer');
  const maxUploadMb = Number(env.MAX_UPLOAD_MB ?? 15);
  if (!(maxUploadMb > 0)) throw new Error('MAX_UPLOAD_MB must be positive');

  let trustProxy: AppConfig['trustProxy'];
  const tp = env.TRUST_PROXY?.trim();
  if (tp) trustProxy = /^\d+$/.test(tp) ? Number(tp) : tp === 'true' ? true : tp;

  const alertEvents = new Set(
    (env.ALERT_EVENTS ?? ALERT_GROUPS.join(','))
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean),
  );

  return {
    nodeEnv,
    isProd,
    port,
    host: env.BIND_HOST ?? '0.0.0.0',
    databaseUrl: env.DATABASE_URL ?? './data/app.db',
    jwtSecret,
    jwtExpiresIn: env.JWT_EXPIRES_IN ?? '1h',
    uploadDir: env.UPLOAD_DIR ?? './uploads',
    maxUploadMb,
    webOrigin: (env.WEB_ORIGIN ?? 'http://localhost:5173').split(',').map((s) => s.trim()),
    allowDemoSeed: env.ALLOW_DEMO_SEED === 'true',
    trustProxy,
    webDistDir: env.WEB_DIST_DIR || undefined,
    telegramBotToken: env.TELEGRAM_BOT_TOKEN || undefined,
    telegramChatId: env.TELEGRAM_CHAT_ID || undefined,
    alertEvents,
    alertLabel: env.ALERT_LABEL ?? nodeEnv,
    // Requests per minute per IP on normal endpoints (login is always 5/min).
    throttleLimit: Number(env.THROTTLE_LIMIT ?? (nodeEnv === 'test' ? 100_000 : 120)),
  };
}

export const APP_CONFIG = Symbol('APP_CONFIG');
