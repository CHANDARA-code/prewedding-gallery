/**
 * Manage accounts from the shell (same rules as the admin Users screen).
 *
 *   pnpm --filter api users list
 *   pnpm --filter api users permissions
 *   pnpm --filter api users create <username> <user|admin> [--grant photos.upload,photos.export]
 *   pnpm --filter api users set <username> [--role user|admin] [--grant a,b | --grant none] [--disable | --enable]
 *   pnpm --filter api users reset-password <username>
 *   pnpm --filter api users delete <username>
 *
 * Passwords come from $NEW_PASSWORD, or a strong one is generated and printed once.
 * Production: cd apps/api && node -r dotenv/config dist/db/users-cli.js <command> dotenv_config_path=.env.production
 */
import 'dotenv/config';
import { openDb, runMigrations } from './client';
import type { Role } from './schema';
import { PERMISSIONS, GRANTABLE_PERMISSIONS } from '../auth/permissions';
import * as core from '../users/users.core';

const USAGE = `Usage:
  users list
  users permissions
  users create <username> <user|admin> [--grant ${GRANTABLE_PERMISSIONS.join(',')}]
  users set <username> [--role user|admin] [--grant a,b|none] [--disable|--enable]
  users reset-password <username>
  users delete <username>
Password: $NEW_PASSWORD, or generated and printed once.`;

function flag(args: string[], name: string): string | undefined {
  const i = args.indexOf(`--${name}`);
  return i >= 0 ? args[i + 1] : undefined;
}
const grantsOf = (v: string | undefined) => (v === undefined ? undefined : v === 'none' ? [] : v.split(',').map((s) => s.trim()).filter(Boolean));

function table(rows: core.UserView[]) {
  const line = (u: core.UserView) =>
    [
      String(u.id).padStart(3),
      u.username.padEnd(16),
      u.role.padEnd(6),
      (u.disabled ? 'disabled' : 'active').padEnd(9),
      (u.lastLoginAt?.slice(0, 16).replace('T', ' ') ?? 'never').padEnd(17),
      u.role === 'admin' ? 'all' : u.grants.join(',') || '-',
    ].join('  ');
  console.log(['id ', 'username'.padEnd(16), 'role  ', 'status   ', 'last login (UTC)'.padEnd(17), 'permissions'].join('  '));
  rows.forEach((u) => console.log(line(u)));
}

async function main() {
  const [cmd, name, ...rest] = process.argv.slice(2);
  const handle = openDb(process.env.DATABASE_URL ?? './data/app.db');
  runMigrations(handle);
  const { db } = handle;
  const byName = () => {
    if (!name) throw new core.UserRuleError('invalid', USAGE);
    const u = core.findByUsername(db, name);
    if (!u) throw new core.UserRuleError('not_found', `No user "${name}"`);
    return u;
  };
  const printPassword = (r: { generatedPassword?: string }) => r.generatedPassword && console.log(`Password: ${r.generatedPassword}`);

  try {
    switch (cmd) {
      case 'list':
        table(core.listUsers(db));
        break;
      case 'permissions':
        for (const [k, label] of Object.entries(PERMISSIONS)) console.log(`${k.padEnd(14)} ${label}${GRANTABLE_PERMISSIONS.includes(k as never) ? '' : ' (admin only)'}`);
        break;
      case 'create': {
        const role = rest[0] as Role;
        if (!name || !role) throw new core.UserRuleError('invalid', USAGE);
        const r = await core.createUser(db, { username: name, role, password: process.env.NEW_PASSWORD || undefined, grants: grantsOf(flag(rest, 'grant')) });
        console.log(`Created ${r.user.username} (${r.user.role}${r.user.grants.length ? ` + ${r.user.grants.join(', ')}` : ''})`);
        printPassword(r);
        break;
      }
      case 'set': {
        const u = byName();
        const disabled = rest.includes('--disable') ? true : rest.includes('--enable') ? false : undefined;
        const v = core.updateUser(db, null, u.id, { role: flag(rest, 'role') as Role | undefined, grants: grantsOf(flag(rest, 'grant')), disabled });
        table([v]);
        break;
      }
      case 'reset-password': {
        const r = await core.resetPassword(db, byName().id, process.env.NEW_PASSWORD || undefined);
        console.log(`Password reset for ${r.user.username}; their existing sessions are signed out.`);
        printPassword(r);
        break;
      }
      case 'delete':
        console.log(`Deleted ${core.deleteUser(db, null, byName().id).username}`);
        break;
      default:
        console.log(USAGE);
        process.exitCode = cmd ? 1 : 0;
    }
  } catch (err) {
    console.error(err instanceof Error ? err.message : err);
    process.exitCode = 1;
  } finally {
    handle.sqlite.close();
  }
}

void main();
