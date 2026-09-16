import { createToolError, ToolFailure } from '../core/protocol/errors';
import type { BrowserSessionInfo } from '../core/protocol/tool-contract';
import type { SessionCoordinator, TabClaimOrigin } from '../core/session/session-coordinator';

interface StoredSession {
  session_id: string;
  name: string | null;
  tab_ids: number[];
  group_id: number | null;
}

interface TabLease {
  session_id: string;
  turn_id: string | null;
  origin: TabClaimOrigin;
  claimed_at: number;
  /** Absent on leases written before the idle timeout existed. */
  last_used_at?: number;
}

const SESSIONS_STORAGE_KEY = 'browserControlSessions';
const LEASES_STORAGE_KEY = 'browserControlTabLeases';
const DEFAULT_GROUP_TITLE = 'AI Browser';

/**
 * A conversation can disappear without ending its session (the client is closed, the process is
 * killed), and its leases would then block those tabs forever. Leases therefore expire after this
 * much idle time: the tab is freed and the next session that needs it can take it over.
 */
const LEASE_IDLE_TIMEOUT_MS = 30 * 60 * 1000;
/** Persisting every use would write on each element action; this keeps the stored value fresh enough. */
const LEASE_TOUCH_PERSIST_MS = 60 * 1000;

export function isLeaseIdle(lease: TabLease, now: number): boolean {
  return now - (lease.last_used_at ?? lease.claimed_at) >= LEASE_IDLE_TIMEOUT_MS;
}

export interface SessionTitleSource {
  session_id: string;
  name: string | null;
}

/**
 * An unnamed session still needs a group title the user can tell apart from the other conversations,
 * so the last four characters of its ID are appended (`AI · 9A12`). Sessions created by the MCP
 * layer use a random id, which makes this stable per conversation.
 */
export function groupTitleFor(session: SessionTitleSource): string {
  if (session.name !== null) return session.name;
  const tail = session.session_id.replace(/[^0-9a-zA-Z]/gu, '').slice(-4).toUpperCase();
  return tail.length === 0 ? DEFAULT_GROUP_TITLE : `AI · ${tail}`;
}

export class ChromeBrowserSessionCoordinator implements SessionCoordinator {
  private readonly sessions = new Map<string, StoredSession>();
  private readonly leases = new Map<number, TabLease>();
  private initializePromise: Promise<void> | null = null;
  private mutationQueue: Promise<void> = Promise.resolve();

  public constructor() {
    chrome.tabs.onRemoved.addListener((tabId) => void this.enqueue(() => this.removeTab(tabId)));
    chrome.tabs.onReplaced.addListener((addedTabId, removedTabId) => {
      void this.enqueue(() => this.replaceTab(addedTabId, removedTabId));
    });
    chrome.tabs.onCreated.addListener((tab) => {
      if (tab.id !== undefined && tab.openerTabId !== undefined) {
        void this.enqueue(() => this.claimChildTab(tab.id as number, tab.openerTabId as number));
      }
    });
    chrome.tabGroups.onRemoved.addListener((group) => void this.enqueue(() => this.removeGroup(group.id)));
  }

  public async start(sessionId = crypto.randomUUID(), name?: string): Promise<BrowserSessionInfo> {
    return this.enqueue(async () => {
      const existing = this.sessions.get(sessionId);
      if (existing !== undefined) {
        if (name !== undefined && existing.name !== name) existing.name = normalizeName(name);
        await this.persistSessions();
        return toSessionInfo(existing);
      }
      const session: StoredSession = {
        session_id: sessionId,
        name: name === undefined ? null : normalizeName(name),
        tab_ids: [],
        group_id: null,
      };
      this.sessions.set(sessionId, session);
      await this.persistSessions();
      return toSessionInfo(session);
    });
  }

  public async end(sessionId: string, closeTabs: boolean): Promise<{ releasedTabIds: number[] }> {
    return this.enqueue(async () => {
      const session = this.requireSession(sessionId);
      const tabIds = [...session.tab_ids];
      this.sessions.delete(sessionId);
      for (const tabId of tabIds) this.leases.delete(tabId);
      if (closeTabs && tabIds.length > 0) {
        await chrome.tabs.remove(tabIds).catch(() => undefined);
      } else {
        await this.ungroupManagedTabs(session, tabIds);
      }
      await this.persistAll();
      return { releasedTabIds: tabIds };
    });
  }

  public async name(sessionId: string, name: string): Promise<BrowserSessionInfo> {
    return this.enqueue(async () => {
      const session = this.requireSession(sessionId);
      session.name = normalizeName(name);
      if (session.group_id !== null) {
        await chrome.tabGroups.update(session.group_id, { title: groupTitleFor(session) }).catch(() => undefined);
      }
      await this.persistSessions();
      return toSessionInfo(session);
    });
  }

  public async claim(
    sessionId: string,
    turnId: string | undefined,
    tabId: number,
    origin: TabClaimOrigin,
    group: boolean,
  ): Promise<BrowserSessionInfo> {
    return this.enqueue(async () => {
      await chrome.tabs.get(tabId).catch(() => {
        throw new ToolFailure(createToolError('tab_not_found', `Tab ${tabId} was not found.`, true));
      });
      const session = this.requireSession(sessionId);
      const lease = this.leases.get(tabId);
      if (lease !== undefined && lease.session_id !== sessionId) {
        throw new ToolFailure(createToolError(
          'tab_in_use',
          `Tab ${tabId} is already controlled by session ${lease.session_id}.`,
          false,
          { tab_id: tabId, owning_session_id: lease.session_id },
        ));
      }
      this.leases.set(tabId, {
        session_id: sessionId,
        turn_id: turnId ?? null,
        origin,
        claimed_at: lease?.claimed_at ?? Date.now(),
        last_used_at: Date.now(),
      });
      if (!session.tab_ids.includes(tabId)) session.tab_ids.push(tabId);
      if (group) await this.ensureGrouped(session, tabId);
      await this.persistAll();
      return toSessionInfo(session);
    });
  }

  public async release(sessionId: string, tabId: number): Promise<BrowserSessionInfo> {
    return this.enqueue(async () => {
      const session = this.requireSession(sessionId);
      const lease = this.leases.get(tabId);
      if (lease?.session_id !== sessionId) {
        throw new ToolFailure(createToolError(
          'tab_not_found',
          `Tab ${tabId} is not controlled by session ${sessionId}.`,
          false,
        ));
      }
      this.leases.delete(tabId);
      session.tab_ids = session.tab_ids.filter((id) => id !== tabId);
      await this.ungroupManagedTabs(session, [tabId]);
      if (session.tab_ids.length === 0) session.group_id = null;
      await this.persistAll();
      return toSessionInfo(session);
    });
  }

  public async assertAccess(sessionId: string | undefined, tabId: number): Promise<void> {
    await this.ensureInitialized();
    const lease = this.leases.get(tabId);
    if (lease === undefined) return;
    if (sessionId !== undefined && lease.session_id === sessionId) {
      await this.touchLease(lease);
      return;
    }
    if (!isLeaseIdle(lease, Date.now())) {
      // A caller without a session (a script, a CLI) does not get to bypass a conversation's
      // ownership: leases are authoritative for everyone.
      throw new ToolFailure(createToolError(
        'tab_in_use',
        sessionId === undefined
          ? `Tab ${tabId} is held by session ${lease.session_id}. Open a session and claim it first.`
          : `Tab ${tabId} is not leased to session ${sessionId}. Claim it before use.`,
        false,
        { tab_id: tabId, owning_session_id: lease.session_id },
      ));
    }
    // The owner went away without releasing, so free the tab instead of blocking it forever.
    await this.enqueue(() => this.dropLease(tabId, lease.session_id));
  }

  /**
   * Live leases as tab_id → owning session_id, dropping any that went idle. Tabs owned by nobody are
   * absent, which is how callers tell "free" from "taken".
   */
  public async listLeases(): Promise<Map<number, string>> {
    await this.ensureInitialized();
    const expired = [...this.leases].filter(([, lease]) => isLeaseIdle(lease, Date.now()));
    if (expired.length > 0) {
      await this.enqueue(async () => {
        for (const [tabId, lease] of expired) await this.dropLease(tabId, lease.session_id);
      });
    }
    return new Map([...this.leases].map(([tabId, lease]) => [tabId, lease.session_id]));
  }

  /**
   * Releases every session and lease. This is the escape hatch for a conversation that was closed
   * without ending its session: without it those tabs stay owned until Chrome restarts.
   */
  public async reset(): Promise<{ releasedTabIds: number[]; sessionCount: number }> {
    return this.enqueue(async () => {
      const releasedTabIds = [...this.leases.keys()];
      const sessionCount = this.sessions.size;
      for (const session of this.sessions.values()) {
        await this.ungroupManagedTabs(session, [...session.tab_ids]);
      }
      this.leases.clear();
      this.sessions.clear();
      await this.persistAll();
      return { releasedTabIds, sessionCount };
    });
  }

  private async touchLease(lease: TabLease): Promise<void> {
    const now = Date.now();
    const previous = lease.last_used_at ?? lease.claimed_at;
    lease.last_used_at = now;
    if (now - previous < LEASE_TOUCH_PERSIST_MS) return;
    await this.persistAll();
  }

  /** Drops a lease that no longer has a live owner, and forgets the tab on that session. */
  private async dropLease(tabId: number, ownerSessionId: string): Promise<void> {
    const lease = this.leases.get(tabId);
    if (lease === undefined || lease.session_id !== ownerSessionId) return;
    this.leases.delete(tabId);
    const session = this.sessions.get(ownerSessionId);
    if (session !== undefined) {
      session.tab_ids = session.tab_ids.filter((id) => id !== tabId);
      if (session.tab_ids.length === 0) session.group_id = null;
    }
    await this.persistAll();
  }

  private async claimChildTab(tabId: number, openerTabId: number): Promise<void> {
    const openerLease = this.leases.get(openerTabId);
    if (openerLease === undefined || this.leases.has(tabId)) return;
    const session = this.sessions.get(openerLease.session_id);
    if (session === undefined) return;
    this.leases.set(tabId, { ...openerLease, origin: 'child', claimed_at: Date.now() });
    session.tab_ids.push(tabId);
    await this.ensureGrouped(session, tabId);
    await this.persistAll();
  }

  private async ensureGrouped(session: StoredSession, tabId: number): Promise<void> {
    let groupId = session.group_id;
    if (groupId !== null) {
      const exists = await chrome.tabGroups.get(groupId).then(() => true).catch(() => false);
      if (!exists) groupId = null;
    }
    groupId = await chrome.tabs.group({
      tabIds: tabId,
      ...(groupId === null ? {} : { groupId }),
    });
    session.group_id = groupId;
    await chrome.tabGroups.update(groupId, {
      title: groupTitleFor(session),
      color: 'blue',
      collapsed: false,
    });
  }

  private async ungroupManagedTabs(session: StoredSession, tabIds: number[]): Promise<void> {
    if (session.group_id === null) return;
    for (const tabId of tabIds) {
      const tab = await chrome.tabs.get(tabId).catch(() => null);
      if (tab?.groupId === session.group_id) await chrome.tabs.ungroup(tabId).catch(() => undefined);
    }
  }

  private async removeTab(tabId: number): Promise<void> {
    const lease = this.leases.get(tabId);
    if (lease === undefined) return;
    this.leases.delete(tabId);
    const session = this.sessions.get(lease.session_id);
    if (session !== undefined) {
      session.tab_ids = session.tab_ids.filter((id) => id !== tabId);
      if (session.tab_ids.length === 0) session.group_id = null;
    }
    await this.persistAll();
  }

  private async replaceTab(addedTabId: number, removedTabId: number): Promise<void> {
    const lease = this.leases.get(removedTabId);
    if (lease === undefined) return;
    this.leases.delete(removedTabId);
    this.leases.set(addedTabId, lease);
    const session = this.sessions.get(lease.session_id);
    if (session !== undefined) {
      session.tab_ids = session.tab_ids.map((id) => id === removedTabId ? addedTabId : id);
      await this.ensureGrouped(session, addedTabId);
    }
    await this.persistAll();
  }

  private async removeGroup(groupId: number): Promise<void> {
    let changed = false;
    for (const session of this.sessions.values()) {
      if (session.group_id === groupId) {
        session.group_id = null;
        changed = true;
      }
    }
    if (changed) await this.persistSessions();
  }

  private requireSession(sessionId: string): StoredSession {
    const session = this.sessions.get(sessionId);
    if (session === undefined) {
      throw new ToolFailure(createToolError('session_not_found', `Session ${sessionId} was not found.`, false));
    }
    return session;
  }

  private async ensureInitialized(): Promise<void> {
    if (this.initializePromise === null) this.initializePromise = this.load();
    await this.initializePromise;
  }

  private enqueue<T>(operation: () => Promise<T>): Promise<T> {
    const result = this.mutationQueue.then(async () => {
      await this.ensureInitialized();
      return operation();
    });
    this.mutationQueue = result.then(() => undefined, () => undefined);
    return result;
  }

  private async load(): Promise<void> {
    const [storedSessions, storedLeases] = await Promise.all([
      chrome.storage.local.get(SESSIONS_STORAGE_KEY),
      chrome.storage.session.get(LEASES_STORAGE_KEY),
    ]);
    const sessions = (storedSessions as Record<string, unknown>)[SESSIONS_STORAGE_KEY];
    if (Array.isArray(sessions)) {
      for (const value of sessions) {
        if (isStoredSession(value)) this.sessions.set(value.session_id, { ...value, tab_ids: [...value.tab_ids] });
      }
    }
    const leases = (storedLeases as Record<string, unknown>)[LEASES_STORAGE_KEY];
    if (Array.isArray(leases)) {
      for (const value of leases) {
        if (isStoredLease(value)) this.leases.set(value.tab_id, value.lease);
      }
    }
  }

  private async persistSessions(): Promise<void> {
    await chrome.storage.local.set({ [SESSIONS_STORAGE_KEY]: [...this.sessions.values()] });
  }

  private async persistAll(): Promise<void> {
    await Promise.all([
      this.persistSessions(),
      chrome.storage.session.set({
        [LEASES_STORAGE_KEY]: [...this.leases].map(([tab_id, lease]) => ({ tab_id, lease })),
      }),
    ]);
  }
}

function normalizeName(name: string): string {
  return name.trim().slice(0, 80) || DEFAULT_GROUP_TITLE;
}

function toSessionInfo(session: StoredSession): BrowserSessionInfo {
  return {
    session_id: session.session_id,
    name: session.name,
    tab_ids: [...session.tab_ids],
    group_id: session.group_id,
  };
}

function isStoredSession(value: unknown): value is StoredSession {
  if (typeof value !== 'object' || value === null) return false;
  const record = value as Record<string, unknown>;
  return typeof record.session_id === 'string' &&
    (typeof record.name === 'string' || record.name === null) &&
    Array.isArray(record.tab_ids) && record.tab_ids.every((id) => typeof id === 'number') &&
    (typeof record.group_id === 'number' || record.group_id === null);
}

function isStoredLease(value: unknown): value is { tab_id: number; lease: TabLease } {
  if (typeof value !== 'object' || value === null) return false;
  const record = value as Record<string, unknown>;
  if (typeof record.tab_id !== 'number' || typeof record.lease !== 'object' || record.lease === null) return false;
  const lease = record.lease as Record<string, unknown>;
  return typeof lease.session_id === 'string' &&
    (typeof lease.turn_id === 'string' || lease.turn_id === null) &&
    (lease.origin === 'agent' || lease.origin === 'user' || lease.origin === 'child') &&
    typeof lease.claimed_at === 'number' &&
    (lease.last_used_at === undefined || typeof lease.last_used_at === 'number');
}
