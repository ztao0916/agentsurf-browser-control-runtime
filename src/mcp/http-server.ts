import http from 'node:http';
import { randomUUID, timingSafeEqual } from 'node:crypto';
import { resolve } from 'node:path';
import { WebSocket, WebSocketServer } from 'ws';
import { z } from 'zod';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import { createToolError, ToolFailure } from '../core/protocol/errors';
import type { ToolName, ToolRequest } from '../core/protocol/tool-contract';
import { toExternalToolRequest } from '../transport/external-tool-protocol';
import {
  isNativePingMessage,
  isNativePongMessage,
  isNativeToolResponseMessage,
  isRecord,
  type HostToExtensionMessage,
} from '../transport/native-messaging-protocol';
import { callLocalBridge } from './bridge-client';
import {
  authenticates,
  getDefaultRemoteConfigPath,
  readRemoteConfig,
  tokenHash,
  type RemoteConfig,
} from './remote-config';
import { fileSessionStore, RemoteSessions } from './remote-sessions';
import {
  remoteDescriptionFor,
  buildRemoteToolSchemas,
  toContent,
} from './tool-definitions';

const PROBE_PNG_BASE64 = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==';

export function isValidHost(hostHeader: string | undefined, allowedHosts: readonly string[]): boolean {
  if (!hostHeader) return false;
  const normalized = hostHeader.toLowerCase().trim();
  const withoutPort = normalized.replace(/:\d+$/u, '');
  return allowedHosts.some((allowed) => {
    const a = allowed.toLowerCase().trim();
    if (a === normalized) return true;
    if (!a.includes(':') && a === withoutPort) return true;
    if (a.endsWith(':443') && a.slice(0, -4) === withoutPort) return true;
    if (a.endsWith(':80') && a.slice(0, -3) === withoutPort) return true;
    return false;
  });
}

export function isValidOrigin(originHeader: string | undefined, allowedOrigins: readonly string[]): boolean {
  if (!originHeader) return true;
  const normalized = originHeader.toLowerCase().trim();
  return allowedOrigins.some((allowed) => allowed.toLowerCase().trim() === normalized);
}

interface TransportSessionEntry {
  transport: StreamableHTTPServerTransport;
  server: McpServer;
  touched: number;
}

export interface RemoteServerHandle {
  server: http.Server;
  port: number;
  isExtensionConnected: () => boolean;
  close: () => Promise<void>;
}

interface PendingExtensionRequest {
  resolve: (value: unknown) => void;
  reject: (error: unknown) => void;
  timeout: ReturnType<typeof setTimeout>;
}

export async function startHttpMcpServer(options: {
  configPath?: string;
  sessionStorePath?: string;
} = {}): Promise<RemoteServerHandle> {
  const resolvedConfigPath = resolve(options.configPath ?? getDefaultRemoteConfigPath());
  let config: RemoteConfig = await readRemoteConfig(resolvedConfigPath);

  const resolvedSessionStorePath = resolve(
    options.sessionStorePath ?? resolvedConfigPath.replace(/\.json$/iu, '.sessions.json'),
  );

  let activeExtensionSocket: WebSocket | null = null;
  const pendingExtensionRequests = new Map<string, PendingExtensionRequest>();

  function dispatchToExtension(
    ws: WebSocket,
    tool: ToolName,
    args: unknown,
    sessionId: string,
    operationId?: string,
  ): Promise<unknown> {
    const requestId = `gw_${randomUUID()}`;
    const effectiveOpId = operationId ?? `op_${randomUUID()}`;
    const toolRequest = {
      kind: 'tool-request' as const,
      protocol_version: '1' as const,
      request_id: requestId,
      tool,
      args: args as ToolRequest['args'],
      session_id: sessionId,
      operation_id: effectiveOpId,
      turn_id: effectiveOpId,
      remote: true,
    } as unknown as ToolRequest;
    const payload: HostToExtensionMessage = {
      type: 'tool_request',
      request: toExternalToolRequest(toolRequest),
    };

    return new Promise((resolvePromise, rejectPromise) => {
      const timeout = setTimeout(() => {
        pendingExtensionRequests.delete(requestId);
        rejectPromise(new ToolFailure(createToolError('request_timeout', 'Browser action timed out after 35s.', true)));
      }, 35_000);

      pendingExtensionRequests.set(requestId, {
        resolve: (val) => {
          clearTimeout(timeout);
          resolvePromise(val);
        },
        reject: (err) => {
          clearTimeout(timeout);
          rejectPromise(err);
        },
        timeout,
      });

      try {
        ws.send(JSON.stringify(payload));
      } catch (err) {
        clearTimeout(timeout);
        pendingExtensionRequests.delete(requestId);
        rejectPromise(err);
      }
    });
  }

  const store = fileSessionStore(resolvedSessionStorePath);
  const remoteSessions = new RemoteSessions(store, async (tool, args, sessionId, operationId) => {
    // 1. Direct WSS connection from Chrome Extension
    if (activeExtensionSocket && activeExtensionSocket.readyState === WebSocket.OPEN) {
      return await dispatchToExtension(activeExtensionSocket, tool, args, sessionId, operationId);
    }

    // 2. Fallback to local bridge if configured and available (legacy / SSH tunnel mode)
    try {
      return await callLocalBridge(tool, args, sessionId, {
        remote: true,
        ...(operationId !== undefined ? { operationId } : {}),
        configPath: config.bridge_config,
      });
    } catch {
      throw new ToolFailure(createToolError(
        'bridge_unavailable',
        'AgentSurf Chrome extension is offline. Please open your Chrome browser and ensure AgentSurf is connected in Remote mode.',
        true,
      ));
    }
  });

  const transportSessions = new Map<string, TransportSessionEntry>();
  let effectiveAllowedHosts: readonly string[] = config.allowed_hosts;

  const sweepInterval = setInterval(() => {
    void remoteSessions.sweep().catch(() => undefined);
    const now = Date.now();
    for (const [id, session] of transportSessions.entries()) {
      if (now - session.touched > 30 * 60_000) {
        void session.transport.close().catch(() => undefined);
        transportSessions.delete(id);
      }
    }
  }, 5 * 60_000);
  sweepInterval.unref();

  const heartbeatInterval = setInterval(() => {
    if (activeExtensionSocket && activeExtensionSocket.readyState === WebSocket.OPEN) {
      try {
        activeExtensionSocket.send(JSON.stringify({ type: 'ping', timestamp: Date.now() }));
      } catch { /* ignore */ }
    }
  }, 20_000);
  heartbeatInterval.unref();

  function createRemoteServer(isAuthorized: () => Promise<boolean>): McpServer {
    const server = new McpServer(
      { name: 'agentsurf-remote', version: '0.7.0' },
      {
        instructions: [
          'AgentSurf controls the user\'s local Chrome browser over remote MCP.',
          '1. Start every browser task by calling browser_start_session with a session_name describing the goal. It returns a server-generated session_id.',
          '2. Every subsequent browser tool call MUST pass that session_id.',
          '3. Use browser_list_tabs to find tabs or browser_open to navigate.',
          '4. Before clicking or typing on elements, call browser_get_interactives to retrieve opaque element_ids. Never invent selectors or element IDs.',
          '5. If an operation fails with session_busy or operation_unknown, call browser_get_operation or browser_observe to inspect page state rather than retrying blindly.',
          '6. When the task is complete, call browser_end_session with session_id to release tab resources.',
        ].join(' '),
      },
    );

    server.registerTool('probe_echo', {
      title: 'probe_echo',
      description: 'Test MCP connection with echo text.',
      inputSchema: { text: z.string().optional().describe('Text to echo back') },
    }, (args): CallToolResult => ({
      content: [{ type: 'text', text: `AgentSurf probe OK: ${args.text ?? 'hello'}` }],
    }));

    server.registerTool('probe_image', {
      title: 'probe_image',
      description: 'Test MCP image delivery with a small static PNG.',
      inputSchema: {},
    }, (): CallToolResult => ({
      content: [
        { type: 'image', data: PROBE_PNG_BASE64, mimeType: 'image/png' },
        { type: 'text', text: JSON.stringify({ ok: true, width: 1, height: 1, format: 'png' }, null, 2) },
      ],
    }));

    server.registerTool('probe_status', {
      title: 'probe_status',
      description: 'Test MCP authentication and server status.',
      inputSchema: {},
    }, (): CallToolResult => ({
      content: [{
        type: 'text',
        text: JSON.stringify({
          ok: true,
          service: 'agentsurf-remote',
          principal: config.principal,
          port: config.port,
          mode: 'remote',
          extension_connected: activeExtensionSocket !== null && activeExtensionSocket.readyState === WebSocket.OPEN,
        }, null, 2),
      }],
    }));

    for (const [tool, schema] of Object.entries(buildRemoteToolSchemas(config.access_mode))) {
      const toolName = tool as ToolName;
      const mcpName = tool.replaceAll('.', '_');
      server.registerTool(mcpName, {
        title: mcpName,
        description: remoteDescriptionFor(toolName),
        inputSchema: schema,
      }, async (args: Record<string, unknown>): Promise<CallToolResult> => {
        try {
          const result = await remoteSessions.call(config.principal, toolName, args, isAuthorized, () => config.access_mode);
          return { content: toContent(toolName, result) };
        } catch (error: unknown) {
          if (error instanceof ToolFailure) {
            return {
              isError: true,
              content: [{ type: 'text', text: JSON.stringify({ error: error.toolError }, null, 2) }],
            };
          }
          const message = error instanceof Error ? error.message : String(error);
          return { isError: true, content: [{ type: 'text', text: `AgentSurf error: ${message}` }] };
        }
      });
    }

    return server;
  }

  const wss = new WebSocketServer({ noServer: true });

  const httpServer = http.createServer(async (req, res) => {
    const url = new URL(req.url ?? '/', `http://${req.headers.host ?? '127.0.0.1'}`);
    const pathname = url.pathname;

    if (pathname === '/healthz' || pathname === '/health' || pathname === '/status') {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({
        status: 'ok',
        service: 'agentsurf-remote',
        extension_connected: activeExtensionSocket !== null && activeExtensionSocket.readyState === WebSocket.OPEN,
      }));
      return;
    }

    if (!isValidHost(req.headers.host, effectiveAllowedHosts)) {
      res.writeHead(403, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'Forbidden: host not allowed' }));
      return;
    }

    if (!isValidOrigin(req.headers.origin, config.allowed_origins)) {
      res.writeHead(403, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'Forbidden: origin not allowed' }));
      return;
    }

    if (req.method === 'OPTIONS') {
      res.writeHead(204, {
        'Access-Control-Allow-Origin': req.headers.origin ?? '*',
        'Access-Control-Allow-Methods': 'GET, POST, DELETE, OPTIONS',
        'Access-Control-Allow-Headers': 'Authorization, Content-Type, Accept, Mcp-Session-Id',
        'Access-Control-Expose-Headers': 'Mcp-Session-Id',
        'Access-Control-Max-Age': '86400',
      });
      res.end();
      return;
    }

    if (req.headers.origin) {
      res.setHeader('Access-Control-Allow-Origin', req.headers.origin);
      res.setHeader('Access-Control-Expose-Headers', 'Mcp-Session-Id');
    }

    const authHeader = req.headers['authorization'];
    let authenticated = authenticates(authHeader, config);
    if (!authenticated) {
      try {
        const fresh = await readRemoteConfig(resolvedConfigPath);
        config = fresh;
        authenticated = authenticates(authHeader, config);
      } catch { /* retain existing config */ }
    }

    if (!authenticated) {
      res.writeHead(401, {
        'Content-Type': 'application/json',
        'WWW-Authenticate': 'Bearer error="invalid_token"',
      });
      res.end(JSON.stringify({ error: 'Unauthorized: missing or invalid Bearer token' }));
      return;
    }

    const contentLength = req.headers['content-length'];
    if (contentLength && parseInt(contentLength, 10) > 10 * 1024 * 1024) {
      res.writeHead(413, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'Payload Too Large: maximum 10MB' }));
      return;
    }

    const accept = req.headers['accept'] || '';
    if (!accept.includes('application/json') || !accept.includes('text/event-stream')) {
      req.headers['accept'] = 'application/json, text/event-stream';
    }

    const isAuthorized = async (): Promise<boolean> => {
      try {
        const current = await readRemoteConfig(resolvedConfigPath);
        config = current;
        return authenticates(authHeader, current);
      } catch {
        return authenticates(authHeader, config);
      }
    };

    const mcpSessionId = req.headers['mcp-session-id'];
    if (mcpSessionId && typeof mcpSessionId === 'string') {
      const entry = transportSessions.get(mcpSessionId);
      if (!entry) {
        res.writeHead(404, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ jsonrpc: '2.0', error: { code: -32001, message: 'Session not found' }, id: null }));
        return;
      }
      entry.touched = Date.now();
      await entry.transport.handleRequest(req, res);
      return;
    }

    let assignedSessionId: string | undefined;
    const server = createRemoteServer(isAuthorized);
    const transport = new StreamableHTTPServerTransport({
      sessionIdGenerator: () => randomUUID(),
      enableJsonResponse: true,
      onsessioninitialized: (id) => {
        assignedSessionId = id;
        transportSessions.set(id, { transport, server, touched: Date.now() });
      },
      onsessionclosed: (id) => {
        transportSessions.delete(id);
      },
    });
    await server.connect(transport as Parameters<typeof server.connect>[0]);
    await transport.handleRequest(req, res);
    if (!assignedSessionId) {
      await transport.close().catch(() => undefined);
    }
  });

  httpServer.on('upgrade', async (req, socket, head) => {
    const url = new URL(req.url ?? '/', `http://${req.headers.host ?? '127.0.0.1'}`);
    const pathname = url.pathname;

    if (pathname === '/ws' || pathname === '/extension/ws') {
      const queryToken = url.searchParams.get('token');
      const authHeader = req.headers['authorization'];
      const bearerToken = authHeader?.startsWith('Bearer ') ? authHeader.slice(7) : undefined;
      const token = queryToken || bearerToken;

      const isTokenValid = (candidate: string | undefined): boolean => {
        if (!candidate || candidate.length > 4096) return false;
        try {
          return timingSafeEqual(Buffer.from(tokenHash(candidate), 'hex'), Buffer.from(config.token_hash, 'hex'));
        } catch {
          return false;
        }
      };

      let valid = isTokenValid(token);
      if (!valid) {
        try {
          const fresh = await readRemoteConfig(resolvedConfigPath);
          config = fresh;
          valid = isTokenValid(token);
        } catch { /* retain existing config */ }
      }

      if (!valid) {
        socket.write('HTTP/1.1 401 Unauthorized\r\nConnection: close\r\n\r\n');
        socket.destroy();
        return;
      }

      wss.handleUpgrade(req, socket, head, (ws) => {
        if (activeExtensionSocket && activeExtensionSocket !== ws) {
          try {
            activeExtensionSocket.close(1000, 'Replaced by new browser connection');
          } catch { /* ignored */ }
        }
        activeExtensionSocket = ws;

        ws.on('message', (raw) => {
          let message: unknown;
          try {
            message = JSON.parse(raw.toString());
          } catch { return; }

          if (isRecord(message) && message.type === 'extension_hello') {
            ws.send(JSON.stringify({
              type: 'host_ready',
              protocol_version: '1',
              bridge_url: 'cloud-gateway',
              authentication_required: true,
            }));
            return;
          }
          if (isNativePingMessage(message)) {
            ws.send(JSON.stringify({ type: 'pong', timestamp: message.timestamp }));
            return;
          }
          if (isNativePongMessage(message)) {
            return;
          }
          if (isNativeToolResponseMessage(message)) {
            const resp = message.response;
            const pending = pendingExtensionRequests.get(resp.request_id);
            if (pending) {
              pendingExtensionRequests.delete(resp.request_id);
              if (resp.ok) {
                pending.resolve(resp.result);
              } else {
                pending.reject(new ToolFailure(resp.error));
              }
            }
          }
        });

        ws.on('close', () => {
          if (activeExtensionSocket === ws) {
            activeExtensionSocket = null;
            for (const [, pending] of pendingExtensionRequests.entries()) {
              clearTimeout(pending.timeout);
              pending.reject(new ToolFailure(createToolError('bridge_unavailable', 'Chrome extension disconnected during execution.', true)));
            }
            pendingExtensionRequests.clear();
          }
        });
      });
    } else {
      socket.destroy();
    }
  });

  await new Promise<void>((resolvePromise, rejectPromise) => {
    httpServer.listen(config.port, '127.0.0.1', () => {
      resolvePromise();
    });
    httpServer.once('error', rejectPromise);
  });

  const address = httpServer.address();
  const actualPort = typeof address === 'object' && address !== null ? address.port : config.port;
  effectiveAllowedHosts = [
    ...config.allowed_hosts,
    `127.0.0.1:${actualPort}`,
    `localhost:${actualPort}`,
  ];

  const close = async (): Promise<void> => {
    clearInterval(sweepInterval);
    clearInterval(heartbeatInterval);
    if (activeExtensionSocket) {
      try { activeExtensionSocket.close(1000, 'Server shutting down'); } catch { }
      activeExtensionSocket = null;
    }
    await new Promise<void>((res) => {
      httpServer.close(() => res());
    });
    for (const session of transportSessions.values()) {
      await session.transport.close().catch(() => undefined);
    }
    transportSessions.clear();
    await remoteSessions.close();
  };

  return {
    server: httpServer,
    port: actualPort,
    isExtensionConnected: () => activeExtensionSocket !== null && activeExtensionSocket.readyState === WebSocket.OPEN,
    close,
  };
}
