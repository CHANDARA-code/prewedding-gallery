/** `pnpm --filter api db:seed`: idempotently upserts the demo + admin users (development only). */
import 'dotenv/config';
import * as bcrypt from 'bcrypt';
import { openDb, runMigrations } from './client';
import { users } from './schema';

export const DEMO_USERS = [
  { username: 'demo', password: 'password', role: 'user' as const },
  { username: 'admin', password: 'password', role: 'admin' as const },
];

export function assertSeedAllowed() {
  if (process.env.NODE_ENV === 'production' && process.env.ALLOW_DEMO_SEED !== 'true') {
    throw new Error('Refusing to seed demo credentials with NODE_ENV=production (set ALLOW_DEMO_SEED=true to override).');
  }
}

export function seedUsers(handle: ReturnType<typeof openDb>) {
  for (const u of DEMO_USERS) {
    const passwordHash = bcrypt.hashSync(u.password, 10);
    handle.db
      .insert(users)
      .values({ username: u.username, passwordHash, role: u.role })
      .onConflictDoUpdate({ target: users.username, set: { passwordHash, role: u.role } })
      .run();
  }
}

if (require.main === module) {
  assertSeedAllowed();
  const handle = openDb(process.env.DATABASE_URL ?? './data/app.db');
  runMigrations(handle);
  seedUsers(handle);
  console.log(`Seeded users: ${DEMO_USERS.map((u) => `${u.username} (${u.role})`).join(', ')}`);
  handle.sqlite.close();
}
