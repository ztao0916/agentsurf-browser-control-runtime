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
  it('prefers the name the agent gave the conversation over the page', () => {
    expect(groupTitleFor({ name: '禅道排查' }, '首页 – Google AdSense')).toBe('禅道排查');
  });

  it('titles an unnamed conversation after the page it holds', () => {
    expect(groupTitleFor({ name: null }, '首页 – Google AdSense')).toBe('首页 – Google AdSense');
  });

  it('cuts a page title that would not fit a tab group label', () => {
    expect(groupTitleFor({ name: null }, 'x'.repeat(50))).toHaveLength(24);
  });

  it('falls back to a neutral title when there is neither a name nor a page', () => {
    expect(groupTitleFor({ name: null })).toBe('AgentSurf');
    expect(groupTitleFor({ name: null }, '   ')).toBe('AgentSurf');
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

/** Stands in for the browser: one unnamed session claiming a single tab, so the title comes from the page. */
function stubGroupingChrome(tab: { title?: string; url?: string }): { titles: string[] } {
  const titles: string[] = [];
  const listener = { addListener: () => undefined };
  vi.stubGlobal('chrome', {
    storage: {
      local: {
        get: () => ({ browserControlSessions: [{ session_id: 's1', name: null, tab_ids: [], group_id: null }] }),
        set: () => undefined,
      },
      session: { get: () => ({ browserControlTabLeases: [] }), set: () => undefined },
    },
    tabs: {
      get: () => Promise.resolve({ id: 11, groupId: 1, ...tab }),
      group: () => Promise.resolve(77),
      ungroup: () => Promise.resolve(),
      onRemoved: listener,
      onReplaced: listener,
      onCreated: listener,
    },
    tabGroups: {
      get: () => Promise.resolve({ id: 77 }),
      update: (_groupId: number, properties: { title?: string }) => {
        titles.push(properties.title ?? '');
        return Promise.resolve();
      },
      onRemoved: listener,
    },
  });
  return { titles };
}

describe('group title taken from the page', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('titles an unnamed conversation after the loaded page', async () => {
    const { titles } = stubGroupingChrome({ title: '首页 – Google AdSense', url: 'https://adsense.google.com/adsense/u/0/home' });
    await new ChromeBrowserSessionCoordinator().claim('s1', undefined, 11, 'user', true);
    expect(titles).toEqual(['首页 – Google AdSense']);
  });

  it('uses the hostname while a tab still reports its URL as the title', async () => {
    const { titles } = stubGroupingChrome({
      title: 'https://adsense.google.com/adsense/u/0/home',
      url: 'https://adsense.google.com/adsense/u/0/home',
    });
    await new ChromeBrowserSessionCoordinator().claim('s1', undefined, 11, 'user', true);
    expect(titles).toEqual(['adsense.google.com']);
  });

  it('retitles the group once the agent names the session', async () => {
    const { titles } = stubGroupingChrome({ title: '首页 – Google AdSense', url: 'https://adsense.google.com/' });
    const coordinator = new ChromeBrowserSessionCoordinator();
    await coordinator.claim('s1', undefined, 11, 'user', true);
    await coordinator.name('s1', 'AdSense 数据核对');
    expect(titles).toEqual(['首页 – Google AdSense', 'AdSense 数据核对']);
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

  it('falls back to the neutral title when the page has none', async () => {
    const { update } = stubGrouping();

    await new ChromeBrowserSessionCoordinator().claim('s1', undefined, 11, 'user', true);

    expect(update.mock.calls[0]?.[1]).toMatchObject({ title: 'AgentSurf' });
  });

  it('keeps an explicit name rather than the page title', async () => {
    const { update } = stubGrouping({ name: '禅道排查', pageTitle: '禅道 - 任务 17824' });

    await new ChromeBrowserSessionCoordinator().claim('s1', undefined, 11, 'user', true);

    expect(update.mock.calls[0]?.[1]).toMatchObject({ title: '禅道排查' });
  });
});

/** One session holding two tabs: 11 was opened by this conversation, 12 is one the user already had. */
function stubResetChrome(): { removed: number[]; ungrouped: number[] } {
  const removed: number[] = [];
  const ungrouped: number[] = [];
  const listener = { addListener: () => undefined };
  const stored = (tabId: number, origin: 'agent' | 'user') => ({
    tab_id: tabId,
    lease: { ...lease(Date.now(), Date.now()), origin },
  });
  vi.stubGlobal('chrome', {
    storage: {
      local: {
        get: () => ({ browserControlSessions: [{ session_id: 's1', name: null, tab_ids: [11, 12], group_id: GROUP_ID }] }),
        set: () => undefined,
      },
      session: {
        get: () => ({ browserControlTabLeases: [stored(11, 'agent'), stored(12, 'user')] }),
        set: () => undefined,
      },
    },
    tabs: {
      get: (tabId: number) => Promise.resolve({ id: tabId, groupId: GROUP_ID }),
      remove: (tabIds: number[]) => {
        removed.push(...tabIds);
        return Promise.resolve();
      },
      ungroup: (tabId: number) => {
        ungrouped.push(tabId);
        return Promise.resolve();
      },
      onRemoved: listener,
      onReplaced: listener,
      onCreated: listener,
    },
    tabGroups: { get: () => Promise.resolve({ id: GROUP_ID }), update: () => Promise.resolve(), onRemoved: listener },
  });
  return { removed, ungrouped };
}

describe('reset closes only what this conversation opened', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('closes the tab this conversation opened and ungroups the user tab instead of closing it', async () => {
    const { removed, ungrouped } = stubResetChrome();
    const result = await new ChromeBrowserSessionCoordinator().reset('s1', false, true);
    expect(removed).toEqual([11]);
    expect(ungrouped).toEqual([12]);
    expect(result.closedTabIds).toEqual([11]);
    expect(result.releasedTabIds.sort()).toEqual([11, 12]);
  });

  it('closes and ungroups nothing when tab closing is declined', async () => {
    const { removed, ungrouped } = stubResetChrome();
    const result = await new ChromeBrowserSessionCoordinator().reset('s1', false, false);
    expect(removed).toEqual([]);
    expect(ungrouped).toEqual([11, 12]);
    expect(result.closedTabIds).toEqual([]);
  });

  it('never closes tabs when force reaches other conversations', async () => {
    const { removed } = stubResetChrome();
    const result = await new ChromeBrowserSessionCoordinator().reset(undefined, true, true);
    expect(removed).toEqual([]);
    expect(result.closedTabIds).toEqual([]);
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
