import { describe, expect, it } from 'vitest';
import { isLeaseIdle } from '../src/chrome/browser-session-coordinator';

const lease = (claimedAt: number, lastUsedAt?: number) => ({
  session_id: 's1',
  turn_id: null,
  origin: 'user' as const,
  claimed_at: claimedAt,
  ...(lastUsedAt === undefined ? {} : { last_used_at: lastUsedAt }),
});

describe('lease idle timeout', () => {
  it('keeps a lease that was used recently', () => {
    const now = 1_000_000;
    expect(isLeaseIdle(lease(now - 60_000, now - 60_000), now)).toBe(false);
  });

  it('expires a lease that has been idle past the timeout', () => {
    const now = 1_000_000;
    expect(isLeaseIdle(lease(now - 31 * 60_000, now - 31 * 60_000), now)).toBe(true);
  });

  it('falls back to the claim time for leases written before last_used_at existed', () => {
    const now = 1_000_000;
    expect(isLeaseIdle(lease(now - 31 * 60_000), now)).toBe(true);
    expect(isLeaseIdle(lease(now - 60_000), now)).toBe(false);
  });
});
