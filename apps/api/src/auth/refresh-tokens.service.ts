import { Inject, Injectable, UnauthorizedException } from '@nestjs/common';
import { createHash, randomBytes } from 'crypto';
import { and, eq, isNull, lt, or } from 'drizzle-orm';
import { DRIZZLE } from '../db/db.module';
import type { Db } from '../db/client';
import { refreshTokens, users } from '../db/schema';
import { APP_CONFIG, AppConfig } from '../config/env';

/**
 * How long a just-rotated token is still accepted. Two tabs (or a retried request) can present the
 * same token at once; the late one gets its own successor instead of being treated as a replay.
 */
export const ROTATION_GRACE_MS = 60_000;

export type SessionUser = typeof users.$inferSelect;

export interface IssuedRefresh {
  token: string;
  expiresAt: Date;
  remember: boolean;
}

const hash = (token: string) => createHash('sha256').update(token).digest('hex');

export class RefreshFailedException extends UnauthorizedException {
  constructor() {
    super('Session expired, please log in again');
  }
}

@Injectable()
export class RefreshTokensService {
  constructor(
    @Inject(DRIZZLE) private readonly db: Db,
    @Inject(APP_CONFIG) private readonly config: AppConfig,
  ) {}

  private expiry(remember: boolean, now = Date.now()): Date {
    const ms = remember ? this.config.refreshRememberDays * 86_400_000 : this.config.refreshSessionHours * 3_600_000;
    return new Date(now + ms);
  }

  private insert(user: SessionUser, family: string, remember: boolean, userAgent?: string): IssuedRefresh & { id: number } {
    const token = randomBytes(32).toString('base64url');
    const expiresAt = this.expiry(remember);
    const row = this.db
      .insert(refreshTokens)
      .values({
        userId: user.id,
        tokenHash: hash(token),
        family,
        tokenVersion: user.tokenVersion,
        remember,
        userAgent: userAgent?.slice(0, 255) ?? null,
        expiresAt,
      })
      .returning({ id: refreshTokens.id })
      .get();
    return { id: row.id, token, expiresAt, remember };
  }

  /** Starts a new session at sign-in. */
  issue(user: SessionUser, remember: boolean, userAgent?: string): IssuedRefresh {
    this.prune();
    const { token, expiresAt } = this.insert(user, randomBytes(12).toString('base64url'), remember, userAgent);
    return { token, expiresAt, remember };
  }

  /**
   * Exchanges a refresh token for a new one (rotation) and returns the session's user. Replaying a
   * token that was rotated more than ROTATION_GRACE_MS ago ends the whole session, since one of the
   * two holders is not the real user.
   */
  rotate(token: string, userAgent?: string): { user: SessionUser; refresh: IssuedRefresh } {
    // better-sqlite3 is synchronous, so nothing else runs between these reads and writes.
    const row = this.db.select().from(refreshTokens).where(eq(refreshTokens.tokenHash, hash(token))).get();
    if (!row) throw new RefreshFailedException();
    const now = Date.now();
    if (row.revokedAt) {
      const inGrace = row.replacedById !== null && now - row.revokedAt.getTime() < ROTATION_GRACE_MS;
      if (!inGrace) {
        this.revokeFamily(row.family);
        throw new RefreshFailedException();
      }
    }
    if (row.expiresAt.getTime() <= now) throw new RefreshFailedException();
    const user = this.db.select().from(users).where(eq(users.id, row.userId)).get();
    if (!user || user.disabled || user.tokenVersion !== row.tokenVersion) {
      this.revokeFamily(row.family);
      throw new RefreshFailedException();
    }
    const next = this.db.transaction(() => {
      const issued = this.insert(user, row.family, row.remember, userAgent ?? row.userAgent ?? undefined);
      if (!row.revokedAt) {
        this.db.update(refreshTokens).set({ revokedAt: new Date(now), replacedById: issued.id }).where(eq(refreshTokens.id, row.id)).run();
      }
      return issued;
    });
    return { user, refresh: { token: next.token, expiresAt: next.expiresAt, remember: next.remember } };
  }

  /** Logout: ends the session this token belongs to. Unknown tokens are ignored. */
  revoke(token: string) {
    const row = this.db.select({ family: refreshTokens.family }).from(refreshTokens).where(eq(refreshTokens.tokenHash, hash(token))).get();
    if (row) this.revokeFamily(row.family);
  }

  private revokeFamily(family: string) {
    this.db
      .update(refreshTokens)
      .set({ revokedAt: new Date() })
      .where(and(eq(refreshTokens.family, family), isNull(refreshTokens.revokedAt)))
      .run();
  }

  /** Drops expired rows and rows revoked over a week ago (kept that long for replay detection). */
  private prune() {
    const now = Date.now();
    this.db
      .delete(refreshTokens)
      .where(or(lt(refreshTokens.expiresAt, new Date(now)), lt(refreshTokens.revokedAt, new Date(now - 7 * 86_400_000))))
      .run();
  }
}
