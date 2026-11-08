import { HttpException, HttpStatus, Injectable } from '@nestjs/common';

export const MAX_FAILURES = 5;
export const WINDOW_MS = 15 * 60_000;
export const LOCK_MS = 15 * 60_000;

interface Entry {
  failures: number[]; // timestamps inside the window
  lockedUntil: number;
}

/**
 * Per (username, IP) brute-force lock: MAX_FAILURES failed logins within WINDOW_MS lock that pair
 * for LOCK_MS. Keyed by the pair (not the username alone) so an attacker can't lock the real admin
 * out from another network. In-memory: a restart clears it, which is fine for a single process.
 */
@Injectable()
export class LoginGuardService {
  private readonly entries = new Map<string, Entry>();

  private key(username: string, ip: string | undefined) {
    return `${username.trim().toLowerCase()}|${ip ?? '?'}`;
  }

  /** Throws 429 while the pair is locked. */
  assertNotLocked(username: string, ip: string | undefined, now = Date.now()) {
    const entry = this.entries.get(this.key(username, ip));
    if (entry && entry.lockedUntil > now) {
      const minutes = Math.ceil((entry.lockedUntil - now) / 60_000);
      throw new HttpException(
        `Too many failed attempts. Try again in ${minutes} minute${minutes === 1 ? '' : 's'}.`,
        HttpStatus.TOO_MANY_REQUESTS,
      );
    }
  }

  /** Records a failure; returns the failure count in the window and whether this one caused a lock. */
  recordFailure(username: string, ip: string | undefined, now = Date.now()): { count: number; locked: boolean } {
    const k = this.key(username, ip);
    const entry = this.entries.get(k) ?? { failures: [], lockedUntil: 0 };
    entry.failures = entry.failures.filter((t) => now - t < WINDOW_MS);
    entry.failures.push(now);
    const locked = entry.failures.length >= MAX_FAILURES;
    if (locked) {
      entry.lockedUntil = now + LOCK_MS;
      entry.failures = [];
    }
    this.entries.set(k, entry);
    if (this.entries.size > 10_000) this.prune(now);
    return { count: locked ? MAX_FAILURES : entry.failures.length, locked };
  }

  recordSuccess(username: string, ip: string | undefined) {
    this.entries.delete(this.key(username, ip));
  }

  private prune(now: number) {
    for (const [k, e] of this.entries) {
      if (e.lockedUntil <= now && e.failures.every((t) => now - t >= WINDOW_MS)) this.entries.delete(k);
    }
  }
}
