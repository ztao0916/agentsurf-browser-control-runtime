import type { BrowserSessionInfo } from '../protocol/tool-contract';

export type TabClaimOrigin = 'agent' | 'user' | 'child';

export interface SessionCoordinator {
  start(sessionId?: string, name?: string): Promise<BrowserSessionInfo>;
  end(sessionId: string, closeTabs: boolean): Promise<{ releasedTabIds: number[] }>;
  name(sessionId: string, name: string): Promise<BrowserSessionInfo>;
  claim(sessionId: string, turnId: string | undefined, tabId: number, origin: TabClaimOrigin, group: boolean): Promise<BrowserSessionInfo>;
  release(sessionId: string, tabId: number): Promise<BrowserSessionInfo>;
  assertAccess(sessionId: string | undefined, tabId: number): Promise<void>;
}
