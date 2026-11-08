/**
 * User management rules shared by the admin API (UsersService) and the `user:*` CLI scripts,
 * so both enforce the same validation and the "always keep one active admin" rule.
 */
import * as bcrypt from 'bcrypt';
import { randomBytes } from 'crypto';
import { and, count, eq, ne, sql } from 'drizzle-orm';
import type { Db } from '../db/client';
import { photos, users, type Role, type User } from '../db/schema';
import { effectivePermissions, GRANTABLE_PERMISSIONS, isPermission, parsePermissions, type Permission } from '../auth/permissions';

export const ROLES: Role[] = ['user', 'admin'];
export const USERNAME_RE = /^[a-z0-9][a-z0-9._-]{1,31}$/;
export const PASSWORD_MIN = 8;
export const PASSWORD_MAX = 128;
const BCRYPT_COST = 10;

export class UserRuleError extends Error {
  constructor(
    readonly kind: 'not_found' | 'conflict' | 'invalid' | 'forbidden',
    message: string,
  ) {
    super(message);
  }
}

export interface UserView {
  id: number;
  username: string;
  role: Role;
  /** Extra actions granted to a `user` (ignored for admins, who have all of them). */
  grants: Permission[];
  /** What the account can actually do. */
  permissions: Permission[];
  disabled: boolean;
  createdAt: string;
  lastLoginAt: string | null;
  photosUploaded: number;
}

export function toUserView(u: User, photosUploaded = 0): UserView {
  const grants = parsePermissions(u.permissions);
  return {
    id: u.id,
    username: u.username,
    role: u.role,
    grants,
    permissions: effectivePermissions(u.role, grants),
    disabled: u.disabled,
    createdAt: u.createdAt.toISOString(),
    lastLoginAt: u.lastLoginAt ? u.lastLoginAt.toISOString() : null,
    photosUploaded,
  };
}

export function normalizeUsername(raw: string): string {
  const username = raw.trim().toLowerCase();
  if (!USERNAME_RE.test(username)) {
    throw new UserRuleError('invalid', 'Username must be 2-32 characters: letters, digits, dot, dash or underscore, starting with a letter or digit');
  }
  return username;
}

function checkPassword(password: string) {
  if (password.length < PASSWORD_MIN || password.length > PASSWORD_MAX) {
    throw new UserRuleError('invalid', `Password must be ${PASSWORD_MIN}-${PASSWORD_MAX} characters`);
  }
}

function normalizeGrants(list: unknown[] | undefined): Permission[] {
  const bad = (list ?? []).filter((p) => !isPermission(p) || !GRANTABLE_PERMISSIONS.includes(p));
  if (bad.length) throw new UserRuleError('invalid', `Unknown or non-grantable permission: ${bad.join(', ')}`);
  return GRANTABLE_PERMISSIONS.filter((p) => list?.includes(p));
}

/** 16 URL-safe characters (96 bits), easy to paste into a chat. */
export function generatePassword(): string {
  return randomBytes(12).toString('base64url');
}

function find(db: Db, id: number): User {
  const u = db.select().from(users).where(eq(users.id, id)).get();
  if (!u) throw new UserRuleError('not_found', 'User not found');
  return u;
}

function uploadsBy(db: Db, id: number): number {
  return db.select({ n: count() }).from(photos).where(eq(photos.uploadedBy, id)).get()?.n ?? 0;
}

/** Throws unless at least one other enabled admin remains after `id` stops being one. */
function assertAnotherAdmin(db: Db, id: number) {
  const others = db
    .select({ n: count() })
    .from(users)
    .where(and(eq(users.role, 'admin'), eq(users.disabled, false), ne(users.id, id)))
    .get()?.n;
  if (!others) throw new UserRuleError('forbidden', 'This is the last active admin; make another admin first');
}

export function listUsers(db: Db): UserView[] {
  const counts = new Map(
    db
      .select({ id: photos.uploadedBy, n: count() })
      .from(photos)
      .groupBy(photos.uploadedBy)
      .all()
      .map((r) => [r.id, r.n]),
  );
  return db
    .select()
    .from(users)
    .orderBy(sql`${users.role} = 'admin' DESC`, users.username)
    .all()
    .map((u) => toUserView(u, counts.get(u.id) ?? 0));
}

export function getUser(db: Db, id: number): UserView {
  return toUserView(find(db, id), uploadsBy(db, id));
}

export interface CreateUserInput {
  username: string;
  password?: string;
  role: Role;
  grants?: unknown[];
}

/** Returns the new user plus the password when one was generated (shown once, never stored). */
export async function createUser(db: Db, input: CreateUserInput): Promise<{ user: UserView; generatedPassword?: string }> {
  const username = normalizeUsername(input.username);
  if (!ROLES.includes(input.role)) throw new UserRuleError('invalid', 'Role must be user or admin');
  const grants = normalizeGrants(input.grants);
  const generatedPassword = input.password ? undefined : generatePassword();
  const password = input.password ?? generatedPassword!;
  checkPassword(password);
  if (db.select({ id: users.id }).from(users).where(eq(users.username, username)).get()) {
    throw new UserRuleError('conflict', `Username "${username}" is already taken`);
  }
  const passwordHash = await bcrypt.hash(password, BCRYPT_COST);
  const row = db
    .insert(users)
    .values({ username, passwordHash, role: input.role, permissions: JSON.stringify(grants) })
    .returning()
    .get();
  return { user: toUserView(row), generatedPassword };
}

export interface UpdateUserInput {
  role?: Role;
  grants?: unknown[];
  disabled?: boolean;
}

/** `actorId` is the admin making the change (null from the CLI); admins can't demote or disable themselves. */
export function updateUser(db: Db, actorId: number | null, id: number, input: UpdateUserInput): UserView {
  const u = find(db, id);
  if (input.role !== undefined && !ROLES.includes(input.role)) throw new UserRuleError('invalid', 'Role must be user or admin');
  const losesAdmin = u.role === 'admin' && !u.disabled && ((input.role && input.role !== 'admin') || input.disabled === true);
  if (losesAdmin && actorId === id) throw new UserRuleError('forbidden', "You can't remove your own admin access or disable yourself");
  if (input.disabled === true && actorId === id) throw new UserRuleError('forbidden', "You can't disable yourself");
  if (losesAdmin) assertAnotherAdmin(db, id);

  const set: Partial<typeof users.$inferInsert> = {};
  if (input.role !== undefined) set.role = input.role;
  if (input.grants !== undefined) set.permissions = JSON.stringify(normalizeGrants(input.grants));
  if (input.disabled !== undefined && input.disabled !== u.disabled) {
    set.disabled = input.disabled;
    if (input.disabled) set.tokenVersion = u.tokenVersion + 1; // signs the account out everywhere
  }
  if (Object.keys(set).length) db.update(users).set(set).where(eq(users.id, id)).run();
  return getUser(db, id);
}

/** Sets a new password (generated when omitted) and signs the account out of every device. */
export async function resetPassword(db: Db, id: number, password?: string): Promise<{ user: UserView; generatedPassword?: string }> {
  const u = find(db, id);
  const generatedPassword = password ? undefined : generatePassword();
  const pw = password ?? generatedPassword!;
  checkPassword(pw);
  const passwordHash = await bcrypt.hash(pw, BCRYPT_COST);
  db.update(users).set({ passwordHash, tokenVersion: u.tokenVersion + 1 }).where(eq(users.id, id)).run();
  return { user: getUser(db, id), generatedPassword };
}

/** Deletes the account and its favorites/saves. Accounts that uploaded photos must be disabled instead. */
export function deleteUser(db: Db, actorId: number | null, id: number): UserView {
  const u = find(db, id);
  if (actorId === id) throw new UserRuleError('forbidden', "You can't delete your own account");
  if (u.role === 'admin' && !u.disabled) assertAnotherAdmin(db, id);
  const uploaded = uploadsBy(db, id);
  if (uploaded) {
    throw new UserRuleError('conflict', `${u.username} uploaded ${uploaded} photo(s); disable the account instead of deleting it`);
  }
  const view = toUserView(u);
  db.delete(users).where(eq(users.id, id)).run();
  return view;
}

export function findByUsername(db: Db, username: string): User | undefined {
  return db.select().from(users).where(eq(users.username, username.trim().toLowerCase())).get();
}
