import { afterEach, describe, expect, it, vi } from 'vitest';
import { ChromeBrowserSessionCoordinator, groupTitleFor, isLeaseIdle } from '../src/chrome/browser-session-coordinator';

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

const GROUP_ID = 42;

/** Stands in for the browser: one stored session owning two grouped tabs. */
function stubChrome(storedLeases: unknown[]): { ungroup: ReturnType<typeof vi.fn> } {
  const ungroup = vi.fn(() => Promise.resolve());
  const listener = { addListener: () => undefined };
  vi.stubGlobal('chrome', {
    storage: {
      local: {
        get: () => ({ browserControlSessions: [{ session_id: 's1', name: null, tab_ids: [11, 12], group_id: GROUP_ID }] }),
        set: () => undefined,
      },
      session: { get: () => ({ browserControlTabLeases: storedLeases }), set: () => undefined },
    },
    tabs: {
      get: (tabId: number) => Promise.resolve({ id: tabId, groupId: GROUP_ID }),
      ungroup,
      onRemoved: listener,
      onReplaced: listener,
      onCreated: listener,
    },
    tabGroups: { onRemoved: listener },
  });
  return { ungroup };
}

const storedLease = (tabId: number) => ({ tab_id: tabId, lease: lease(Date.now(), Date.now()) });

describe('startup cleanup of groups whose lease is gone', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('ungroups the tabs when a reload cleared storage.session and left the groups behind', async () => {
    const { ungroup } = stubChrome([]);
    await new ChromeBrowserSessionCoordinator().listLeases();
    expect(ungroup.mock.calls.map((call: unknown[]) => call[0])).toEqual([11, 12]);
  });

  it('leaves the group alone while the session still holds its leases', async () => {
    const { ungroup } = stubChrome([storedLease(11), storedLease(12)]);
    await new ChromeBrowserSessionCoordinator().listLeases();
    expect(ungroup).not.toHaveBeenCalled();
  });
});
