import { describe, expect, it } from 'vitest';
import type { BrowserSessionInfo, OperationResult, ToolRequest, ToolResponse } from '../src/core/protocol/tool-contract';
import { RemoteExecutionRuntime, type RemoteExecutionStore, type RemoteTaskRecord } from '../src/core/remote-execution';
import type { SessionCoordinator } from '../src/core/session/session-coordinator';

function mockStore(): RemoteExecutionStore {
  let tasks: RemoteTaskRecord[] = [];
  return {
    load: () => Promise.resolve(tasks),
    save: (saved) => { tasks = saved; return Promise.resolve(); },
  };
}

function mockSessions(): SessionCoordinator & {
  has: (sessionId: string) => Promise<boolean>;
  protect: (sessionId: string, protectedTask: boolean) => Promise<void>;
  endRemote: (sessionId: string, closeTabs: boolean) => Promise<{ releasedTabIds: number[] }>;
} {
  const active = new Set<string>();
  const protectedSessions = new Set<string>();
  return {
    has: (id) => Promise.resolve(active.has(id)),
    protect: (id, p) => { if (p) protectedSessions.add(id); else protectedSessions.delete(id); return Promise.resolve(); },
    endRemote: (id) => { active.delete(id); protectedSessions.delete(id); return Promise.resolve({ releasedTabIds: [] }); },
    start: (id = 'default'): Promise<BrowserSessionInfo> => { active.add(id); return Promise.resolve({ session_id: id, name: null, tab_ids: [], group_id: null }); },
    end: () => Promise.resolve({ releasedTabIds: [] }),
    name: () => Promise.resolve({ session_id: 'test', name: null, tab_ids: [], group_id: null }),
    claim: () => Promise.resolve({ session_id: 'test', name: null, tab_ids: [], group_id: null }),
    release: () => Promise.resolve({ session_id: 'test', name: null, tab_ids: [], group_id: null }),
    assertAccess: () => Promise.resolve(),
    listLeases: () => Promise.resolve(new Map()),
    reset: () => Promise.resolve({ releasedTabIds: [], closedTabIds: [], sessionCount: 0, otherSessionsKept: 0 }),
  };
}

describe('RemoteExecutionRuntime', () => {
  it('enforces remote lifecycle, idempotency, and deduplication', async () => {
    const sessions = mockSessions();
    const store = mockStore();
    let executions = 0;

    const execute = async (req: ToolRequest): Promise<ToolResponse> => {
      executions++;
      if (req.tool === 'browser.start_session') {
        await sessions.start(req.session_id);
        return { kind: 'tool-response', protocol_version: '1', request_id: req.request_id, ok: true, result: { session: { session_id: req.session_id ?? 'test', name: null, tab_ids: [], group_id: null } } };
      }
      const opResult: OperationResult = { state: 'completed', operation_id: 'op' };
      return { kind: 'tool-response', protocol_version: '1', request_id: req.request_id, ok: true, result: opResult };
    };

    const runtime = new RemoteExecutionRuntime(sessions, store, execute);
    const sessionId = 'remote_11111111-2222-3333-4444-555555555555';

    // 1. Rejects non-remote or non-remote session prefix
    const nonRemoteRes = await runtime.handle({
      kind: 'tool-request',
      protocol_version: '1',
      request_id: 'req_1',
      tool: 'browser.open',
      session_id: 'mcp_regular',
      args: { url: 'https://example.com' },
    });
    expect(nonRemoteRes.ok).toBe(false);
    if (!nonRemoteRes.ok) {
      expect(nonRemoteRes.error.code).toBe('permission_denied');
    }

    // 2. Start session
    const startRes = await runtime.handle({
      kind: 'tool-request',
      protocol_version: '1',
      request_id: 'req_2',
      remote: true,
      session_id: sessionId,
      operation_id: 'op_start',
      tool: 'browser.start_session',
      args: {},
    });
    expect(startRes.ok).toBe(true);
    expect(executions).toBe(1);

    // 3. Normal execution
    const clickRes1 = await runtime.handle({
      kind: 'tool-request',
      protocol_version: '1',
      request_id: 'req_3',
      remote: true,
      session_id: sessionId,
      operation_id: 'op_click_1',
      tool: 'browser.click',
      args: { tab_id: 1, element_id: 'e1' },
    });
    expect(clickRes1.ok).toBe(true);
    expect(executions).toBe(2);

    // 4. Repeated call with same operation_id returns cached result without executing again
    const clickRes2 = await runtime.handle({
      kind: 'tool-request',
      protocol_version: '1',
      request_id: 'req_4',
      remote: true,
      session_id: sessionId,
      operation_id: 'op_click_1',
      tool: 'browser.click',
      args: { tab_id: 1, element_id: 'e1' },
    });
    expect(clickRes2.ok).toBe(true);
    expect(executions).toBe(2); // no new execution!

    // 5. Calling with same operation_id but different arguments causes operation_conflict
    const conflictRes = await runtime.handle({
      kind: 'tool-request',
      protocol_version: '1',
      request_id: 'req_5',
      remote: true,
      session_id: sessionId,
      operation_id: 'op_click_1',
      tool: 'browser.click',
      args: { tab_id: 1, element_id: 'different_element' },
    });
    expect(conflictRes.ok).toBe(false);
    if (!conflictRes.ok) {
      expect(conflictRes.error.code).toBe('operation_conflict');
    }

    // 6. Query operation via browser.get_operation
    const getOpRes = await runtime.handle({
      kind: 'tool-request',
      protocol_version: '1',
      request_id: 'req_6',
      remote: true,
      session_id: sessionId,
      tool: 'browser.get_operation',
      args: { operation_id: 'op_click_1' },
    });
    expect(getOpRes.ok).toBe(true);
    if (getOpRes.ok && 'state' in getOpRes.result) {
      expect(getOpRes.result.state).toBe('completed');
    }

    // 7. End session
    const endRes = await runtime.handle({
      kind: 'tool-request',
      protocol_version: '1',
      request_id: 'req_7',
      remote: true,
      session_id: sessionId,
      operation_id: 'op_end',
      tool: 'browser.end_session',
      args: { close_opened_tabs: false },
    });
    expect(endRes.ok).toBe(true);
    expect(await sessions.has(sessionId)).toBe(false);
  });
});
