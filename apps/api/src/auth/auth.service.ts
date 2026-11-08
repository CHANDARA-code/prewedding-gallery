import { Inject, Injectable, UnauthorizedException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import * as bcrypt from 'bcrypt';
import { eq } from 'drizzle-orm';
import { DRIZZLE } from '../db/db.module';
import type { Db } from '../db/client';
import { users } from '../db/schema';
import { APP_CONFIG, AppConfig } from '../config/env';
import type { AuthUser } from './decorators/current-user.decorator';
import type { LoginResponseDto } from './dto/login.dto';
import { effectivePermissions, parsePermissions } from './permissions';

/** Thrown on bad credentials; `reason` is for alerts only and never reaches the client. */
export class LoginFailedException extends UnauthorizedException {
  constructor(readonly reason: 'unknown_user' | 'wrong_password' | 'disabled') {
    super('Invalid username or password');
  }
}

// Compared against when the username doesn't exist, so both paths cost one bcrypt check.
const DUMMY_HASH = bcrypt.hashSync('not-a-real-password', 10);

/** Converts "1h" / "30m" / "3600" style TTLs to seconds. */
export function ttlSeconds(ttl: string): number {
  const m = /^(\d+)\s*([smhd]?)$/.exec(ttl.trim());
  if (!m) return 3600;
  const n = Number(m[1]);
  return n * ({ '': 1, s: 1, m: 60, h: 3600, d: 86400 } as Record<string, number>)[m[2]];
}

@Injectable()
export class AuthService {
  constructor(
    @Inject(DRIZZLE) private readonly db: Db,
    @Inject(APP_CONFIG) private readonly config: AppConfig,
    private readonly jwt: JwtService,
  ) {}

  async login(username: string, password: string): Promise<LoginResponseDto> {
    // Usernames are stored lowercase; phones often capitalise the first letter.
    const user = this.db.select().from(users).where(eq(users.username, username.trim().toLowerCase())).get();
    const ok = await bcrypt.compare(password, user?.passwordHash ?? DUMMY_HASH);
    if (!user) throw new LoginFailedException('unknown_user');
    if (!ok) throw new LoginFailedException('wrong_password');
    // Checked after the password so a disabled account looks like any other failure to guessers.
    if (user.disabled) throw new LoginFailedException('disabled');
    this.db.update(users).set({ lastLoginAt: new Date() }).where(eq(users.id, user.id)).run();
    const expiresIn = ttlSeconds(this.config.jwtExpiresIn);
    const accessToken = await this.jwt.signAsync(
      { sub: user.id, username: user.username, role: user.role, ver: user.tokenVersion },
      { expiresIn },
    );
    return {
      accessToken,
      tokenType: 'Bearer',
      expiresIn,
      user: { id: user.id, username: user.username, role: user.role, permissions: effectivePermissions(user.role, parsePermissions(user.permissions)) },
    };
  }

  /** The JWT strategy already loaded the user fresh from the database. */
  me(authUser: AuthUser) {
    return { id: authUser.id, username: authUser.username, role: authUser.role, permissions: authUser.permissions };
  }
}
