import type { Role } from '../db/schema';

/**
 * Actions beyond browsing. Every signed-in account can view, favorite, save, share and download.
 * `admin` always has all of these; a `user` has only the ones granted to them. `users.manage` is
 * admin-only and cannot be granted to a `user`, so only admins can hand out permissions.
 */
export const PERMISSIONS = {
  'photos.upload': 'Upload photos',
  'photos.edit': 'Edit titles/captions and rotate photos',
  'photos.delete': 'Move photos to trash, restore them and see the trash',
  'photos.purge': 'Permanently delete photos',
  'photos.export': 'Export the photo CSV (original file names)',
  'users.manage': 'Create users and change roles, permissions and passwords',
} as const;

export type Permission = keyof typeof PERMISSIONS;
export const ALL_PERMISSIONS = Object.keys(PERMISSIONS) as Permission[];
/** What can be granted to a `user`. */
export const GRANTABLE_PERMISSIONS: Permission[] = ALL_PERMISSIONS.filter((p) => p !== 'users.manage');

export function isPermission(p: unknown): p is Permission {
  return typeof p === 'string' && p in PERMISSIONS;
}

/** Parses the stored JSON column, dropping anything unknown. */
export function parsePermissions(json: string | null | undefined): Permission[] {
  try {
    const v = JSON.parse(json ?? '[]');
    return Array.isArray(v) ? GRANTABLE_PERMISSIONS.filter((p) => v.includes(p)) : [];
  } catch {
    return [];
  }
}

/** The permissions a role + stored grant list actually confer. */
export function effectivePermissions(role: Role, stored: Permission[]): Permission[] {
  return role === 'admin' ? [...ALL_PERMISSIONS] : GRANTABLE_PERMISSIONS.filter((p) => stored.includes(p));
}

export function hasPermission(user: { permissions?: Permission[] } | null | undefined, p: Permission): boolean {
  return !!user?.permissions?.includes(p);
}
