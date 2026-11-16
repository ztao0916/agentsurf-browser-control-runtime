import { createHash } from 'node:crypto';
import http from 'node:http';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { isValidHost, isValidOrigin, startHttpMcpServer } from '../src/mcp/http-server';
import { initializeOAuthClient, initializeRemoteConfig, rotateOAuthSecret, setRemoteAccessMode } from '../src/mcp/remote-config';

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
  it('validates host headers correctly (including port-agnostic non-loopback domains)', () => {
    const allowed = ['tunnel.example.com', 'legacy.example.com:9443', '127.0.0.1:8767', 'localhost:8767'];
    expect(isValidHost('tunnel.example.com', allowed)).toBe(true);
    expect(isValidHost('tunnel.example.com:443', allowed)).toBe(true);
    expect(isValidHost('tunnel.example.com:9444', allowed)).toBe(true);
    expect(isValidHost('legacy.example.com:9444', allowed)).toBe(true);
    expect(isValidHost('legacy.example.com', allowed)).toBe(true);
    expect(isValidHost('127.0.0.1:8767', allowed)).toBe(true);
    expect(isValidHost('localhost:8767', allowed)).toBe(true);

    expect(isValidHost('127.0.0.1:9999', allowed)).toBe(false);
    expect(isValidHost('evil.com', allowed)).toBe(false);
    expect(isValidHost('tunnel.example.com.evil.com', allowed)).toBe(false);
    expect(isValidHost(undefined, allowed)).toBe(false);
  });

  it('validates origin headers correctly', () => {
    const allowed = ['https://tunnel.example.com:9443', 'https://www.notion.so'];
    const allowedHosts = ['tunnel.example.com:9443', '127.0.0.1:8767'];
    expect(isValidOrigin(undefined, allowed)).toBe(true);
    expect(isValidOrigin('https://tunnel.example.com:9443', allowed)).toBe(true);
    expect(isValidOrigin('https://tunnel.example.com:9444', allowed, allowedHosts)).toBe(true);
    expect(isValidOrigin('https://tunnel.example.com', allowed, allowedHosts)).toBe(true);
    expect(isValidOrigin('https://www.notion.so', allowed, allowedHosts)).toBe(true);

    expect(isValidOrigin('https://www.notion.so:9444', allowed, allowedHosts)).toBe(false);
    expect(isValidOrigin('http://tunnel.example.com:9444', allowed, allowedHosts)).toBe(false);
    expect(isValidOrigin('https://evil.com', allowed, allowedHosts)).toBe(false);
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
      await setRemoteAccessMode(configPath, 'interactive');

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

    it('supports MCP OAuth discovery, authorization code + PKCE flow, token refresh, and revocation', async () => {
      const port = serverHandle!.port;

      // Without OAuth configured, well-known discovery returns 404
      const unconfiguredRes = await fetch(`http://127.0.0.1:${port}/.well-known/oauth-protected-resource`, {
        headers: { host: 'tunnel.example.com' },
      });
      expect(unconfiguredRes.status).toBe(404);

      const redirectUri = 'https://gemini.google.com/oauth/callback';
      const oauth = await initializeOAuthClient(configPath, {
        redirectUris: [redirectUri],
      });

      // Unauthenticated /mcp returns 401 with resource_metadata challenge
      const unauthMcp = await fetch(`http://127.0.0.1:${port}/mcp`, {
        method: 'POST',
        headers: { host: 'tunnel.example.com', 'content-type': 'application/json' },
        body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'initialize', params: {} }),
      });
      expect(unauthMcp.status).toBe(401);
      expect(unauthMcp.headers.get('www-authenticate')).toContain('resource_metadata="https://tunnel.example.com/.well-known/oauth-protected-resource"');

      // Discovery metadata endpoints
      const prmRes = await fetch(`http://127.0.0.1:${port}/.well-known/oauth-protected-resource/mcp`, {
        headers: { host: 'tunnel.example.com' },
      });
      expect(prmRes.status).toBe(200);
      const prm = await prmRes.json() as { resource: string; authorization_servers: string[] };
      expect(prm.resource).toBe('https://tunnel.example.com/mcp');
      expect(prm.authorization_servers).toEqual(['https://tunnel.example.com']);

      const asRes = await fetch(`http://127.0.0.1:${port}/.well-known/oauth-authorization-server`, {
        headers: { host: 'tunnel.example.com' },
      });
      expect(asRes.status).toBe(200);
      const asMeta = await asRes.json() as { authorization_endpoint: string; token_endpoint: string };
      expect(asMeta.authorization_endpoint).toBe('https://tunnel.example.com/oauth/authorize');
      expect(asMeta.token_endpoint).toBe('https://tunnel.example.com/oauth/token');

      // Rejects unregistered redirect_uri
      const badRedirectRes = await fetch(
        `http://127.0.0.1:${port}/oauth/authorize?response_type=code&client_id=${encodeURIComponent(oauth.clientId)}&redirect_uri=${encodeURIComponent('https://evil.example.com/cb')}`,
        { headers: { host: 'tunnel.example.com' } },
      );
      expect(badRedirectRes.status).toBe(400);

      // Authorize GET returns consent form with CSRF token
      const verifier = 'agentsurf-test-pkce-code-verifier-0123456789abcdef';
      const challenge = createHash('sha256').update(verifier, 'ascii').digest('base64url');
      const authQuery = new URLSearchParams({
        response_type: 'code',
        client_id: oauth.clientId,
        redirect_uri: redirectUri,
        state: 'xyz-state',
        scope: 'mcp:tools',
        code_challenge: challenge,
        code_challenge_method: 'S256',
      });
      const authGetRes = await fetch(`http://127.0.0.1:${port}/oauth/authorize?${authQuery.toString()}`, {
        headers: { host: 'tunnel.example.com' },
      });
      expect(authGetRes.status).toBe(200);
      const html = await authGetRes.text();
      const csrfMatch = /name="csrf_token"\s+value="([^"]+)"/u.exec(html);
      expect(csrfMatch?.[1]).toBeTruthy();
      const csrfToken = csrfMatch![1]!;

      // Invalid pairing token fails with 401 and provides fresh CSRF token
      const badPost = await fetch(`http://127.0.0.1:${port}/oauth/authorize`, {
        method: 'POST',
        headers: {
          host: 'tunnel.example.com',
          origin: 'https://tunnel.example.com',
          'content-type': 'application/x-www-form-urlencoded',
        },
        body: new URLSearchParams({
          response_type: 'code',
          client_id: oauth.clientId,
          redirect_uri: redirectUri,
          state: 'xyz-state',
          scope: 'mcp:tools',
          code_challenge: challenge,
          code_challenge_method: 'S256',
          csrf_token: csrfToken,
          pairing_token: 'wrong-pairing-token',
          decision: 'allow',
        }).toString(),
        redirect: 'manual',
      });
      expect(badPost.status).toBe(401);
      const retryHtml = await badPost.text();
      const retryCsrf = /name="csrf_token"\s+value="([^"]+)"/u.exec(retryHtml)?.[1];
      expect(retryCsrf).toBeTruthy();

      // Valid pairing token issues authorization code via 302 redirect
      const goodPost = await fetch(`http://127.0.0.1:${port}/oauth/authorize`, {
        method: 'POST',
        headers: {
          host: 'tunnel.example.com',
          origin: 'https://tunnel.example.com',
          'content-type': 'application/x-www-form-urlencoded',
        },
        body: new URLSearchParams({
          response_type: 'code',
          client_id: oauth.clientId,
          redirect_uri: redirectUri,
          state: 'xyz-state',
          scope: 'mcp:tools',
          code_challenge: challenge,
          code_challenge_method: 'S256',
          csrf_token: retryCsrf!,
          pairing_token: token,
          decision: 'allow',
        }).toString(),
        redirect: 'manual',
      });
      expect(goodPost.status).toBe(302);
      const location = goodPost.headers.get('location');
      expect(location).toBeTruthy();
      const callbackUrl = new URL(location!);
      expect(callbackUrl.origin + callbackUrl.pathname).toBe(redirectUri);
      expect(callbackUrl.searchParams.get('state')).toBe('xyz-state');
      const code = callbackUrl.searchParams.get('code');
      expect(code).toBeTruthy();

      // Exchange code for access_token + refresh_token using client_secret_basic
      const basicAuth = Buffer.from(`${encodeURIComponent(oauth.clientId)}:${encodeURIComponent(oauth.clientSecret)}`).toString('base64');
      const tokenRes = await fetch(`http://127.0.0.1:${port}/oauth/token`, {
        method: 'POST',
        headers: {
          host: 'tunnel.example.com',
          authorization: `Basic ${basicAuth}`,
          'content-type': 'application/x-www-form-urlencoded',
        },
        body: new URLSearchParams({
          grant_type: 'authorization_code',
          code: code!,
          redirect_uri: redirectUri,
          code_verifier: verifier,
        }).toString(),
      });
      expect(tokenRes.status).toBe(200);
      const tokenBody = await tokenRes.json() as {
        access_token: string;
        token_type: string;
        expires_in: number;
        refresh_token: string;
      };
      expect(tokenBody.token_type).toBe('Bearer');
      expect(tokenBody.access_token.startsWith('as_at_')).toBe(true);
      expect(tokenBody.refresh_token.startsWith('as_rt_')).toBe(true);

      // Replaying the same code fails
      const replayRes = await fetch(`http://127.0.0.1:${port}/oauth/token`, {
        method: 'POST',
        headers: {
          host: 'tunnel.example.com',
          'content-type': 'application/x-www-form-urlencoded',
        },
        body: new URLSearchParams({
          grant_type: 'authorization_code',
          client_id: oauth.clientId,
          client_secret: oauth.clientSecret,
          code: code!,
          redirect_uri: redirectUri,
          code_verifier: verifier,
        }).toString(),
      });
      expect(replayRes.status).toBe(400);

      // Access token authenticates /mcp requests
      const mcpInitRes = await fetch(`http://127.0.0.1:${port}/mcp`, {
        method: 'POST',
        headers: {
          host: 'tunnel.example.com',
          authorization: `Bearer ${tokenBody.access_token}`,
          'content-type': 'application/json',
        },
        body: JSON.stringify({
          jsonrpc: '2.0',
          id: 1,
          method: 'initialize',
          params: { protocolVersion: '2024-11-05', capabilities: {}, clientInfo: { name: 'gemini-web', version: '1.0' } },
        }),
      });
      expect(mcpInitRes.status).toBe(200);

      // Refresh token issues a fresh access_token via client_secret_post
      const refreshRes = await fetch(`http://127.0.0.1:${port}/oauth/token`, {
        method: 'POST',
        headers: {
          host: 'tunnel.example.com',
          'content-type': 'application/x-www-form-urlencoded',
        },
        body: new URLSearchParams({
          grant_type: 'refresh_token',
          client_id: oauth.clientId,
          client_secret: oauth.clientSecret,
          refresh_token: tokenBody.refresh_token,
        }).toString(),
      });
      expect(refreshRes.status).toBe(200);
      const refreshBody = await refreshRes.json() as { access_token: string };
      expect(refreshBody.access_token.startsWith('as_at_')).toBe(true);

      // Rotating OAuth client secret revokes issued OAuth access tokens immediately
      await rotateOAuthSecret(configPath);
      const revokedRes = await fetch(`http://127.0.0.1:${port}/mcp`, {
        method: 'POST',
        headers: {
          host: 'tunnel.example.com',
          authorization: `Bearer ${refreshBody.access_token}`,
          'content-type': 'application/json',
        },
        body: JSON.stringify({
          jsonrpc: '2.0',
          id: 2,
          method: 'initialize',
          params: { protocolVersion: '2024-11-05', capabilities: {}, clientInfo: { name: 'gemini-web', version: '1.0' } },
        }),
      });
      expect(revokedRes.status).toBe(401);
    });

    it('supports multiple simultaneously connected browsers with active-device routing and session stickiness', async () => {
      const port = serverHandle!.port;

      const connectDevice = async (deviceId: string, deviceName: string, tabTitle: string, lastActiveAt: number) => {
        const ws = new WebSocket(`ws://127.0.0.1:${port}/ws?token=${token}`);
        await new Promise<void>((resolve, reject) => {
          ws.onopen = () => resolve();
          ws.onerror = () => reject(new Error(`WebSocket failed for ${deviceId}`));
        });
        ws.onmessage = (event) => {
          const msg = JSON.parse(typeof event.data === 'string' ? event.data : String(event.data)) as {
            type: string;
            request?: { request_id: string; tool: string; args?: { session_id?: string } };
          };
          if (msg.type === 'tool_request' && msg.request) {
            const req = msg.request;
            const result = req.tool === 'browser.start_session'
              ? { session: { session_id: req.args?.session_id ?? 'sess-1', name: 'test' } }
              : { tabs: [{ tab_id: 1, title: tabTitle, url: 'https://example.com' }] };
            ws.send(JSON.stringify({
              type: 'tool_response',
              response: { request_id: req.request_id, ok: true, result },
            }));
          }
        };
        ws.send(JSON.stringify({
          type: 'extension_hello',
          protocol_version: '1',
          extension_id: 'test-ext',
          device_id: deviceId,
          device_name: deviceName,
          last_active_at: lastActiveAt,
        }));
        return ws;
      };

      const companyWs = await connectDevice('dev-company', '公司', 'Company Tab', 1_000);
      const homeWs = await connectDevice('dev-home', '家里', 'Home Tab', 2_000);
      await new Promise((r) => setTimeout(r, 50));

      // Both browsers stay connected at the same time
      expect(companyWs.readyState).toBe(WebSocket.OPEN);
      expect(homeWs.readyState).toBe(WebSocket.OPEN);

      // OAuth metadata dynamically matches incoming Host port (e.g. :9444 vs :9443)
      await initializeOAuthClient(configPath, { redirectUris: ['https://gemini.google.com/oauth/callback'] });
      const prm9444 = await new Promise<{ status: number; body: { resource: string } }>((resolve, reject) => {
        const req = http.request({
          hostname: '127.0.0.1',
          port,
          path: '/.well-known/oauth-protected-resource',
          method: 'GET',
          headers: {
            Host: 'tunnel.example.com:9444',
            'X-Forwarded-Proto': 'https',
          },
        }, (response) => {
          const chunks: Buffer[] = [];
          response.on('data', (chunk: Buffer) => chunks.push(chunk));
          response.on('end', () => {
            resolve({
              status: response.statusCode ?? 0,
              body: JSON.parse(Buffer.concat(chunks).toString('utf8')) as { resource: string },
            });
          });
        });
        req.on('error', reject);
        req.end();
      });
      expect(prm9444.status).toBe(200);
      expect(prm9444.body.resource).toBe('https://tunnel.example.com:9444/mcp');

      // Initialize MCP session
      const initRes = await fetch(`http://127.0.0.1:${port}/mcp`, {
        method: 'POST',
        headers: {
          host: 'tunnel.example.com:9444',
          authorization: `Bearer ${token}`,
          'content-type': 'application/json',
        },
        body: JSON.stringify({
          jsonrpc: '2.0',
          id: 1,
          method: 'initialize',
          params: { protocolVersion: '2024-11-05', capabilities: {}, clientInfo: { name: 'gemini', version: '1.0' } },
        }),
      });
      const mcpSessionId = initRes.headers.get('mcp-session-id')!;

      // probe_status lists both devices and shows "家里" as active
      const statusRes = await fetch(`http://127.0.0.1:${port}/mcp`, {
        method: 'POST',
        headers: {
          host: 'tunnel.example.com:9444',
          authorization: `Bearer ${token}`,
          'content-type': 'application/json',
          'mcp-session-id': mcpSessionId,
        },
        body: JSON.stringify({
          jsonrpc: '2.0',
          id: 2,
          method: 'tools/call',
          params: { name: 'probe_status', arguments: {} },
        }),
      });
      const statusPayload = JSON.parse(
        ((await statusRes.json()) as JsonRpcResponse<CallResult>).result.content[0]!.text!,
      ) as { active_device: { device_name: string }; devices: Array<{ device_name: string }> };
      expect(statusPayload.active_device.device_name).toBe('家里');
      expect(statusPayload.devices.map((d) => d.device_name).sort()).toEqual(['公司', '家里']);

      // Start session without specifying device -> routes to active ("家里")
      const startHome = await fetch(`http://127.0.0.1:${port}/mcp`, {
        method: 'POST',
        headers: {
          host: 'tunnel.example.com:9444',
          authorization: `Bearer ${token}`,
          'content-type': 'application/json',
          'mcp-session-id': mcpSessionId,
        },
        body: JSON.stringify({
          jsonrpc: '2.0',
          id: 3,
          method: 'tools/call',
          params: { name: 'browser_start_session', arguments: { name: 'home-task' } },
        }),
      });
      const homeSessionId = (JSON.parse(
        ((await startHome.json()) as JsonRpcResponse<CallResult>).result.content[0]!.text!,
      ) as { session: { session_id: string } }).session.session_id;

      // Even if company becomes active later, existing homeSessionId stays bound to "家里"
      companyWs.send(JSON.stringify({
        type: 'extension_status',
        device_id: 'dev-company',
        device_name: '公司',
        last_active_at: 5_000,
      }));
      await new Promise((r) => setTimeout(r, 30));

      const homeTabsRes = await fetch(`http://127.0.0.1:${port}/mcp`, {
        method: 'POST',
        headers: {
          host: 'tunnel.example.com:9444',
          authorization: `Bearer ${token}`,
          'content-type': 'application/json',
          'mcp-session-id': mcpSessionId,
        },
        body: JSON.stringify({
          jsonrpc: '2.0',
          id: 4,
          method: 'tools/call',
          params: { name: 'browser_list_tabs', arguments: { session_id: homeSessionId } },
        }),
      });
      const homeTabs = JSON.parse(
        ((await homeTabsRes.json()) as JsonRpcResponse<CallResult>).result.content[0]!.text!,
      ) as { tabs: Array<{ title: string }> };
      expect(homeTabs.tabs[0]?.title).toBe('Home Tab');

      // Explicitly targeting "家里" when "公司" is active routes to "家里"
      const explicitStart = await fetch(`http://127.0.0.1:${port}/mcp`, {
        method: 'POST',
        headers: {
          host: 'tunnel.example.com:9444',
          authorization: `Bearer ${token}`,
          'content-type': 'application/json',
          'mcp-session-id': mcpSessionId,
        },
        body: JSON.stringify({
          jsonrpc: '2.0',
          id: 5,
          method: 'tools/call',
          params: { name: 'browser_start_session', arguments: { name: 'work-task', device: '公司' } },
        }),
      });
      const workSessionId = (JSON.parse(
        ((await explicitStart.json()) as JsonRpcResponse<CallResult>).result.content[0]!.text!,
      ) as { session: { session_id: string } }).session.session_id;

      const workTabsRes = await fetch(`http://127.0.0.1:${port}/mcp`, {
        method: 'POST',
        headers: {
          host: 'tunnel.example.com:9444',
          authorization: `Bearer ${token}`,
          'content-type': 'application/json',
          'mcp-session-id': mcpSessionId,
        },
        body: JSON.stringify({
          jsonrpc: '2.0',
          id: 6,
          method: 'tools/call',
          params: { name: 'browser_list_tabs', arguments: { session_id: workSessionId } },
        }),
      });
      const workTabs = JSON.parse(
        ((await workTabsRes.json()) as JsonRpcResponse<CallResult>).result.content[0]!.text!,
      ) as { tabs: Array<{ title: string }> };
      expect(workTabs.tabs[0]?.title).toBe('Company Tab');

      companyWs.close();
      homeWs.close();
    });
  });
});
