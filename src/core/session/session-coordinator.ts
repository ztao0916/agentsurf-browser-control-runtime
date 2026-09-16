import type { BrowserSessionInfo } from '../protocol/tool-contract';

export type TabClaimOrigin = 'agent' | 'user' | 'child';

export interface SessionCoordinator {
  start(sessionId?: string, name?: string): Promise<BrowserSessionInfo>;
  end(sessionId: string, closeTabs: boolean): Promise<{ releasedTabIds: number[] }>;
  name(sessionId: string, name: string): Promise<BrowserSessionInfo>;
  claim(sessionId: string, turnId: string | undefined, tabId: number, origin: TabClaimOrigin, group: boolean): Promise<BrowserSessionInfo>;
  release(sessionId: string, tabId: number): Promise<BrowserSessionInfo>;
  assertAccess(sessionId: string | undefined, tabId: number): Promise<void>;
  /** Live leases as tab_id → owning session_id; tabs owned by nobody are absent. */
  listLeases(): Promise<Map<number, string>>;
  /**
   * Escape hatch for tabs stuck on a conversation that is gone. Without `force` it releases the
   * caller's own session plus leases that have no owner, and leaves other sessions alone.
   * `closeOpenedTabs` also closes the tabs this conversation opened itself, never a tab the user had
   * open; `force` only ungroups, because closing another conversation's tabs would destroy live work.
   */
  reset(sessionId: string | undefined, force: boolean, closeOpenedTabs?: boolean): Promise<{
    releasedTabIds: number[];
    closedTabIds: number[];
    sessionCount: number;
    otherSessionsKept: number;
  }>;
}
