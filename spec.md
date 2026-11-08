# Pre-Wedding View: Technical Specification

A photo gallery for pre-wedding photos. Anyone can browse. Logged-in users can favorite and save photos. An admin can upload photos and delete them (soft or hard).

- **Version:** 1.1 (adds cursor pagination, infinite scroll, API and DB performance work)
- **Date:** 2026-11-07

---

## 1. Goals and Scope

### 1.1 Goals
- Public gallery that anyone can view without logging in.
- Per-user **Favorite** and **Save** collections for logged-in users.
- Admin-only photo management: upload, soft delete, restore, hard delete.
- Responsive UI on mobile, tablet and desktop.
- Documented REST API published with Mintlify.
- **Infinite-scroll browsing** backed by cursor pagination, staying fast with 10,000+ photos.
- **Fast list queries**: index-backed keyset queries, no N+1, no `COUNT(*)` or `OFFSET` on hot paths.

### 1.2 Out of Scope (v1)
- User self-registration, password reset, social login.
- Comments, sharing links, albums or categories.
- Cloud object storage (local disk only; see 10. Future Work).

---

## 2. Tech Stack

| Layer | Choice |
|---|---|
| Backend | NestJS 10+ (TypeScript) |
| Database | SQLite via `better-sqlite3` |
| ORM / migrations | Drizzle ORM + `drizzle-kit` |
| Auth | JWT (`@nestjs/jwt`, `passport-jwt`), passwords hashed with `bcrypt` |
| Validation | `class-validator`, `class-transformer` |
| File upload | `@nestjs/platform-express` (Multer), `sharp` for thumbnails and dimensions |
| API spec | `@nestjs/swagger`, which exports `openapi.json` |
| API docs | Mintlify (`docs/` folder, driven by `openapi.json`) |
| Frontend | React 18 + Vite + TypeScript |
| UI | Ant Design 5 |
| Data fetching | TanStack Query (`useInfiniteQuery`) + Axios |
| Performance | `compression`, `@nestjs/cache-manager` (in-memory), `@tanstack/react-virtual`, `autocannon` (load tests) |
| Routing | React Router 6 |

---

## 3. Repository Layout

```
prewedding-view/
├── spec.md
├── apps/
│   ├── api/                      # NestJS
│   │   ├── src/
│   │   │   ├── main.ts
│   │   │   ├── app.module.ts
│   │   │   ├── config/           # env validation
│   │   │   ├── db/
│   │   │   │   ├── schema.ts     # Drizzle schema
│   │   │   │   ├── db.module.ts  # provides DRIZZLE token
│   │   │   │   └── seed.ts
│   │   │   ├── auth/             # login, JwtStrategy, guards, decorators
│   │   │   ├── photos/           # public + admin photo endpoints
│   │   │   ├── favorites/
│   │   │   ├── saves/
│   │   │   └── common/           # filters, interceptors, DTOs
│   │   ├── drizzle/              # generated SQL migrations
│   │   ├── drizzle.config.ts
│   │   ├── uploads/              # runtime: originals + thumbs (gitignored)
│   │   └── data/app.db           # runtime SQLite file (gitignored)
│   └── web/                      # React + Vite
│       └── src/
│           ├── main.tsx
│           ├── App.tsx
│           ├── api/              # axios instance + query hooks
│           ├── auth/             # AuthContext, LoginModal, RequireAuth
│           ├── components/       # PhotoGrid, PhotoCard, Lightbox, UploadModal
│           └── pages/            # AllPage, FavoritePage, SavePage
└── docs/                         # Mintlify
    ├── docs.json
    ├── introduction.mdx
    ├── quickstart.mdx
    ├── authentication.mdx
    ├── pagination.mdx
    ├── errors.mdx
    └── openapi.json              # generated from NestJS
```

---

## 4. Users and Roles

| Role | Capabilities |
|---|---|
| **Guest** (not logged in) | View the `All` tab, open the lightbox. Cannot favorite or save. |
| **User** | Everything a guest can do, plus favorite, save, and the `Favorite` and `Save` tabs. |
| **Admin** | Everything a user can do, plus upload, soft delete, restore, hard delete, and view deleted photos. |

### 4.1 Seeded Credentials (development and demo only)

| Username | Password | Role |
|---|---|---|
| `demo` | `password` | `user` |
| `admin` | `password` | `admin` |

- Seeded by `pnpm --filter api db:seed`. Passwords are stored as bcrypt hashes (cost 10), never in plaintext.
- The seed is idempotent (upsert by username).
- The seed **refuses to run when `NODE_ENV=production`** unless `ALLOW_DEMO_SEED=true`, because these credentials are public knowledge.

---

## 5. Database (SQLite + Drizzle)

### 5.1 Schema (`apps/api/src/db/schema.ts`)

```ts
import { sqliteTable, text, integer, primaryKey, index } from 'drizzle-orm/sqlite-core';
import { sql } from 'drizzle-orm';

export const users = sqliteTable('users', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  username: text('username').notNull().unique(),
  passwordHash: text('password_hash').notNull(),
  role: text('role', { enum: ['user', 'admin'] }).notNull().default('user'),
  createdAt: integer('created_at', { mode: 'timestamp' }).notNull().default(sql`(unixepoch())`),
});

export const photos = sqliteTable('photos', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  title: text('title'),
  caption: text('caption'),
  filename: text('filename').notNull(),        // stored original, e.g. 8f2c...jpg
  thumbFilename: text('thumb_filename').notNull(),
  mimeType: text('mime_type').notNull(),
  sizeBytes: integer('size_bytes').notNull(),
  width: integer('width').notNull(),
  height: integer('height').notNull(),
  uploadedBy: integer('uploaded_by').notNull().references(() => users.id),
  createdAt: integer('created_at', { mode: 'timestamp' }).notNull().default(sql`(unixepoch())`),
  deletedAt: integer('deleted_at', { mode: 'timestamp' }),   // NULL = active, set = soft-deleted
}, (t) => ({
  // Public/guest list: `WHERE deleted_at IS NULL ORDER BY id DESC`. Partial index only holds
  // active rows, so it stays small and is scanned newest-first with no sort step.
  activeIdx: index('photos_active_idx').on(t.id).where(sql`${t.deletedAt} IS NULL`),
  // Admin "Trash" view: `WHERE deleted_at IS NOT NULL ORDER BY id DESC`.
  trashIdx: index('photos_trash_idx').on(t.id).where(sql`${t.deletedAt} IS NOT NULL`),
}));

export const favorites = sqliteTable('favorites', {
  userId: integer('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  photoId: integer('photo_id').notNull().references(() => photos.id, { onDelete: 'cascade' }),
  createdAt: integer('created_at', { mode: 'timestamp' }).notNull().default(sql`(unixepoch())`),
}, (t) => ({
  pk: primaryKey({ columns: [t.userId, t.photoId] }),   // also serves the isFavorite point lookups
  // Keyset list: `WHERE user_id = ? AND (created_at, photo_id) < (?, ?) ORDER BY created_at DESC, photo_id DESC`.
  // SQLite scans this index backwards, so no DESC index or sort step is needed.
  listIdx: index('favorites_user_list_idx').on(t.userId, t.createdAt, t.photoId),
  // Makes the ON DELETE CASCADE from a hard-deleted photo an index seek instead of a table scan.
  photoIdx: index('favorites_photo_idx').on(t.photoId),
}));

export const saves = sqliteTable('saves', {
  userId: integer('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  photoId: integer('photo_id').notNull().references(() => photos.id, { onDelete: 'cascade' }),
  createdAt: integer('created_at', { mode: 'timestamp' }).notNull().default(sql`(unixepoch())`),
}, (t) => ({
  pk: primaryKey({ columns: [t.userId, t.photoId] }),   // also serves the isSaved point lookups
  listIdx: index('saves_user_list_idx').on(t.userId, t.createdAt, t.photoId),
  photoIdx: index('saves_photo_idx').on(t.photoId),
}));
```

### 5.2 Configuration Notes
- Connection pragmas (foreign keys, WAL, cache and mmap sizes, `busy_timeout`) are set once when the DB module starts. The full list and rationale are in 6.7.2.
- Migrations: `drizzle-kit generate`, then apply with `drizzle-kit migrate` (or `migrate()` at app start in dev).
- `drizzle.config.ts` uses `dialect: 'sqlite'` and `dbCredentials.url = DATABASE_URL`.

### 5.3 Delete Semantics

| Action | Effect on `photos` row | Effect on files | Effect on favorites and saves |
|---|---|---|---|
| **Soft delete** | `deleted_at = now()` | Files moved to `uploads/.trash/` (kept, but not publicly served) | Rows kept but hidden. The photo disappears from every list, including users' Favorite and Save tabs. |
| **Restore** | `deleted_at = NULL` | Files moved back to `uploads/` | The photo reappears in the lists it was in before. |
| **Hard delete** | Row removed | Original and thumbnail unlinked from disk | Cascade-deleted by the foreign keys. |

---

## 6. Backend API

Base URL: `/api/v1`. JSON everywhere except upload (`multipart/form-data`). Static files are served at `/uploads/*`.

### 6.1 Authentication

- `POST /auth/login` with `{ username, password }` returns `{ accessToken, tokenType: "Bearer", expiresIn, user }`.
- JWT payload: `{ sub: userId, username, role }`. Signed HS256 with `JWT_SECRET`. Default TTL is 1 hour (`JWT_EXPIRES_IN=1h`).
- Clients send `Authorization: Bearer <token>`.
- Guards:
  - `JwtAuthGuard` requires a valid token.
  - `OptionalJwtAuthGuard` accepts a missing token (guest) but populates `req.user` when valid. It is used on public photo endpoints so they can return `isFavorite` and `isSaved` flags.
  - `RolesGuard` with `@Roles('admin')` for admin endpoints.
- Invalid credentials return `401` with a generic message. The response must not reveal whether the username exists.
- Login is rate limited (`@nestjs/throttler`, 5 attempts per minute per IP).

### 6.2 Endpoint Summary

| Method | Path | Auth | Description |
|---|---|---|---|
| POST | `/auth/login` | Public | Exchange credentials for a JWT |
| GET | `/auth/me` | User | Current user profile |
| GET | `/photos` | Public (optional JWT) | List active photos, newest first, **cursor-paginated** (6.6) |
| GET | `/photos/:id` | Public (optional JWT) | Photo detail (404 if soft-deleted, unless admin) |
| GET | `/me/favorites` | User | List the current user's favorited active photos, most recently favorited first, cursor-paginated |
| PUT | `/photos/:id/favorite` | User | Favorite a photo (idempotent) |
| DELETE | `/photos/:id/favorite` | User | Remove favorite (idempotent) |
| GET | `/me/saves` | User | List the current user's saved active photos, most recently saved first, cursor-paginated |
| PUT | `/photos/:id/save` | User | Save a photo (idempotent) |
| DELETE | `/photos/:id/save` | User | Remove save (idempotent) |
| GET | `/admin/photos` | Admin | List photos, cursor-paginated; `?status=active\|deleted\|all` (default `all`) |
| POST | `/admin/photos` | Admin | Upload one or more photos |
| PATCH | `/admin/photos/:id` | Admin | Update title and caption |
| DELETE | `/admin/photos/:id` | Admin | **Soft delete** |
| POST | `/admin/photos/:id/restore` | Admin | Restore a soft-deleted photo |
| DELETE | `/admin/photos/:id/permanent` | Admin | **Hard delete** (row and files) |

### 6.3 Key Contracts

**Photo object**
```json
{
  "id": 12,
  "title": "Golden hour",
  "caption": "Angkor Wat, sunrise",
  "url": "/uploads/8f2c1a.jpg",
  "thumbUrl": "/uploads/thumbs/8f2c1a.webp",
  "width": 3000,
  "height": 2000,
  "createdAt": "2026-11-01T08:30:00.000Z",
  "isFavorite": false,
  "isSaved": true,
  "deletedAt": null
}
```
- `isFavorite` and `isSaved` are present only when a valid token was sent.
- `deletedAt` is only ever non-null on admin responses.

**List response**
```json
{ "items": [ /* Photo */ ], "nextCursor": "eyJpZCI6MTAwfQ", "hasMore": true }
```
Query params: `limit` (default 24, min 1, max 60) and `cursor` (opaque string from the previous response's `nextCursor`; omit for the first page). On the last page `nextCursor` is `null` and `hasMore` is `false`. There is no `total` field (see 6.6).

**Upload** (`POST /admin/photos`)
- Field `files` (1 to 20 files), optional `title` and `caption` applied to each.
- Allowed MIME types: `image/jpeg`, `image/png`, `image/webp`. Max 15 MB per file.
- Validate the real file type by magic bytes (not only the extension or declared MIME).
- Filenames are generated server-side (`randomUUID()` + extension). The client filename is never used for storage paths.
- For each file: read width and height with `sharp`, write a 600 px wide WebP thumbnail to `uploads/thumbs/`.
- Returns `201` with the created `Photo[]`. If any file is invalid the whole request fails with `400` and no files are kept.

**Errors** use one shape:
```json
{ "statusCode": 404, "error": "Not Found", "message": "Photo not found" }
```

### 6.4 Backend Non-Functional Requirements
- Global `ValidationPipe({ whitelist: true, transform: true })`.
- `helmet`, CORS restricted to `WEB_ORIGIN`, request body size limits.
- Hard delete runs the DB delete and file unlink together. If the file unlink fails after the DB delete, log the error and do not fail the request (orphaned files are tolerable, dangling rows are not).
- Swagger is configured with `addBearerAuth()`. A script `pnpm --filter api openapi:export` writes `docs/openapi.json`.

### 6.5 Environment Variables (`apps/api/.env`)

```
NODE_ENV=development
PORT=3000
DATABASE_URL=./data/app.db
JWT_SECRET=change-me-to-a-long-random-string
JWT_EXPIRES_IN=1h
UPLOAD_DIR=./uploads
MAX_UPLOAD_MB=15
WEB_ORIGIN=http://localhost:5173
ALLOW_DEMO_SEED=false
```
The app must fail to start if `JWT_SECRET` is missing, or is shorter than 32 characters when `NODE_ENV=production`.

### 6.6 Pagination (Cursor / Keyset, for Infinite Scroll)

Every list endpoint (`/photos`, `/me/favorites`, `/me/saves`, `/admin/photos`) uses **keyset (cursor) pagination**. `page` / `OFFSET` pagination is not used.

**Why not OFFSET?**
- `OFFSET n` makes SQLite walk and discard `n` rows, so every further scroll gets slower. Keyset cost stays flat at any depth.
- With offsets, a photo uploaded or deleted mid-scroll shifts the window, causing duplicates or skipped photos. A cursor anchors to a specific row, so the feed stays consistent.
- `COUNT(*)` for `total` costs a scan on every request, and infinite scroll does not need it. `total` is intentionally omitted.

**Request and response**
- `GET /photos?limit=24&cursor=<opaque>` returns `{ items, nextCursor, hasMore }`.
- The server queries `limit + 1` rows. If it gets more than `limit`, `hasMore = true` and the extra row is dropped. `nextCursor` encodes the last returned row.
- The cursor is `base64url(JSON)`. Clients must treat it as opaque. A malformed, tampered or wrong-endpoint cursor returns `400`.

**Ordering and cursor contents**

| Endpoint | Order | Cursor holds | Keyset condition |
|---|---|---|---|
| `GET /photos`, `GET /admin/photos` | `photos.id DESC` (ids grow with upload time, so newest first) | `{ id }` | `id < :id` |
| `GET /me/favorites` | `favorites.created_at DESC, photo_id DESC` | `{ t, id }` | `(created_at, photo_id) < (:t, :id)` |
| `GET /me/saves` | `saves.created_at DESC, photo_id DESC` | `{ t, id }` | `(created_at, photo_id) < (:t, :id)` |

`photo_id` is the tie-breaker because `created_at` has one-second resolution.

**Query shapes**
```sql
-- All tab (guest or user)
SELECT p.id, p.title, p.caption, p.filename, p.thumb_filename, p.width, p.height, p.created_at,
       f.photo_id IS NOT NULL AS is_favorite,        -- LEFT JOINs only when a user is logged in
       s.photo_id IS NOT NULL AS is_saved
FROM photos p
LEFT JOIN favorites f ON f.user_id = :uid AND f.photo_id = p.id
LEFT JOIN saves     s ON s.user_id = :uid AND s.photo_id = p.id
WHERE p.deleted_at IS NULL AND p.id < :cursorId
ORDER BY p.id DESC
LIMIT :limitPlusOne;

-- Favorite tab (Save tab is identical on `saves`)
SELECT p.id, ..., 1 AS is_favorite
FROM favorites f
JOIN photos p ON p.id = f.photo_id AND p.deleted_at IS NULL
WHERE f.user_id = :uid AND (f.created_at, f.photo_id) < (:t, :id)
ORDER BY f.created_at DESC, f.photo_id DESC
LIMIT :limitPlusOne;
```
In Drizzle the row-value comparison is written as ``sql`(${favorites.createdAt}, ${favorites.photoId}) < (${t}, ${id})` ``. The soft-delete filter sits inside the join, so a page is never returned short because of hidden photos.

### 6.7 Performance Optimization

#### 6.7.1 Query design (listing from the DB)
- **Index-backed keyset queries** only (schema in 5.1). Partial index `photos_active_idx` makes the public list an ordered index walk with no sort. `favorites_user_list_idx` and `saves_user_list_idx` do the same for personal lists.
- **No N+1.** `isFavorite` and `isSaved` come from the `LEFT JOIN`s above (point lookups on the composite primary key). Never query per photo.
- **No `COUNT(*)`, no `OFFSET`** on any hot path.
- **Select only the columns the DTO needs.** List queries skip `mime_type`, `size_bytes` and `uploaded_by`. Those are only selected on admin detail.
- **Prepared statements.** Hot queries are built once with Drizzle `.prepare()` and `sql.placeholder()`, then re-executed with parameters.
- **Plan check.** Each list query has a test that runs `EXPLAIN QUERY PLAN` and fails if the plan contains `SCAN photos`, `SCAN favorites`, `SCAN saves` or `USE TEMP B-TREE FOR ORDER BY`. A plan should read `SEARCH ... USING INDEX ...`.

#### 6.7.2 SQLite tuning
Applied once on connection in `db.module.ts`:
```ts
sqlite.pragma('journal_mode = WAL');        // readers don't block the writer
sqlite.pragma('synchronous = NORMAL');      // safe with WAL, far fewer fsyncs
sqlite.pragma('foreign_keys = ON');
sqlite.pragma('busy_timeout = 5000');       // wait instead of failing with SQLITE_BUSY
sqlite.pragma('cache_size = -65536');       // 64 MB page cache
sqlite.pragma('temp_store = MEMORY');
sqlite.pragma('mmap_size = 268435456');     // 256 MB memory-mapped reads
```
- Run `PRAGMA optimize` on graceful shutdown (`OnApplicationShutdown`) and `ANALYZE` after bulk seeding, so the query planner has fresh statistics.
- `better-sqlite3` is synchronous and blocks the Node event loop while a query runs. That is fine for index-backed queries that take well under a millisecond, but it means: no unbounded queries, no loops of queries on the request path, and writes stay small. Image processing (`sharp`) runs on libuv worker threads, so it does not block the loop.

#### 6.7.3 HTTP, caching and payload
- **Compression.** `compression` middleware for JSON responses (gzip, 1 KB threshold). Images are not recompressed.
- **Static files.** `/uploads` is served with `Cache-Control: public, max-age=31536000, immutable`. This is safe because filenames are random UUIDs and never reused. Soft delete moves the original and thumbnail into `uploads/.trash/` (outside the static root) and restore moves them back, so static serving needs no per-request DB check and stays fast.
- **List endpoints.**
  - Requests without `Authorization`: `Cache-Control: public, max-age=30, stale-while-revalidate=60`, plus `Vary: Authorization`.
  - Requests with a token: `Cache-Control: private, no-cache` (they include per-user flags).
  - `/admin/*` and `/me/*`: `Cache-Control: no-store`.
  - Express weak ETags stay on, so unchanged lists answer `304 Not Modified`.
- **In-process cache for guests.** `@nestjs/cache-manager` (memory store, max 200 entries, TTL 30 s) caches guest list pages under the key `photos:list:v{version}:{limit}:{cursor}`. A `version` counter is bumped on every photo mutation (upload, patch, soft delete, restore, hard delete), which invalidates all cached pages instantly. Per-user responses are never cached here.
- **Small payloads.** The list returns the 600 px WebP `thumbUrl`, never full images, and includes `width` and `height` so the client can reserve space.

#### 6.7.4 Upload and image processing
- Multer **disk storage** (stream to disk, never buffer a whole file in memory).
- Thumbnail generation uses `sharp` with `rotate()` (applies EXIF orientation), WebP quality 75, and metadata stripped. Concurrency is limited (`sharp.concurrency(2)` plus `p-limit(2)` across files) so a 20-file upload cannot starve list requests.

#### 6.7.5 Throttling
- Global `@nestjs/throttler` default: 120 requests per minute per IP on read endpoints (login keeps its stricter 5 per minute limit).

#### 6.7.6 Performance budgets
Measured on a developer laptop against a DB seeded with 10,000 photos (`db:seed:bulk`), using `autocannon` with 50 connections.

| Metric | Target |
|---|---|
| `GET /photos?limit=24` server time, p95 (uncached) | < 30 ms, of which DB < 5 ms |
| `GET /me/favorites?limit=24` (1,000 favorites), p95 | < 40 ms |
| Deep page (cursor near the oldest row) vs. first page | within 20% of each other |
| Uncached `GET /photos` throughput | ≥ 500 req/s |
| Response size for 24 items | < 12 KB uncompressed |

`pnpm --filter api db:seed:bulk 10000` generates synthetic photo rows (placeholder filenames, no real files) and random favorites and saves for the demo user. `pnpm --filter api bench` runs the `autocannon` scenarios and prints p50, p95 and p99.

---

## 7. Frontend (React + Ant Design)

### 7.1 Routes and Top Tab Bar

An Ant Design `Tabs` component (`items` API, `centered`, sticky at the top under the header) with three tabs. The active tab is synced to the URL.

| Tab | Route | Visible to | Behavior |
|---|---|---|---|
| **All** | `/` | Everyone | Public gallery of all active photos |
| **Favorite** | `/favorite` | Logged-in users | The user's favorited photos |
| **Save** | `/save` | Logged-in users | The user's saved photos |

- The Favorite and Save tabs are always shown. A guest who clicks either sees a login prompt (the Login modal opens, and on success the app navigates to the tab they clicked). Direct navigation to `/favorite` or `/save` as a guest shows an `Empty` state with a "Log in" button.
- Header (above the tabs): app title on the left, and on the right either a **Log in** button (guest) or the username with a dropdown (**Log out**) for logged-in users. Admins see an **Admin** badge.

### 7.2 Login
- Ant Design `Modal` with a `Form` (username, password). Submit calls `POST /auth/login`.
- On success: store the token, fetch `/auth/me`, close the modal, and show a success `message`.
- On `401`: show an inline error alert, "Invalid username or password".
- Token storage: `localStorage` (key `pw_token`), attached by an Axios request interceptor. A response interceptor clears the session on `401` and reopens the login modal. (Tradeoff: `localStorage` is exposed to XSS. Acceptable for this app's threat model. Use httpOnly cookies if the scope grows.)
- The login form shows a small hint line in dev builds only (`import.meta.env.DEV`): "Demo: demo / password".

### 7.3 Gallery Grid

- Photo thumbnails in a responsive grid using Ant Design `Row` and `Col` with `useBreakpoint` (or CSS grid). Cards keep the photo's aspect ratio and lazy load (`loading="lazy"`).
- Clicking a photo opens a **lightbox** using Ant Design `Image.PreviewGroup` in controlled mode (the `items` prop plus `preview.current`), which loads the full `url` while the grid uses `thumbUrl`. Controlled mode is required because the grid is virtualised (7.7), so not every image is mounted. Swipe and arrow-key navigation on supported devices.
- Each card has two icon buttons (hidden for guests, or shown and prompting login on click):
  - **Favorite**: heart icon (`HeartOutlined` / `HeartFilled`).
  - **Save**: bookmark icon (`StarOutlined`/`StarFilled` or `BookOutlined`/`BookFilled`).
- Toggles are optimistic (TanStack Query `onMutate` with rollback on error).
- Pagination: **infinite scroll** over cursor pagination, page size 24 (full design in 7.7).
- States: Ant Design `Skeleton` while loading, `Empty` with helpful copy when a list is empty ("No favorites yet. Tap the heart on any photo."), and `Result` or `Alert` with retry on error.

### 7.4 Admin Features (visible only when `user.role === 'admin'`)

- **Upload button** in the header toolbar (or a floating action button on mobile). Opens a modal with `Upload.Dragger` (multiple, accepts `.jpg,.jpeg,.png,.webp`), client-side checks for type and size (15 MB), optional title and caption, a progress bar, and a success summary.
- **Per-photo admin menu** (`Dropdown` with `MoreOutlined`) on each card:
  - **Delete** (soft): `Popconfirm`, "Move this photo to trash? It can be restored."
  - **Restore** (only on soft-deleted photos).
  - **Delete permanently** (hard): `Modal.confirm` with danger styling, "This permanently deletes the photo and its files. This cannot be undone."
- **Trash filter** on the All tab (admin only): an Ant Design `Segmented` control with `Active | Trash | All` that drives `GET /admin/photos?status=...`. Soft-deleted photos in the admin view are shown dimmed with a "Deleted" `Tag`.
- Admin controls never render for non-admins. The server still enforces roles on every admin endpoint.

### 7.5 Responsive Design

| Device | Breakpoint (antd) | Grid columns | Layout notes |
|---|---|---|---|
| Mobile | `< 576px` (xs) | 2 | Tab bar full width, stretched items; header collapses to icon buttons; upload is a floating button; lightbox fills the viewport |
| Tablet | `576–991px` (sm, md) | 3 | Tab bar centered; side padding 16–24 px |
| Desktop | `≥ 992px` (lg, xl) | 4 (lg), 5 (xl) | Content max width 1280 px, centered; hover reveals card actions |

Requirements:
- Mobile-first CSS. Touch targets are at least 44×44 px. No horizontal scroll at any width from 320 px up.
- On touch devices (`@media (hover: none)`) card actions are always visible, since there is no hover.
- Tab bar stays sticky while scrolling.
- Use `ConfigProvider` for a single theme (a soft, wedding-appropriate palette) and respect `prefers-reduced-motion`.
- Images are served as thumbnails in the grid to keep mobile bandwidth low.

### 7.6 Frontend Environment (`apps/web/.env`)
```
VITE_API_URL=http://localhost:3000/api/v1
VITE_ASSET_URL=http://localhost:3000
```

### 7.7 Infinite Scroll

**Data hook** (one hook, reused by all tabs; `scope` is `all | favorite | save | admin`):
```ts
useInfiniteQuery({
  queryKey: ['photos', scope, status],            // status only used by admin
  queryFn: ({ pageParam }) =>
    api.get(endpointFor(scope), { params: { limit: 24, cursor: pageParam, status } }).then(r => r.data),
  initialPageParam: undefined as string | undefined,
  getNextPageParam: (last) => last.nextCursor ?? undefined,
  staleTime: 30_000,
  gcTime: 10 * 60_000,
  refetchOnWindowFocus: false,    // refetching an infinite query reloads every loaded page, so avoid it
});
```
The flat list shown in the UI is `data.pages.flatMap(p => p.items)`, de-duplicated by `id` as a safety net.

**Trigger**
- A sentinel `<div>` after the grid is watched by an `IntersectionObserver` with `rootMargin: '800px 0px'`, so the next page loads before the user reaches the end. Wrapped in a `useInfiniteSentinel` hook.
- It calls `fetchNextPage()` only when `hasNextPage && !isFetchingNextPage` to prevent double fires.
- A visually hidden "Load more" button (revealed on keyboard focus) is rendered for keyboard and screen-reader users, and is the fallback if `IntersectionObserver` is unavailable.

**States**
- First load: a full grid of `Skeleton` cards.
- Loading more: one row of skeleton cards at the bottom.
- End of list: a plain `Divider` reading "You've reached the end" (shown only when `!hasNextPage` and at least one photo is loaded).
- Next-page error: an inline "Couldn't load more photos. Retry" button. Already loaded photos stay on screen.
- Empty: the tab-specific `Empty` state from 7.3.

**Virtualisation (keeps the DOM small)**
- Use `useWindowVirtualizer` from `@tanstack/react-virtual` over **rows**. Items per row is the column count for the current breakpoint (xs 2, sm/md 3, lg 4, xl 5, as in 7.5), recomputed when the breakpoint changes.
- Row height comes from the stored `width` and `height` of each photo (aspect ratio) and the column width, so there is no layout shift when images load. Overscan is 3 rows.
- Result: after scrolling through hundreds of photos only the rows near the viewport exist in the DOM.

**Lightbox integration**
- The lightbox `items` are all loaded photos. When the viewer reaches within 4 items of the end (`current >= items.length - 4`), call `fetchNextPage()` so swiping through photos keeps going.

**Image loading**
- `loading="lazy"` and `decoding="async"` on thumbnails; the first row uses `fetchPriority="high"` instead of lazy. Each card has a fixed aspect-ratio box and a neutral background color while the image loads.

**Cache, scroll position and mutations**
- Each tab keeps its own cached pages (TanStack Query), so switching tabs does not refetch. The scroll offset of each tab is saved on leave and restored with `window.scrollTo` on return.
- **Favorite / Save toggles** (optimistic): update every cached list in place with `queryClient.setQueriesData({ queryKey: ['photos'] }, updater)`, which maps over `pages[].items`. Rollback on error.
  - Un-favoriting (or un-saving) while on that tab removes the item from that tab's cached pages.
  - Favoriting adds nothing to the Favorite tab's cache. Instead mark `['photos','favorite']` stale with `refetchType: 'none'`, so it refetches fresh when that tab is next opened.
- **Admin upload:** `resetQueries(['photos'])` so lists restart from the first page and the new photos appear at the top.
- **Admin soft or hard delete, and restore:** remove (or update) the item in cached pages locally, with no full refetch.
- **Login / logout:** `queryClient.clear()`, because the per-user flags and the Favorite and Save lists change.
- Because paging uses cursors (6.6), photos uploaded or deleted while the user is scrolling cause no duplicate or skipped items.

---

## 8. API Documentation (Mintlify)

- Lives in `docs/`. Run locally with `npx mint dev` (Mintlify CLI) from the `docs/` folder.
- The API reference is generated from `docs/openapi.json`, produced by `pnpm --filter api openapi:export`, so docs stay in sync with the code.

**`docs/docs.json` (starting point)**
```json
{
  "$schema": "https://mintlify.com/docs.json",
  "theme": "mint",
  "name": "Pre-Wedding View API",
  "colors": { "primary": "#C2185B" },
  "navigation": {
    "tabs": [
      {
        "tab": "Guides",
        "groups": [
          { "group": "Getting started", "pages": ["introduction", "quickstart"] },
          { "group": "Concepts", "pages": ["authentication", "pagination", "errors"] }
        ]
      },
      {
        "tab": "API Reference",
        "openapi": "openapi.json"
      }
    ]
  }
}
```

Required pages:
- `introduction.mdx`: what the API does, base URL, roles.
- `quickstart.mdx`: `curl` flow of login, then list photos, then favorite one. Uses the demo credentials and clearly marks them as development-only.
- `authentication.mdx`: JWT usage, token lifetime, the `Authorization` header, role matrix.
- `pagination.mdx`: cursor pagination (`limit`, `cursor`, `nextCursor`, `hasMore`), why there is no `total`, and a `curl` loop that walks every page.
- `errors.mdx`: the error shape and status code table (400, 401, 403, 404, 413, 429).
- Every operation in the OpenAPI spec has a summary, description, request and response examples, and the bearer security scheme.
- Verify the exact `docs.json` keys against the current Mintlify docs when scaffolding, because the schema evolves.

---

## 9. Quality, Security and Acceptance

### 9.1 Security Checklist
- [ ] Passwords hashed with bcrypt; login errors do not leak whether the username exists.
- [ ] `JWT_SECRET` from env; the app refuses to boot without it.
- [ ] Admin routes protected by `JwtAuthGuard` + `RolesGuard`, not only hidden in the UI.
- [ ] Upload validates type by magic bytes, enforces size limits, and uses server-generated filenames (no path traversal).
- [ ] Login rate limited; CORS restricted; `helmet` enabled.
- [ ] Soft-deleted photos are not returned by any public endpoint, and their files return `404` publicly (soft delete moves the files to `uploads/.trash/`, outside the public static path). Note: a browser or CDN that already cached an immutable file may keep serving it until its cache entry expires.
- [ ] Cursors are validated (shape and types); a malformed cursor returns `400` and never reaches SQL as raw input.
- [ ] `limit` is clamped to 1-60 server-side.
- [ ] Demo seed is blocked in production by default.

### 9.2 Testing
- **API (Jest + Supertest, in-memory or temp SQLite):**
  - login success and failure;
  - guest vs. user vs. admin access on every protected route (`401`/`403` cases);
  - favorite and save are idempotent;
  - soft delete hides the photo from public, favorites and saves, and restore brings it back;
  - hard delete removes the row, the files, and the favorite and save rows;
  - upload rejects a non-image renamed to `.jpg`;
  - cursor pagination walks every page with no duplicates or gaps, including when photos are uploaded or soft-deleted between page requests;
  - `limit` over 60 is clamped, and a malformed `cursor` returns `400`;
  - `EXPLAIN QUERY PLAN` for each list query uses an index and has no table `SCAN` or temp B-tree sort;
  - guest list cache is invalidated immediately after upload, soft delete, restore and hard delete;
  - soft delete moves files to `uploads/.trash/` and the original URL returns `404`; restore makes it `200` again.
- **Web (Vitest + React Testing Library):** tab switching and guest login prompt; optimistic toggle with rollback; admin controls hidden for the `demo` user; infinite scroll (mock `IntersectionObserver`) fetches the next page once, shows the end-of-list message, and shows a retry button on next-page failure without clearing loaded photos.
- **Performance:** run `pnpm --filter api bench` against the 10,000-photo seed and compare with the budgets in 6.7.6.
- **Manual responsive pass** at 360, 768 and 1280 px widths.

### 9.3 Acceptance Criteria
1. A guest can open the site, see the **All / Favorite / Save** tabs, and browse photos in the **All** tab without logging in.
2. A guest clicking **Favorite** or **Save** is prompted to log in; after logging in as `demo` / `password` they land on the tab they chose.
3. As `demo`, hearting or bookmarking a photo updates the icon immediately; the photo then appears under **Favorite** or **Save**, and persists across reload.
4. As `demo`, no upload or delete controls appear, and calling `/admin/*` directly returns `403`.
5. As `admin` / `password`, the admin can upload multiple photos, see them in the gallery, soft delete one (it vanishes for guests and users), view it in **Trash**, restore it, and hard delete it (it cannot be restored and its files are gone).
6. The layout works without horizontal scrolling or overlap on mobile (360 px), tablet (768 px) and desktop (1280 px).
7. `npx mint dev` serves docs whose API reference matches the running API.
8. Scrolling down the **All** tab automatically loads further pages before the end is reached, with no duplicate or missing photos, even if an admin uploads or deletes photos between loads. The same works on **Favorite** and **Save**.
9. With 10,000 seeded photos, first-page and deep-page list requests meet the budgets in 6.7.6, and every list query plan uses an index.
10. After scrolling through 500 photos, no more than about 400 photo cards are mounted in the DOM (virtualisation), and the lightbox can still swipe through all loaded photos and load more near the end.

---

## 10. Delivery Plan

| Milestone | Deliverables |
|---|---|
| M1: Backend foundation | Nest app, Drizzle schema and migrations, seed script, login and JWT, guards |
| M2: Photo features | Public list and detail, favorites, saves, admin upload, soft delete, restore, hard delete, **cursor pagination, indexes, SQLite tuning, caching headers** |
| M3: Frontend | Vite app, auth context, tab bar, gallery grid, lightbox, favorite and save toggles, **infinite scroll and virtualised grid** |
| M4: Admin UI and polish | Upload modal, admin menu, Trash filter, responsive tuning, empty and error states |
| M5: Docs, tests and performance | OpenAPI export, Mintlify site, API and web tests, query-plan checks, bulk seed and `autocannon` benchmark against the 6.7.6 budgets, README |

### 10.1 Local Development Commands
```bash
pnpm install
pnpm --filter api db:generate        # drizzle-kit generate
pnpm --filter api db:migrate         # apply migrations
pnpm --filter api db:seed            # demo + admin users
pnpm --filter api db:seed:bulk 10000 # synthetic photos + favorites/saves for perf testing, then runs ANALYZE
pnpm --filter api bench              # autocannon list-endpoint benchmark
pnpm --filter api start:dev          # http://localhost:3000 (Swagger at /api/docs)
pnpm --filter web dev                # http://localhost:5173
pnpm --filter api openapi:export     # writes docs/openapi.json
cd docs && npx mint dev              # Mintlify docs preview
```

### 10.2 Future Work
- Object storage (S3 or R2) and a CDN for images.
- Refresh tokens and httpOnly cookie sessions.
- Albums, captions search, download or share links, and user management UI.
