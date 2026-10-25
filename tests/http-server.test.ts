import http from 'node:http';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { isValidHost, isValidOrigin, startHttpMcpServer } from '../src/mcp/http-server';
import { initializeRemoteConfig } from '../src/mcp/remote-config';

interface HealthResponse {
  status: string;
}

interface JsonRpcResponse<T> {
  jsonrpc: '2.0';
  id: number;
  result: T;
}

interface ToolListResult {
  tools: Array<{ name: string; description?: string }>;
}

interface CallResult {
  content: Array<{ type: string; text?: string; data?: string; mimeType?: string }>;
}

describe('http-server', () => {
  it('validates host headers correctly', () => {
    const allowed = ['tunnel.example.com', '127.0.0.1:8767', 'localhost:8767'];
    expect(isValidHost('tunnel.example.com', allowed)).toBe(true);
    expect(isValidHost('tunnel.example.com:443', allowed)).toBe(true);
    expect(isValidHost('127.0.0.1:8767', allowed)).toBe(true);
    expect(isValidHost('localhost:8767', allowed)).toBe(true);

    expect(isValidHost('127.0.0.1:9999', allowed)).toBe(false);
    expect(isValidHost('evil.com', allowed)).toBe(false);
    expect(isValidHost('tunnel.example.com.evil.com', allowed)).toBe(false);
    expect(isValidHost(undefined, allowed)).toBe(false);
  });

  it('validates origin headers correctly', () => {
    const allowed = ['https://tunnel.example.com', 'https://www.notion.so'];
    expect(isValidOrigin(undefined, allowed)).toBe(true);
    expect(isValidOrigin('https://tunnel.example.com', allowed)).toBe(true);
    expect(isValidOrigin('https://www.notion.so', allowed)).toBe(true);

    expect(isValidOrigin('https://evil.com', allowed)).toBe(false);
  });

  describe('live server HTTP interactions', () => {
    let tempDir: string;
    let configPath: string;
    let bridgeConfigPath: string;
    let token: string;
    let serverHandle: Awaited<ReturnType<typeof startHttpMcpServer>> | undefined;

    beforeEach(async () => {
      tempDir = await mkdtemp(join(tmpdir(), 'agentsurf-http-server-test-'));
      configPath = join(tempDir, 'remote-config.json');
      bridgeConfigPath = join(tempDir, 'bridge-config.json');

      token = await initializeRemoteConfig(
        configPath,
        'https://tunnel.example.com',
        bridgeConfigPath,
        0, // use random port for test
      );

      serverHandle = await startHttpMcpServer({ configPath });
    });

    afterEach(async () => {
      if (serverHandle) {
        await serverHandle.close();
        serverHandle = undefined;
      }
      await rm(tempDir, { recursive: true, force: true });
    });

    it('responds 200 on /healthz without auth', async () => {
      const port = serverHandle!.port;
      const res = await fetch(`http://127.0.0.1:${port}/healthz`, {
        headers: { host: '127.0.0.1:8767' },
      });
      expect(res.status).toBe(200);
      const body = (await res.json()) as HealthResponse;
      expect(body.status).toBe('ok');
    });

    it('rejects forbidden host with 403', async () => {
      const port = serverHandle!.port;
      const res = await new Promise<{ status: number }>((resolve, reject) => {
        const req = http.request({
          hostname: '127.0.0.1',
          port,
          path: '/mcp',
          method: 'POST',
          headers: {
            Host: 'attacker.evil.com',
            Authorization: `Bearer ${token}`,
            'Content-Type': 'application/json',
          },
        }, (response) => {
          resolve({ status: response.statusCode ?? 0 });
        });
        req.on('error', reject);
        req.end(JSON.stringify({}));
      });
      expect(res.status).toBe(403);
    });

    it('rejects unauthorized requests with 401', async () => {
      const port = serverHandle!.port;
      const res = await fetch(`http://127.0.0.1:${port}/mcp`, {
        method: 'POST',
        headers: {
          host: 'tunnel.example.com',
          authorization: `Bearer wrong-token`,
          'content-type': 'application/json',
        },
        body: JSON.stringify({
          jsonrpc: '2.0',
          id: 1,
          method: 'initialize',
          params: { protocolVersion: '2024-11-05', capabilities: {}, clientInfo: { name: 'test', version: '1.0' } },
        }),
      });
      expect(res.status).toBe(401);
    });

    it('initializes MCP session and lists probe and remote tools', async () => {
      const port = serverHandle!.port;
      const initRes = await fetch(`http://127.0.0.1:${port}/mcp`, {
        method: 'POST',
        headers: {
          host: 'tunnel.example.com',
          authorization: `Bearer ${token}`,
          'content-type': 'application/json',
        },
        body: JSON.stringify({
          jsonrpc: '2.0',
          id: 1,
          method: 'initialize',
          params: { protocolVersion: '2024-11-05', capabilities: {}, clientInfo: { name: 'notion-test', version: '1.0' } },
        }),
      });

      expect(initRes.status).toBe(200);
      const mcpSessionId = initRes.headers.get('mcp-session-id');
      expect(typeof mcpSessionId).toBe('string');

      // List tools
      const listRes = await fetch(`http://127.0.0.1:${port}/mcp`, {
        method: 'POST',
        headers: {
          host: 'tunnel.example.com',
          authorization: `Bearer ${token}`,
          'content-type': 'application/json',
          'mcp-session-id': mcpSessionId!,
        },
        body: JSON.stringify({
          jsonrpc: '2.0',
          id: 2,
          method: 'tools/list',
          params: {},
        }),
      });
      expect(listRes.status).toBe(200);
      const listData = (await listRes.json()) as JsonRpcResponse<ToolListResult>;
      const toolNames = listData.result.tools.map((t) => t.name);

      // Verify probe tools are present
      expect(toolNames).toContain('probe_echo');
      expect(toolNames).toContain('probe_image');
      expect(toolNames).toContain('probe_status');

      // Verify remote session tools are present
      expect(toolNames).toContain('browser_start_session');
      expect(toolNames).toContain('browser_end_session');
      expect(toolNames).toContain('browser_get_operation');
      expect(toolNames).toContain('browser_list_tabs');
      expect(toolNames).toContain('browser_open');

      // Verify excluded tools are NOT present
      expect(toolNames).not.toContain('browser_reset_sessions');
      expect(toolNames).not.toContain('browser_set_files');
      expect(toolNames).not.toContain('browser_list_downloads');
      expect(toolNames).not.toContain('browser_wait_for_download');

      // Execute probe_echo
      const echoRes = await fetch(`http://127.0.0.1:${port}/mcp`, {
        method: 'POST',
        headers: {
          host: 'tunnel.example.com',
          authorization: `Bearer ${token}`,
          'content-type': 'application/json',
          'mcp-session-id': mcpSessionId!,
        },
        body: JSON.stringify({
          jsonrpc: '2.0',
          id: 3,
          method: 'tools/call',
          params: { name: 'probe_echo', arguments: { text: 'hello notion' } },
        }),
      });
      expect(echoRes.status).toBe(200);
      const echoData = (await echoRes.json()) as JsonRpcResponse<CallResult>;
      expect(echoData.result.content[0]?.text).toBe('AgentSurf probe OK: hello notion');

      // Execute probe_image
      const imgRes = await fetch(`http://127.0.0.1:${port}/mcp`, {
        method: 'POST',
        headers: {
          host: 'tunnel.example.com',
          authorization: `Bearer ${token}`,
          'content-type': 'application/json',
          'mcp-session-id': mcpSessionId!,
        },
        body: JSON.stringify({
          jsonrpc: '2.0',
          id: 4,
          method: 'tools/call',
          params: { name: 'probe_image', arguments: {} },
        }),
      });
      expect(imgRes.status).toBe(200);
      const imgData = (await imgRes.json()) as JsonRpcResponse<CallResult>;
      expect(imgData.result.content[0]?.type).toBe('image');
      expect(imgData.result.content[0]?.mimeType).toBe('image/png');
    });

    it('accepts direct extension WebSocket pairing at /ws and dispatches browser tool calls to it', async () => {
      const port = serverHandle!.port;

      // 1. Check health initially reports extension_connected: false
      const healthBefore = await fetch(`http://127.0.0.1:${port}/health`, {
        headers: { host: 'tunnel.example.com' },
      });
      const healthBeforeData = await healthBefore.json() as { extension_connected: boolean };
      expect(healthBeforeData.extension_connected).toBe(false);

      // 2. Connect fake extension via WebSocket to /ws?token=...
      const ws = new WebSocket(`ws://127.0.0.1:${port}/ws?token=${token}`);
      await new Promise<void>((resolve, reject) => {
        ws.onopen = () => resolve();
        ws.onerror = (err) => reject(err);
      });

      // Handle messages on fake extension
      ws.onmessage = (event) => {
        const msg = JSON.parse(event.data.toString()) as {
          type: string;
          request?: { request_id: string; tool: string; session_id?: string; operation_id?: string; turn_id?: string; args?: { session_id?: string } };
        };
        if (msg.type === 'tool_request' && msg.request) {
          const req = msg.request;
          expect(req.operation_id).toBeDefined();
          expect(typeof req.operation_id).toBe('string');
          const result = req.tool === 'browser.start_session'
            ? { session: { session_id: req.args?.session_id ?? 'sess-1', name: 'test' } }
            : { tabs: [{ tab_id: 1, title: 'Test Page', url: 'https://example.com' }] };

          ws.send(JSON.stringify({
            type: 'tool_response',
            response: {
              request_id: req.request_id,
              ok: true,
              result,
            },
          }));
        }
      };

      // 3. Send extension_hello
      ws.send(JSON.stringify({
        type: 'extension_hello',
        protocol_version: '1',
        extension_id: 'test-extension-id',
      }));

      // Give it a tiny moment to register
      await new Promise((r) => setTimeout(r, 50));

      // 4. Check health now reports extension_connected: true
      const healthAfter = await fetch(`http://127.0.0.1:${port}/health`, {
        headers: { host: 'tunnel.example.com' },
      });
      const healthAfterData = await healthAfter.json() as { extension_connected: boolean };
      expect(healthAfterData.extension_connected).toBe(true);

      // 5. Initialize MCP session and call browser_list_tabs
      const initRes = await fetch(`http://127.0.0.1:${port}/mcp`, {
        method: 'POST',
        headers: {
          host: 'tunnel.example.com',
          authorization: `Bearer ${token}`,
          'content-type': 'application/json',
          accept: 'application/json, text/event-stream',
        },
        body: JSON.stringify({
          jsonrpc: '2.0',
          id: 1,
          method: 'initialize',
          params: { protocolVersion: '2024-11-05', capabilities: {}, clientInfo: { name: 'notion', version: '1.0' } },
        }),
      });
      const mcpSessionId = initRes.headers.get('mcp-session-id');

      // Start session first (required by remote session policy)
      const startRes = await fetch(`http://127.0.0.1:${port}/mcp`, {
        method: 'POST',
        headers: {
          host: 'tunnel.example.com',
          authorization: `Bearer ${token}`,
          'content-type': 'application/json',
          'mcp-session-id': mcpSessionId!,
        },
        body: JSON.stringify({
          jsonrpc: '2.0',
          id: 2,
          method: 'tools/call',
          params: { name: 'browser_start_session', arguments: { session_name: 'test' } },
        }),
      });
      const startData = await startRes.json() as { result: { content: Array<{ text: string }> } };
      const parsedStart = JSON.parse(startData.result.content[0]!.text) as { session: { session_id: string } };

      // Call browser_list_tabs with session_id
      const listTabsRes = await fetch(`http://127.0.0.1:${port}/mcp`, {
        method: 'POST',
        headers: {
          host: 'tunnel.example.com',
          authorization: `Bearer ${token}`,
          'content-type': 'application/json',
          'mcp-session-id': mcpSessionId!,
        },
        body: JSON.stringify({
          jsonrpc: '2.0',
          id: 3,
          method: 'tools/call',
          params: { name: 'browser_list_tabs', arguments: { session_id: parsedStart.session.session_id } },
        }),
      });
      expect(listTabsRes.status).toBe(200);
      const listTabsData = await listTabsRes.json() as { result: { content: Array<{ text: string }> } };
      const parsedTabs = JSON.parse(listTabsData.result.content[0]!.text) as { tabs: Array<{ title: string }> };
      expect(parsedTabs.tabs[0]?.title).toBe('Test Page');

      ws.close();
    });
  });
});
