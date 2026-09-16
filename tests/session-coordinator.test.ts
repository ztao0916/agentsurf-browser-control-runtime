import { describe, expect, it } from 'vitest';
import { groupTitleFor, isLeaseIdle } from '../src/chrome/browser-session-coordinator';

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

describe('session group title', () => {
  it('shortens an unnamed session id so conversations are distinguishable', () => {
    expect(groupTitleFor({ session_id: 'mcp_4f2a91b7-9e10-4c8d-9f31-8c77b41e9d2a', name: null }))
      .toBe('AI · 9D2A');
  });

  it('prefers an explicit name', () => {
    expect(groupTitleFor({ session_id: 'mcp_whatever', name: '禅道排查' })).toBe('禅道排查');
  });

  it('falls back when the id has no usable characters', () => {
    expect(groupTitleFor({ session_id: '----', name: null })).toBe('AI Browser');
  });
});
