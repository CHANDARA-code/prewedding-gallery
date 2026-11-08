/**
 * `pnpm --filter api user:create <username> [user|admin]` creates or resets a real account.
 * The password comes from $NEW_PASSWORD, or a strong random one is generated and printed once.
 */
import 'dotenv/config';
import * as bcrypt from 'bcrypt';
import { randomBytes } from 'crypto';
import { openDb, runMigrations } from './client';
import { users } from './schema';

const [username, role = 'user'] = process.argv.slice(2);
if (!username || !['user', 'admin'].includes(role)) {
  console.error('Usage: user:create <username> [user|admin]   (password from $NEW_PASSWORD or generated)');
  process.exit(1);
}
const password = process.env.NEW_PASSWORD || randomBytes(12).toString('base64url');
const handle = openDb(process.env.DATABASE_URL ?? './data/app.db');
runMigrations(handle);
const passwordHash = bcrypt.hashSync(password, 10);
handle.db
  .insert(users)
  .values({ username, passwordHash, role: role as 'user' | 'admin' })
  .onConflictDoUpdate({ target: users.username, set: { passwordHash, role: role as 'user' | 'admin' } })
  .run();
handle.sqlite.close();
console.log(`User "${username}" (${role}) saved.`);
if (!process.env.NEW_PASSWORD) console.log(`Password: ${password}`);
