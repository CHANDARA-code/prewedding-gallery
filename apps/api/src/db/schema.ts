import { sqliteTable, text, integer, primaryKey, index } from 'drizzle-orm/sqlite-core';
import { sql } from 'drizzle-orm';

export const users = sqliteTable('users', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  username: text('username').notNull().unique(),
  passwordHash: text('password_hash').notNull(),
  role: text('role', { enum: ['user', 'admin'] }).notNull().default('user'),
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
    mimeType: text('mime_type').notNull(),
    sizeBytes: integer('size_bytes').notNull(),
    width: integer('width').notNull(),
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

export type User = typeof users.$inferSelect;
export type PhotoRow = typeof photos.$inferSelect;
export type Role = User['role'];
