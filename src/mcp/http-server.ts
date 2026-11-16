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
  isExtensionStatusMessage,
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
import { OAuthService, resolvePublicIssuer } from './remote-oauth';
import { fileSessionStore, RemoteSessions } from './remote-sessions';
import {
  annotationsFor,
  PROBE_TOOL_ANNOTATIONS,
  remoteDescriptionFor,
  buildRemoteToolSchemas,
  toContent,
} from './tool-definitions';

const PROBE_PNG_BASE64 = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==';

function stripPort(host: string): string {
  const normalized = host.toLowerCase().trim();
  return normalized.startsWith('[')
    ? normalized.replace(/\]:\d+$/u, ']')
    : normalized.replace(/:\d+$/u, '');
}

function isLoopbackHost(host: string): boolean {
  const withoutPort = stripPort(host);
  return withoutPort === '127.0.0.1' || withoutPort === 'localhost' || withoutPort === '[::1]';
}

export function isValidHost(hostHeader: string | undefined, allowedHosts: readonly string[]): boolean {
  if (!hostHeader) return false;
  const normalized = hostHeader.toLowerCase().trim();
  const withoutPort = stripPort(normalized);
  return allowedHosts.some((allowed) => {
    const a = allowed.toLowerCase().trim();
    if (a === normalized) return true;
    if (!isLoopbackHost(a)) return stripPort(a) === withoutPort;
    if (a.endsWith(':443') && a.slice(0, -4) === withoutPort) return true;
    if (a.endsWith(':80') && a.slice(0, -3) === withoutPort) return true;
    return false;
  });
}

export function isValidOrigin(
  originHeader: string | undefined,
  allowedOrigins: readonly string[],
  allowedHosts: readonly string[] = [],
): boolean {
  if (!originHeader) return true;
  const normalized = originHeader.toLowerCase().trim();
  if (allowedOrigins.some((allowed) => allowed.toLowerCase().trim() === normalized)) {
    return true;
  }
  if (allowedHosts.length === 0) return false;
  try {
    const parsed = new URL(normalized);
    if (parsed.protocol !== 'https:' || isLoopbackHost(parsed.hostname)) return false;
    return isValidHost(parsed.host, allowedHosts);
  } catch {
    return false;
  }
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
  deviceKey: string;
}

interface ConnectedExtension {
  key: string;
  deviceId: string;
  deviceName: string;
  ws: WebSocket;
  connectedAt: number;
  lastActiveAt: number;
  pinned: boolean;
  pendingRequestIds: Set<string>;
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

  const connectedExtensions = new Map<string, ConnectedExtension>();
  const pendingExtensionRequests = new Map<string, PendingExtensionRequest>();

  function getOpenExtensions(): ConnectedExtension[] {
    return [...connectedExtensions.values()].filter((ext) => ext.ws.readyState === WebSocket.OPEN);
  }

  function resolveTargetExtension(deviceHint?: string): ConnectedExtension | null {
    const open = getOpenExtensions();
    if (deviceHint) {
      const normalized = deviceHint.trim().toLowerCase();
      const matched = open.find(
        (ext) => ext.deviceId.toLowerCase() === normalized || ext.deviceName.toLowerCase() === normalized,
      );
      if (!matched) {
        const available = open.length > 0
          ? open.map((ext) => `${ext.deviceName} (${ext.deviceId})`).join(', ')
          : 'none';
        throw new ToolFailure(createToolError(
          'bridge_unavailable',
          `Browser device "${deviceHint}" is offline. Connected devices: ${available}.`,
          true,
        ));
      }
      return matched;
    }
    if (open.length === 0) return null;
    const pinned = open.filter((ext) => ext.pinned);
    const candidates = pinned.length > 0 ? pinned : open;
    return [...candidates].sort((a, b) => (b.lastActiveAt - a.lastActiveAt) || (b.connectedAt - a.connectedAt))[0] ?? null;
  }

  function dispatchToExtension(
    target: ConnectedExtension,
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
        target.pendingRequestIds.delete(requestId);
        rejectPromise(new ToolFailure(createToolError('request_timeout', 'Browser action timed out after 35s.', true)));
      }, 35_000);

      target.pendingRequestIds.add(requestId);
      pendingExtensionRequests.set(requestId, {
        deviceKey: target.key,
        resolve: (val) => {
          clearTimeout(timeout);
          target.pendingRequestIds.delete(requestId);
          resolvePromise(val);
        },
        reject: (err) => {
          clearTimeout(timeout);
          target.pendingRequestIds.delete(requestId);
          rejectPromise(err instanceof Error ? err : new Error(String(err)));
        },
        timeout,
      });

      try {
        target.ws.send(JSON.stringify(payload));
      } catch (err) {
        clearTimeout(timeout);
        pendingExtensionRequests.delete(requestId);
        target.pendingRequestIds.delete(requestId);
        rejectPromise(err instanceof Error ? err : new Error(String(err)));
      }
    });
  }

  const store = fileSessionStore(resolvedSessionStorePath);
  const remoteSessions = new RemoteSessions(store, async (tool, args, sessionId, operationId, deviceHint) => {
    // 1. Direct WSS connection from Chrome Extension (routed to bound or active device)
    const target = resolveTargetExtension(deviceHint);
    if (target) {
      const result = await dispatchToExtension(target, tool, args, sessionId, operationId);
      if (tool === 'browser.start_session' && typeof result === 'object' && result !== null && !Array.isArray(result)) {
        return {
          ...(result as Record<string, unknown>),
          device: { device_id: target.deviceId, device_name: target.deviceName },
        };
      }
      return result;
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
    const ping = JSON.stringify({ type: 'ping', timestamp: Date.now() });
    for (const ext of getOpenExtensions()) {
      try {
        ext.ws.send(ping);
      } catch { /* ignore */ }
    }
  }, 20_000);
  heartbeatInterval.unref();

  function createRemoteServer(isAuthorized: () => Promise<boolean>, defaultDevice?: string): McpServer {
    const server = new McpServer(
      { name: 'agentsurf-remote', version: '0.7.0' },
      {
        instructions: [
          'AgentSurf controls the user\'s local Chrome browser over remote MCP.',
          '1. Start every browser task by calling browser_start_session with a session_name describing the goal. It returns a server-generated session_id.',
          '2. Every subsequent browser tool call MUST pass that session_id.',
          '3. If multiple browsers are connected, pass device (from probe_status) to browser_start_session to target a specific computer; otherwise the currently active browser is used automatically.',
          '4. Use browser_list_tabs to find tabs or browser_open to navigate.',
          '5. Before clicking or typing on elements, call browser_get_interactives to retrieve opaque element_ids. Never invent selectors or element IDs.',
          '6. If an operation fails with session_busy or operation_unknown, call browser_get_operation or browser_observe to inspect page state rather than retrying blindly.',
          '7. When the task is complete, call browser_end_session with session_id to release tab resources.',
        ].join(' '),
      },
    );

    server.registerTool('probe_echo', {
      title: 'probe_echo',
      description: 'Test MCP connection with echo text.',
      inputSchema: { text: z.string().optional().describe('Text to echo back') },
      annotations: PROBE_TOOL_ANNOTATIONS,
    }, (args): CallToolResult => ({
      content: [{ type: 'text', text: `AgentSurf probe OK: ${args.text ?? 'hello'}` }],
    }));

    server.registerTool('probe_image', {
      title: 'probe_image',
      description: 'Test MCP image delivery with a small static PNG.',
      inputSchema: {},
      annotations: PROBE_TOOL_ANNOTATIONS,
    }, (): CallToolResult => ({
      content: [
        { type: 'image', data: PROBE_PNG_BASE64, mimeType: 'image/png' },
        { type: 'text', text: JSON.stringify({ ok: true, width: 1, height: 1, format: 'png' }, null, 2) },
      ],
    }));

    server.registerTool('probe_status', {
      title: 'probe_status',
      description: 'Test MCP authentication, server status, and list connected browser devices.',
      inputSchema: {},
      annotations: PROBE_TOOL_ANNOTATIONS,
    }, (): CallToolResult => {
      const openDevices = getOpenExtensions();
      const active = resolveTargetExtension(defaultDevice);
      return {
        content: [{
          type: 'text',
          text: JSON.stringify({
            ok: true,
            service: 'agentsurf-remote',
            principal: config.principal,
            port: config.port,
            mode: 'remote',
            extension_connected: openDevices.length > 0,
            active_device: active ? { device_id: active.deviceId, device_name: active.deviceName } : null,
            devices: openDevices.map((ext) => ({
              device_id: ext.deviceId,
              device_name: ext.deviceName,
              active: active?.key === ext.key,
              pinned: ext.pinned,
              last_active_at: ext.lastActiveAt,
            })),
          }, null, 2),
        }],
      };
    });

    for (const [tool, schema] of Object.entries(buildRemoteToolSchemas(config.access_mode))) {
      const toolName = tool as ToolName;
      const mcpName = tool.replaceAll('.', '_');
      server.registerTool(mcpName, {
        title: mcpName,
        description: remoteDescriptionFor(toolName),
        inputSchema: schema,
        annotations: annotationsFor(toolName),
      }, async (args: Record<string, unknown>): Promise<CallToolResult> => {
        try {
          const effectiveArgs = toolName === 'browser.start_session' && args['device'] === undefined && defaultDevice !== undefined
            ? { ...args, device: defaultDevice }
            : args;
          const result = await remoteSessions.call(config.principal, toolName, effectiveArgs, isAuthorized, () => config.access_mode);
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

  const getLatestConfig = async (): Promise<RemoteConfig> => {
    try {
      config = await readRemoteConfig(resolvedConfigPath);
    } catch { /* retain existing config */ }
    return config;
  };
  const oauthService = new OAuthService(getLatestConfig);

  const wss = new WebSocketServer({ noServer: true });

  const httpServer = http.createServer(async (req, res) => {
    const url = new URL(req.url ?? '/', `http://${req.headers.host ?? '127.0.0.1'}`);
    const pathname = url.pathname;

    if (pathname === '/healthz' || pathname === '/health' || pathname === '/status') {
      const openDevices = getOpenExtensions();
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({
        status: 'ok',
        service: 'agentsurf-remote',
        extension_connected: openDevices.length > 0,
        connected_devices: openDevices.length,
      }));
      return;
    }

    if (!isValidHost(req.headers.host, effectiveAllowedHosts)) {
      res.writeHead(403, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'Forbidden: host not allowed' }));
      return;
    }

    if (!isValidOrigin(req.headers.origin, config.allowed_origins, effectiveAllowedHosts)) {
      await getLatestConfig();
      if (!isValidOrigin(req.headers.origin, config.allowed_origins, effectiveAllowedHosts)) {
        res.writeHead(403, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'Forbidden: origin not allowed' }));
        return;
      }
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

    if (await oauthService.handleRequest(req, res, url)) {
      return;
    }

    const authHeader = req.headers['authorization'];
    const currentConfig = await getLatestConfig();
    const authenticated = authenticates(authHeader, currentConfig);

    if (!authenticated) {
      const wwwAuthenticate = config.oauth
        ? (authHeader
            ? `Bearer error="invalid_token", resource_metadata="${resolvePublicIssuer(req, config)}/.well-known/oauth-protected-resource"`
            : `Bearer resource_metadata="${resolvePublicIssuer(req, config)}/.well-known/oauth-protected-resource"`)
        : 'Bearer error="invalid_token"';
      res.writeHead(401, {
        'Content-Type': 'application/json',
        'WWW-Authenticate': wwwAuthenticate,
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
    const defaultDevice = url.searchParams.get('device')?.trim() || undefined;
    const server = createRemoteServer(isAuthorized, defaultDevice);
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
        const tempKey = `pending_${randomUUID()}`;
        const now = Date.now();
        const queryDevice = url.searchParams.get('device')?.trim();
        const entry: ConnectedExtension = {
          key: tempKey,
          deviceId: 'default',
          deviceName: queryDevice || 'Chrome',
          ws,
          connectedAt: now,
          lastActiveAt: 0,
          pinned: false,
          pendingRequestIds: new Set(),
        };
        connectedExtensions.set(tempKey, entry);

        const assignDeviceKey = (deviceId: string, deviceName: string): void => {
          const existing = connectedExtensions.get(deviceId);
          if (existing && existing !== entry && existing.ws !== ws) {
            try {
              existing.ws.close(1000, 'Replaced by newer connection for same device');
            } catch { /* ignored */ }
          }
          if (entry.key !== deviceId) {
            connectedExtensions.delete(entry.key);
            entry.key = deviceId;
          }
          entry.deviceId = deviceId;
          entry.deviceName = deviceName;
          connectedExtensions.set(deviceId, entry);
        };

        const applyPinned = (pinned: boolean): void => {
          if (pinned) {
            for (const other of connectedExtensions.values()) {
              if (other !== entry) other.pinned = false;
            }
          }
          entry.pinned = pinned;
        };

        ws.on('message', (raw) => {
          let message: unknown;
          try {
            const text = typeof raw === 'string'
              ? raw
              : Buffer.isBuffer(raw)
                ? raw.toString('utf8')
                : Array.isArray(raw)
                  ? Buffer.concat(raw).toString('utf8')
                  : Buffer.from(raw).toString('utf8');
            message = JSON.parse(text);
          } catch { return; }

          if (isRecord(message) && message.type === 'extension_hello') {
            const rawId = typeof message.device_id === 'string' ? message.device_id.trim() : '';
            const deviceId = rawId || 'default';
            const rawName = typeof message.device_name === 'string' ? message.device_name.trim() : '';
            const deviceName = rawName || queryDevice || (deviceId === 'default' ? 'Chrome' : deviceId);
            assignDeviceKey(deviceId, deviceName);
            if (typeof message.last_active_at === 'number' && message.last_active_at > 0) {
              entry.lastActiveAt = Math.max(entry.lastActiveAt, message.last_active_at);
            }
            if (typeof message.pinned === 'boolean') {
              applyPinned(message.pinned);
            }
            ws.send(JSON.stringify({
              type: 'host_ready',
              protocol_version: '1',
              bridge_url: 'cloud-gateway',
              authentication_required: true,
            }));
            return;
          }
          if (isExtensionStatusMessage(message)) {
            const deviceId = message.device_id.trim() || 'default';
            const deviceName = message.device_name.trim() || entry.deviceName;
            assignDeviceKey(deviceId, deviceName);
            if (message.last_active_at > 0) {
              entry.lastActiveAt = Math.max(entry.lastActiveAt, message.last_active_at);
            }
            if (typeof message.pinned === 'boolean') {
              applyPinned(message.pinned);
            }
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
          if (connectedExtensions.get(entry.key)?.ws === ws) {
            connectedExtensions.delete(entry.key);
          }
          for (const requestId of entry.pendingRequestIds) {
            const pending = pendingExtensionRequests.get(requestId);
            if (pending) {
              pendingExtensionRequests.delete(requestId);
              clearTimeout(pending.timeout);
              pending.reject(new ToolFailure(createToolError('bridge_unavailable', 'Chrome extension disconnected during execution.', true)));
            }
          }
          entry.pendingRequestIds.clear();
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
    for (const ext of connectedExtensions.values()) {
      try { ext.ws.close(1000, 'Server shutting down'); } catch { /* ignore */ }
    }
    connectedExtensions.clear();
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
    isExtensionConnected: () => getOpenExtensions().length > 0,
    close,
  };
}
