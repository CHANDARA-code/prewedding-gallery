# Pre-Wedding View

Photo gallery for the pre-wedding shoot, built from [spec.md](spec.md). Live at **https://prewedding.leavchandara.com** (Swagger UI at `/api/docs`).

- `apps/api`: NestJS + SQLite (Drizzle). Serves the API (`/api/v1`), the photos (`/uploads`) and, in production, the built web app.
- `apps/web`: React 18 + Vite + Ant Design, with infinite scroll and a virtualised grid.
- `docs/`: Mintlify docs (`cd docs && npx mint dev`); `openapi.json` comes from `pnpm --filter api openapi:export`.

## Local development

```bash
pnpm install
cp apps/api/.env.example apps/api/.env        # set JWT_SECRET
pnpm --filter api db:seed                     # demo/password and admin/password (dev only)
pnpm --filter api start:dev                   # http://localhost:3000
pnpm --filter web dev                         # http://localhost:5173 (proxies /api and /uploads)
pnpm --filter api test && pnpm --filter web test
```

Other commands: `db:generate`, `db:migrate`, `db:seed:bulk 10000`, `bench`, `openapi:export` (all `pnpm --filter api …`).

## Importing photos (A.zip / B.zip)

```bash
unzip A.zip -d photos && unzip B.zip -d photos
pnpm --filter api db:import                    # default: photos/A then photos/B
pnpm --filter api db:import /path/to/folder    # any other folder
```

Each file is checked by magic bytes and gets a 600 px WebP thumbnail and a random UUID name. Originals are hard-linked into `UPLOAD_DIR`, so they take no extra disk space; `photos/` must stay on the same filesystem. Photos are inserted in reverse, so the first photo of A shows at the top of the gallery. The import is resumable through `import-manifest.json` next to the database, and it posts a start and a summary alert to Telegram.

## Telegram alerts

Set `TELEGRAM_BOT_TOKEN` and `TELEGRAM_CHAT_ID` in the API env. `pnpm --filter api alert:test` sends a test message.

- **Event listener** (`src/alerts/alerts.listener.ts`): services emit domain events (`@nestjs/event-emitter`), and the listener turns them into alerts. Alerts are batched (at most one message every 3 s) to stay under Telegram's group rate limit, and 429 retries are honoured. Choose which groups to send with `ALERT_EVENTS`:

  | Group | Events |
  |---|---|
  | `system` | API started / stopping |
  | `auth` | successful login, failed login, login rate limit hit |
  | `admin` | upload, edit, soft delete, restore, hard delete |
  | `engagement` | favorite / unfavorite, save / unsave |
  | `error` | any 5xx response or unhandled rejection, with a short stack trace |

- **Uptime watchdog** (`src/alerts/watchdog.ts`): a separate pm2 process, so it still reports when the API is down. It checks the local and public `/api/v1/health` every 60 s. After 2 failed checks it sends DOWN, and on recovery it sends UP with the downtime. It also warns when the uploads disk has less than 5 GB free.

## Production (this server)

| What | Where |
|---|---|
| Processes | pm2 `prewedding-api` (127.0.0.1:4420) and `prewedding-watchdog`, defined in `ecosystem.config.cjs` |
| Config | `apps/api/.env.production` (gitignored, mode 600) |
| Data | `/opt/prewedding-data/` (`app.db`, `uploads/`, `admin-credentials.txt`) |
| Proxy | 1Panel OpenResty `conf.d/prewedding.leavchandara.com.conf`, behind Cloudflare |
| TLS | acme.sh (ZeroSSL), auto-renews and reloads OpenResty |

Deploy an update:

```bash
pnpm install && pnpm --filter web build && pnpm --filter api build
pm2 startOrReload ecosystem.config.cjs
```

Accounts: there is no self-registration and the demo seed is blocked in production. Create or reset users with:

```bash
cd apps/api && DOTENV_CONFIG_PATH=.env.production node dist/db/create-user.js <name> [user|admin]
```

Set `NEW_PASSWORD` to choose the password; otherwise a random one is printed.
