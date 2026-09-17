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

interface GroupingStub {
  update: ReturnType<typeof vi.fn>;
}

/** One stored session with no group yet, ready to be titled by its first claimed tab. */
function stubGrouping(options: { name?: string | null; groupId?: number | null; pageTitle?: string } = {}): GroupingStub {
  const update = vi.fn(() => Promise.resolve());
  const listener = { addListener: () => undefined };
  vi.stubGlobal('chrome', {
    storage: {
      local: {
        get: () => ({
          browserControlSessions: [
            { session_id: 's1', name: options.name ?? null, tab_ids: [], group_id: options.groupId ?? null },
          ],
        }),
        set: () => undefined,
      },
      session: { get: () => ({ browserControlTabLeases: [] }), set: () => undefined },
    },
    tabs: {
      get: (tabId: number) => Promise.resolve({
        id: tabId,
        groupId: -1,
        ...(options.pageTitle === undefined ? {} : { title: options.pageTitle }),
      }),
      group: () => Promise.resolve(GROUP_ID),
      ungroup: vi.fn(() => Promise.resolve()),
      onRemoved: listener,
      onReplaced: listener,
      onCreated: listener,
    },
    tabGroups: {
      get: () => Promise.resolve({ id: GROUP_ID }),
      update,
      onRemoved: listener,
    },
  });
  return { update };
}

describe('naming a group from the page it started on', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('titles a new group after the first page instead of a generated id', async () => {
    const { update } = stubGrouping({ pageTitle: '禅道 - 任务 17824' });

    await new ChromeBrowserSessionCoordinator().claim('s1', undefined, 11, 'user', true);

    expect(update.mock.calls[0]?.[1]).toMatchObject({ title: '禅道 - 任务 17824' });
  });

  it('falls back to the generated title when the page has none', async () => {
    const { update } = stubGrouping();

    await new ChromeBrowserSessionCoordinator().claim('s1', undefined, 11, 'user', true);

    expect(update.mock.calls[0]?.[1]).toMatchObject({ title: 'AI · S1' });
  });

  it('keeps an explicit name rather than the page title', async () => {
    const { update } = stubGrouping({ name: '禅道排查', pageTitle: '禅道 - 任务 17824' });

    await new ChromeBrowserSessionCoordinator().claim('s1', undefined, 11, 'user', true);

    expect(update.mock.calls[0]?.[1]).toMatchObject({ title: '禅道排查' });
  });
});

describe('renaming an existing group', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('retitles the group when the conversation names itself after the group exists', async () => {
    const { update } = stubGrouping({ groupId: GROUP_ID, pageTitle: '禅道 - 任务 17824' });

    await new ChromeBrowserSessionCoordinator().start('s1', '禅道 17824');

    expect(update.mock.calls.map((call: unknown[]) => call[1])).toEqual([{ title: '禅道 17824' }]);
  });

  it('leaves the group alone when the name has not changed', async () => {
    const { update } = stubGrouping({ name: '禅道排查', groupId: GROUP_ID });

    await new ChromeBrowserSessionCoordinator().start('s1', '禅道排查');

    expect(update).not.toHaveBeenCalled();
  });
});
