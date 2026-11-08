import { HttpException } from '@nestjs/common';
import { LOCK_MS, LoginGuardService, MAX_FAILURES, WINDOW_MS } from '../src/auth/login-guard.service';

describe('LoginGuardService', () => {
  it('locks a username+IP pair after MAX_FAILURES and unlocks after LOCK_MS', () => {
    const g = new LoginGuardService();
    const t0 = 1_000_000;
    for (let i = 1; i < MAX_FAILURES; i++) expect(g.recordFailure('Admin', '1.2.3.4', t0 + i)).toEqual({ count: i, locked: false });
    expect(g.recordFailure('admin', '1.2.3.4', t0 + 10)).toEqual({ count: MAX_FAILURES, locked: true });
    expect(() => g.assertNotLocked('ADMIN', '1.2.3.4', t0 + 20)).toThrow(HttpException);
    // Other IPs are unaffected, so a remote attacker can't lock the real admin out.
    expect(() => g.assertNotLocked('admin', '5.6.7.8', t0 + 20)).not.toThrow();
    expect(() => g.assertNotLocked('admin', '1.2.3.4', t0 + 10 + LOCK_MS)).not.toThrow();
  });

  it('forgets failures outside the window and on success', () => {
    const g = new LoginGuardService();
    g.recordFailure('u', 'ip', 0);
    expect(g.recordFailure('u', 'ip', WINDOW_MS + 1).count).toBe(1);
    g.recordSuccess('u', 'ip');
    expect(g.recordFailure('u', 'ip', WINDOW_MS + 2).count).toBe(1);
  });
});
