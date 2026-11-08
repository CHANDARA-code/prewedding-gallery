import { sqliteTable, text, integer, primaryKey, index } from 'drizzle-orm/sqlite-core';
import { sql } from 'drizzle-orm';

export const users = sqliteTable('users', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  username: text('username').notNull().unique(),
  passwordHash: text('password_hash').notNull(),
  role: text('role', { enum: ['user', 'admin'] }).notNull().default('user'),
  // JSON array of extra actions granted to a `user` (admins always have every permission).
  permissions: text('permissions').notNull().default('[]'),
  disabled: integer('disabled', { mode: 'boolean' }).notNull().default(false),
  // Bumped on password reset / disable; tokens carrying an older version stop working.
  tokenVersion: integer('token_version').notNull().default(0),
  lastLoginAt: integer('last_login_at', { mode: 'timestamp' }),
  createdAt: integer('created_at', { mode: 'timestamp' }).notNull().default(sql`(unixepoch())`),
});

export const photos = sqliteTable(
  'photos',
  {
    id: integer('id').primaryKey({ autoIncrement: true }),
    title: text('title'),
    caption: text('caption'),
    filename: text('filename').notNull(), // stored original, e.g. 8f2c...jpg
    thumbFilename: text('thumb_filename').notNull(),
    // 2048px WebP shown in the viewer (orientation + rotation applied). NULL until backfilled.
    previewFilename: text('preview_filename'),
    originalName: text('original_name'), // the uploader's file name, e.g. KSNT0990.jpg
    sourceArchive: text('source_archive'), // zip the photo was imported from, e.g. A.zip (NULL = web upload)
    rotation: integer('rotation').notNull().default(0), // admin rotation on top of EXIF: 0/90/180/270
    exif: text('exif'), // JSON: camera/lens/exposure fields only (no GPS, no serial numbers)
    mimeType: text('mime_type').notNull(),
    sizeBytes: integer('size_bytes').notNull(),
    width: integer('width').notNull(), // displayed size, after orientation and rotation
    height: integer('height').notNull(),
    uploadedBy: integer('uploaded_by').notNull().references(() => users.id),
    createdAt: integer('created_at', { mode: 'timestamp' }).notNull().default(sql`(unixepoch())`),
    deletedAt: integer('deleted_at', { mode: 'timestamp' }), // NULL = active, set = soft-deleted
  },
  (t) => [
    // Public/guest list: `WHERE deleted_at IS NULL ORDER BY id DESC`. Partial index only holds
    // active rows, so it stays small and is scanned newest-first with no sort step.
    index('photos_active_idx').on(t.id).where(sql`${t.deletedAt} IS NULL`),
    // Admin "Trash" view: `WHERE deleted_at IS NOT NULL ORDER BY id DESC`.
    index('photos_trash_idx').on(t.id).where(sql`${t.deletedAt} IS NOT NULL`),
  ],
);

export const favorites = sqliteTable(
  'favorites',
  {
    userId: integer('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
    photoId: integer('photo_id').notNull().references(() => photos.id, { onDelete: 'cascade' }),
    createdAt: integer('created_at', { mode: 'timestamp' }).notNull().default(sql`(unixepoch())`),
  },
  (t) => [
    primaryKey({ columns: [t.userId, t.photoId] }), // also serves the isFavorite point lookups
    // Keyset list: `WHERE user_id = ? AND (created_at, photo_id) < (?, ?) ORDER BY created_at DESC, photo_id DESC`.
    // SQLite scans this index backwards, so no DESC index or sort step is needed.
    index('favorites_user_list_idx').on(t.userId, t.createdAt, t.photoId),
    // Makes the ON DELETE CASCADE from a hard-deleted photo an index seek instead of a table scan.
    index('favorites_photo_idx').on(t.photoId),
  ],
);

export const saves = sqliteTable(
  'saves',
  {
    userId: integer('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
    photoId: integer('photo_id').notNull().references(() => photos.id, { onDelete: 'cascade' }),
    createdAt: integer('created_at', { mode: 'timestamp' }).notNull().default(sql`(unixepoch())`),
  },
  (t) => [
    primaryKey({ columns: [t.userId, t.photoId] }), // also serves the isSaved point lookups
    index('saves_user_list_idx').on(t.userId, t.createdAt, t.photoId),
    index('saves_photo_idx').on(t.photoId),
  ],
);

/** Curated sets of photos (e.g. "Barsat Angkor Wat") that admins put together and anyone can browse. */
export const albums = sqliteTable('albums', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  slug: text('slug').notNull().unique(), // URL name, e.g. barsat-angkor-wat
  name: text('name').notNull(),
  description: text('description'),
  // Explicit cover; NULL (or a photo that is trashed / no longer in the album) = the album's newest photo.
  coverPhotoId: integer('cover_photo_id').references(() => photos.id, { onDelete: 'set null' }),
  hidden: integer('hidden', { mode: 'boolean' }).notNull().default(false), // only album managers see it
  createdBy: integer('created_by').notNull().references(() => users.id),
  createdAt: integer('created_at', { mode: 'timestamp' }).notNull().default(sql`(unixepoch())`),
  updatedAt: integer('updated_at', { mode: 'timestamp' }).notNull().default(sql`(unixepoch())`),
});

export const albumPhotos = sqliteTable(
  'album_photos',
  {
    albumId: integer('album_id').notNull().references(() => albums.id, { onDelete: 'cascade' }),
    photoId: integer('photo_id').notNull().references(() => photos.id, { onDelete: 'cascade' }),
    addedBy: integer('added_by').references(() => users.id, { onDelete: 'set null' }),
    addedAt: integer('added_at', { mode: 'timestamp' }).notNull().default(sql`(unixepoch())`),
  },
  (t) => [
    // Album page: `WHERE album_id = ? AND photo_id < ? ORDER BY photo_id DESC` walks this key backwards.
    primaryKey({ columns: [t.albumId, t.photoId] }),
    // "Which albums is this photo in" and the cascade from a hard-deleted photo.
    index('album_photos_photo_idx').on(t.photoId),
  ],
);

export type User = typeof users.$inferSelect;
export type Album = typeof albums.$inferSelect;
export type PhotoRow = typeof photos.$inferSelect;
export type Role = User['role'];
