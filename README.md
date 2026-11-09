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

Each file is checked by magic bytes and gets a 600 px WebP thumbnail, a 2048 px WebP preview (what the viewer shows; ~5x lighter than a 20 MP original) and a random UUID name. The source file name is kept as `original_name` and camera EXIF is stored (never GPS or serial numbers). Originals are hard-linked into `UPLOAD_DIR`, so they take no extra disk space; `photos/` must stay on the same filesystem. Photos are inserted in reverse, so the first photo of A shows at the top of the gallery. The import is resumable through `import-manifest.json` next to the database, and it posts a start and a summary alert to Telegram.

Photos stored before previews existed are filled in with `db:backfill` (resumable; also restores original names from the import manifest):

```bash
cd apps/api && node -r dotenv/config dist/db/backfill-media.js dotenv_config_path=.env.production
```

## Gallery features

- **Photo viewer** (Google Photos style): opens at `?photo=<id>` (Back closes it). The photo fills the screen and the controls float over it, sliding away shortly after a photo opens, on full screen (F) and when the mouse rests, and back as soon as the mouse moves (tap to toggle on phones). Photos slide like a carousel when you swipe or drag; swipe up for details, down to close. Zoom with wheel / pinch / double-tap (full resolution loads past 160%), ←/→, filmstrip, details panel (side panel, or a bottom sheet on phones) with EXIF (I), share (S), and in the ⋮ menu download original (D), slideshow (Space), full screen (F), add to album and rotate. Phones get a labelled Share · Favorite · Save · Download · Album bar.
- **Sharing**: `/photo/<id>` is served with Open Graph and Twitter tags and a 1200x630 share card (`/api/v1/photos/<id>/og.jpg`, rendered once and cached in `uploads/.og`), so Facebook, Messenger, Telegram, WhatsApp and X show a preview. Instagram gets the image through the native share sheet. Set `PUBLIC_URL` so links are absolute.
- **Admin**: rotate any photo from its card menu (every tab) or the viewer. A new thumbnail and preview are rendered and the original is never changed. **Export CSV** on the All tab downloads every photo in the current filter with original/stored file names, size, dimensions, orientation, EXIF, uploader, dates and favorite/save counts (`GET /api/v1/admin/photos/export.csv`).
- **Albums**: admins (or users granted `albums.manage`) create albums such as *Barsat Angkor Wat* on the **Albums** tab and fill them by tapping **Select** on All, Favorite or Save (shift-click selects a range), or **Add photos** on the album page, or the folder button in the photo viewer. Anyone can browse published albums at `/albums/<slug>` with the same viewer, favorite/save and share; hidden albums are only visible to album managers until published. Album links get Open Graph cards from the album's cover. **Export CSV** on an album page exports just that album (`album=<id>`), and every export has an `albums` column.
- **Select mode**: tap **Select** on any tab (or press Ctrl+A / ⌘A to select every loaded photo; with a mouse, tick the check that appears on a hovered photo, Ctrl/⌘-click, shift-click a range, or drag a box across the grid) to act on many photos at once: download them as a ZIP (everyone), favorite or save them, and for admins rotate, edit titles/captions, add to an album, export CSV, move to trash, restore or delete forever.
- **Share links**: in select mode, the link button makes `/s/<token>` for the selected photos: *anyone with the link* or *only people I choose* (they log in), with an optional title and expiry. **Shared links** in the account menu lists links shared with you and your own (copy, edit, delete).
- **Motion**: small, fast animations with a purpose (press feedback, page fade-up, thumbnails fading in, a photo growing out of its thumbnail and back, the selection bar sliding in and out), built to the animation skills in `.claude/skills`; reduced-motion is respected.
- **Link preview of the site**: set `SITE_COVER_PHOTO_ID` (e.g. `2028`) to choose the photo shown when the home page link is shared; otherwise the newest photo is used.
- **Caching**: `/uploads` files are immutable (1 year), and a service worker (`apps/web/public/sw.js`) keeps thumbnails and previews on the device, capped at 3000 and 400 entries.

## Telegram alerts

Set `TELEGRAM_BOT_TOKEN` and `TELEGRAM_CHAT_ID` in the API env. `pnpm --filter api alert:test` sends a test message.

- **Event listener** (`src/alerts/alerts.listener.ts`): services emit domain events (`@nestjs/event-emitter`), and the listener turns them into alerts. Alerts are batched (at most one message every 3 s) to stay under Telegram's group rate limit, and 429 retries are honoured. Choose which groups to send with `ALERT_EVENTS`:

  | Group | Events |
  |---|---|
  | `system` | API started / stopping |
  | `auth` | successful login; failed login (unknown account vs wrong password, attempt n/5, user agent); lockout; rate limit hit |
  | `admin` | upload, edit, rotate, CSV export, soft delete, restore, hard delete |
  | `engagement` | favorite / unfavorite, save / unsave |
  | `error` | any 5xx response or unhandled rejection, with a short stack trace |

- **Uptime watchdog** (`src/alerts/watchdog.ts`): a separate pm2 process, so it still reports when the API is down. It checks the local and public `/api/v1/health` every 60 s, retrying each check 3 times. After 2 failed checks it sends DOWN (noting when the origin is healthy and only the server → Cloudflare path fails), and on recovery it sends UP with the downtime. It also warns when the uploads disk has less than 5 GB free.

## Production (this server)

| What | Where |
|---|---|
| Processes | pm2 `prewedding-api` (127.0.0.1:4420) and `prewedding-watchdog`, defined in `ecosystem.config.cjs` |
| Config | `apps/api/.env.production` (gitignored, mode 600) |
| Data | `/opt/prewedding-data/` (`app.db`, `uploads/`, `backups/`, `admin-credentials.txt`) |
| Proxy | 1Panel OpenResty `conf.d/prewedding.leavchandara.com.conf`, behind Cloudflare |
| TLS | acme.sh (ZeroSSL), auto-renews and reloads OpenResty |

Deploy an update:

```bash
pnpm install && pnpm --filter web build && pnpm --filter api build
sqlite3 /opt/prewedding-data/app.db ".backup '/opt/prewedding-data/backups/app-$(date +%Y%m%d-%H%M%S).db'"
pm2 startOrReload ecosystem.config.cjs --update-env    # migrations run on startup
```

Login protection: 5 attempts/min per IP, and 5 failures for one username from one IP within 15 min lock that pair for 15 min.

Accounts: there is no self-registration and the demo seed is blocked in production. Admins manage users in the web
app (account menu → **Manage users**): create accounts with a role and permissions, reset passwords, disable or
delete. The same rules are available from the shell:

```bash
cd apps/api
users() { node -r dotenv/config dist/db/users-cli.js "$@" dotenv_config_path=.env.production; }   # bash and zsh
users list
users create dara user --grant photos.upload,photos.export   # or: users create tithya admin
users set dara --role admin                                   # --grant a,b|none  --disable  --enable
users reset-password dara
users delete dara
users permissions
```

Set `NEW_PASSWORD` to choose the password; otherwise a strong one is generated and printed once. Admins have every
permission; users can be granted `photos.upload`, `photos.edit`, `photos.delete`, `photos.purge`, `photos.export`.
