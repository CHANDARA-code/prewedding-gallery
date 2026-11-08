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
    const user = this.db.select().from(users).where(eq(users.username, username)).get();
    const ok = await bcrypt.compare(password, user?.passwordHash ?? DUMMY_HASH);
    if (!user || !ok) throw new UnauthorizedException('Invalid username or password');
    const expiresIn = ttlSeconds(this.config.jwtExpiresIn);
    const accessToken = await this.jwt.signAsync(
      { sub: user.id, username: user.username, role: user.role },
      { expiresIn },
    );
    return {
      accessToken,
      tokenType: 'Bearer',
      expiresIn,
      user: { id: user.id, username: user.username, role: user.role },
    };
  }

  me(authUser: AuthUser) {
    const user = this.db
      .select({ id: users.id, username: users.username, role: users.role })
      .from(users)
      .where(eq(users.id, authUser.id))
      .get();
    if (!user) throw new UnauthorizedException('User no longer exists');
    return user;
  }
}
