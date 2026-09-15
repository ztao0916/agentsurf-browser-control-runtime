import { afterEach, describe, expect, it, vi } from 'vitest';
import { BrowserBridgeServer } from '../src/bridge/server';
import { callLocalBridge } from '../src/mcp/bridge-client';
import type { ExternalToolRequest } from '../src/transport/external-tool-protocol';

const TOKEN = 'test-token-with-at-least-16-characters';

let bridge: BrowserBridgeServer | undefined;

afterEach(async () => {
  delete process.env.BROWSER_BRIDGE_URL;
  delete process.env.BROWSER_BRIDGE_TOKEN;
  if (bridge !== undefined) await bridge.close();
  bridge = undefined;
});

async function startBridge(captured: ExternalToolRequest[]): Promise<void> {
  bridge = new BrowserBridgeServer({ port: 0, token: TOKEN, requestTimeoutMs: 2_000, log: () => undefined });
  const port = await bridge.waitUntilListening();
  bridge.attachNativeExtension((request) => { captured.push(request); });
  process.env.BROWSER_BRIDGE_URL = `ws://127.0.0.1:${port}`;
  process.env.BROWSER_BRIDGE_TOKEN = TOKEN;
}

function respond(captured: ExternalToolRequest[], result: unknown): void {
  const request = captured[0] as ExternalToolRequest;
  bridge?.receiveNativeExtensionResponse({ request_id: request.request_id, ok: true, result });
}

describe('callLocalBridge', () => {
  it('puts session_id at the request root and leaves args untouched', async () => {
    const captured: ExternalToolRequest[] = [];
    await startBridge(captured);

    const pending = callLocalBridge('browser.list_tabs', {}, 'session_abc');
    await vi.waitFor(() => expect(captured).toHaveLength(1));

    expect(captured[0]?.session_id).toBe('session_abc');
    expect(captured[0]?.args).toEqual({});

    respond(captured, { tabs: [] });
    await expect(pending).resolves.toEqual({ tabs: [] });
  });

  it('omits session_id entirely when no session is given', async () => {
    const captured: ExternalToolRequest[] = [];
    await startBridge(captured);

    const pending = callLocalBridge('browser.list_tabs', {});
    await vi.waitFor(() => expect(captured).toHaveLength(1));

    expect(captured[0]).not.toHaveProperty('session_id');

    respond(captured, { tabs: [] });
    await expect(pending).resolves.toEqual({ tabs: [] });
  });

  it('keeps session_id in args for the session tools that read it there', async () => {
    const captured: ExternalToolRequest[] = [];
    await startBridge(captured);

    const pending = callLocalBridge('browser.claim_tab', { session_id: 'session_abc', tab_id: 7 }, 'session_abc');
    await vi.waitFor(() => expect(captured).toHaveLength(1));

    expect(captured[0]?.session_id).toBe('session_abc');
    expect(captured[0]?.args).toMatchObject({ session_id: 'session_abc', tab_id: 7 });

    respond(captured, { session: { session_id: 'session_abc', name: null, tab_ids: [7], group_id: null } });
    await expect(pending).resolves.toMatchObject({ session: { tab_ids: [7] } });
  });
});
