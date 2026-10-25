import { describe, expect, it } from 'vitest';
import type { OperationResult, ToolName, ToolRequest } from '../src/core/protocol/tool-contract';
import { ToolFailure } from '../src/core/protocol/errors';
import { BridgeDeliveryError } from '../src/mcp/bridge-client';
import { RemoteSessions, type RemoteBridgeCall, type RemoteSessionStore } from '../src/mcp/remote-sessions';

type StoredSessionList = Parameters<RemoteSessionStore['save']>[0];

function memoryStore(): RemoteSessionStore {
  let data: StoredSessionList = [];
  return {
    load: () => Promise.resolve(data),
    save: (sessions) => { data = sessions; return Promise.resolve(); },
  };
}

describe('RemoteSessions', () => {
  const principal = '11111111-2222-3333-4444-555555555555';
  const otherPrincipal = '99999999-8888-7777-6666-555555555555';
  const authorized = () => Promise.resolve(true);

  it('manages task lifecycle explicitly from start to end', async () => {
    const calls: Array<{ tool: ToolName; sessionId: string; args: ToolRequest['args'] }> = [];
    const bridge: RemoteBridgeCall = (tool, args, sessionId) => {
      calls.push({ tool, sessionId, args });
      if (tool === 'browser.start_session') {
        const name = 'name' in args && typeof args.name === 'string' ? args.name : undefined;
        return Promise.resolve({ session: { session_id: sessionId, name } });
      }
      if (tool === 'browser.end_session') {
        return Promise.resolve({ ended: true, released_tab_ids: [] });
      }
      return Promise.resolve({ ok: true });
    };

    const store = memoryStore();
    const sessions = new RemoteSessions(store, bridge);

    // 1. Explicit start
    const startResult = await sessions.call(
      principal,
      'browser.start_session',
      { name: 'test-task' },
      authorized,
    ) as { session: { session_id: string } };

    expect(startResult.session.session_id).toMatch(/^remote_[a-f0-9-]+$/);
    const sessionId = startResult.session.session_id;

    // 2. Normal tool call with valid session_id
    await sessions.call(
      principal,
      'browser.open',
      { session_id: sessionId, url: 'https://example.com' },
      authorized,
    );
    expect(calls.some((c) => c.tool === 'browser.open' && c.sessionId === sessionId)).toBe(true);

    // 3. Call with nonexistent session_id fails
    await expect(sessions.call(
      principal,
      'browser.open',
      { session_id: 'remote_nonexistent', url: 'https://example.com' },
      authorized,
    )).rejects.toThrowError(ToolFailure);

    // 4. Call with wrong principal fails
    await expect(sessions.call(
      otherPrincipal,
      'browser.open',
      { session_id: sessionId, url: 'https://example.com' },
      authorized,
    )).rejects.toThrowError(ToolFailure);

    // 5. Explicit end
    const endResult = await sessions.call(
      principal,
      'browser.end_session',
      { session_id: sessionId },
      authorized,
    ) as { ended: boolean };
    expect(endResult.ended).toBe(true);

    // 6. Post-end calls fail
    await expect(sessions.call(
      principal,
      'browser.open',
      { session_id: sessionId, url: 'https://example.com' },
      authorized,
    )).rejects.toThrowError(ToolFailure);
  });

  it('handles dispatched timeout as unknown outcome and prevents further mutations until queried', async () => {
    let shouldTimeout = true;
    const bridge: RemoteBridgeCall = (tool, _args, sessionId, opId) => {
      if (tool === 'browser.start_session') return Promise.resolve({ session: { session_id: sessionId } });
      if (tool === 'browser.click' && shouldTimeout) {
        return Promise.reject(new BridgeDeliveryError(true));
      }
      if (tool === 'browser.get_operation') {
        const op: OperationResult = { operation_id: opId ?? 'unknown', state: 'completed', response: { ok: true } };
        return Promise.resolve(op);
      }
      return Promise.resolve({ ok: true });
    };

    const sessions = new RemoteSessions(memoryStore(), bridge);
    const startResult = await sessions.call(principal, 'browser.start_session', {}, authorized) as { session: { session_id: string } };
    const sessionId = startResult.session.session_id;

    // Click times out with dispatched error
    await expect(sessions.call(
      principal,
      'browser.click',
      { session_id: sessionId, tab_id: 1, element_id: 'btn1', operation_id: 'op_click_1' },
      authorized,
    )).rejects.toThrowError(/operation_unknown|may have executed/);

    // Next mutating action is blocked because of uncertain prior outcome
    await expect(sessions.call(
      principal,
      'browser.click',
      { session_id: sessionId, tab_id: 1, element_id: 'btn2', operation_id: 'op_click_2' },
      authorized,
    )).rejects.toThrowError(/prior operation has an unknown outcome/);

    // Read-only tools like list_tabs are still permitted
    const listTabsResult = await sessions.call(
      principal,
      'browser.list_tabs',
      { session_id: sessionId },
      authorized,
    );
    expect(listTabsResult).toEqual({ ok: true });

    // Query the operation
    shouldTimeout = false;
    const queryResult = await sessions.call(
      principal,
      'browser.get_operation',
      { session_id: sessionId, operation_id: 'op_click_1' },
      authorized,
    ) as OperationResult;
    expect(queryResult.state).toBe('completed');

    // Now mutating calls are unblocked
    const nextCall = await sessions.call(
      principal,
      'browser.click',
      { session_id: sessionId, tab_id: 1, element_id: 'btn2', operation_id: 'op_click_2' },
      authorized,
    );
    expect(nextCall).toEqual({ ok: true });
  });
});
