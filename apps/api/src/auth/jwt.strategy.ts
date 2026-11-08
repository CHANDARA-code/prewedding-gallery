import { Inject, Injectable, UnauthorizedException } from '@nestjs/common';
import { PassportStrategy } from '@nestjs/passport';
import { ExtractJwt, Strategy } from 'passport-jwt';
import { eq } from 'drizzle-orm';
import { APP_CONFIG, AppConfig } from '../config/env';
import { DRIZZLE } from '../db/db.module';
import type { Db } from '../db/client';
import { users } from '../db/schema';
import { effectivePermissions, parsePermissions } from './permissions';
import type { AuthUser } from './decorators/current-user.decorator';

export interface JwtPayload {
  sub: number;
  username: string;
  role: AuthUser['role'];
  /** users.token_version at sign-in; tokens minted before this column existed have none (= 0). */
  ver?: number;
}

@Injectable()
export class JwtStrategy extends PassportStrategy(Strategy) {
  constructor(
    @Inject(APP_CONFIG) config: AppConfig,
    @Inject(DRIZZLE) private readonly db: Db,
  ) {
    super({
      jwtFromRequest: ExtractJwt.fromAuthHeaderAsBearerToken(),
      ignoreExpiration: false,
      secretOrKey: config.jwtSecret,
      algorithms: ['HS256'],
    });
  }

  /**
   * One primary-key lookup per authenticated request, so role/permission changes apply at once
   * and disabling an account or resetting its password ends its existing sessions.
   */
  validate(payload: JwtPayload): AuthUser {
    const u = this.db
      .select({ id: users.id, username: users.username, role: users.role, permissions: users.permissions, disabled: users.disabled, tokenVersion: users.tokenVersion })
      .from(users)
      .where(eq(users.id, payload.sub))
      .get();
    if (!u || u.disabled || u.tokenVersion !== (payload.ver ?? 0)) throw new UnauthorizedException('Session expired, please log in again');
    return { id: u.id, username: u.username, role: u.role, permissions: effectivePermissions(u.role, parsePermissions(u.permissions)) };
  }
}
