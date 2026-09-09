import { randomBytes, timingSafeEqual } from 'node:crypto';
import { WebSocket, WebSocketServer, type RawData } from 'ws';
import { createToolError, ToolFailure } from '../core/protocol/errors';
import {
  externalErrorResponse,
  getRequestId,
  isAuthMessage,
  isPingMessage,
  isPongMessage,
  isRecord,
  parseExternalToolRequest,
  parseJsonMessage,
  serializeMessage,
  toExternalToolRequest,
  type ConnectionRole,
  type ExternalToolResponse,
} from '../transport/external-tool-protocol';

export interface BrowserBridgeServerOptions {
  port?: number;
  token: string;
  requestTimeoutMs?: number;
  heartbeatIntervalMs?: number;
  heartbeatTimeoutMs?: number;
  log?: (message: string) => void;
}

interface ClientState {
  authenticated: boolean;
  role: ConnectionRole | null;
  awaitingPongSince: number | null;
}

interface PendingRequest {
  agent: WebSocket;
  timeout: ReturnType<typeof setTimeout>;
}

export type ExtensionRequestSender = (request: ReturnType<typeof toExternalToolRequest>) => void;

const AUTH_FAILURE_CODE = 4001;

export class BrowserBridgeServer {
  private readonly server: WebSocketServer;
  private readonly clients = new Map<WebSocket, ClientState>();
  private readonly pending = new Map<string, PendingRequest>();
  private extension: WebSocket | null = null;
  private nativeExtension: ExtensionRequestSender | null = null;
  private readonly requestTimeoutMs: number;
  private readonly heartbeatTimeoutMs: number;
  private readonly heartbeatTimer: ReturnType<typeof setInterval>;
  private readonly log: (message: string) => void;

  public constructor(private readonly options: BrowserBridgeServerOptions) {
    if (options.token.length < 16) throw new Error('Bridge token must contain at least 16 characters.');
    this.requestTimeoutMs = options.requestTimeoutMs ?? 35_000;
    this.heartbeatTimeoutMs = options.heartbeatTimeoutMs ?? 30_000;
    this.log = options.log ?? console.log;
    this.server = new WebSocketServer({ host: '127.0.0.1', port: options.port ?? 8765 });
    this.server.on('connection', (socket) => this.handleConnection(socket));
    this.heartbeatTimer = setInterval(() => this.sendExtensionHeartbeat(), options.heartbeatIntervalMs ?? 20_000);
  }

  public waitUntilListening(): Promise<number> {
    if (this.server.address() !== null) return Promise.resolve(this.getPort());
    return new Promise((resolve, reject) => {
      this.server.once('listening', () => resolve(this.getPort()));
      this.server.once('error', reject);
    });
  }

  public close(): Promise<void> {
    clearInterval(this.heartbeatTimer);
    this.failAllPending('transport_disconnected', 'Bridge server stopped.');
    for (const client of this.clients.keys()) client.close(1001, 'Bridge server stopped');
    this.nativeExtension = null;
    return new Promise((resolve, reject) => {
      this.server.close((error) => error === undefined ? resolve() : reject(error));
    });
  }

  public attachNativeExtension(sender: ExtensionRequestSender): () => void {
    if (this.nativeExtension !== null) {
      this.failAllPending('transport_disconnected', 'Native Extension connection was replaced.');
    }
    this.nativeExtension = sender;
    this.log('Native Extension connected.');
    return () => {
      if (this.nativeExtension !== sender) return;
      this.nativeExtension = null;
      this.failAllPending('transport_disconnected', 'Native Extension disconnected before completing the request.');
      this.log('Native Extension disconnected.');
    };
  }

  public receiveNativeExtensionResponse(message: unknown): void {
    this.handleExtensionResponse(message);
  }

  private getPort(): number {
    const address = this.server.address();
    if (address === null || typeof address === 'string') throw new Error('Bridge server is not listening.');
    return address.port;
  }

  private handleConnection(socket: WebSocket): void {
    this.clients.set(socket, { authenticated: false, role: null, awaitingPongSince: null });
    socket.on('message', (data, isBinary) => this.handleMessage(socket, data, isBinary));
    socket.on('close', (code, reason) => this.handleClose(socket, code, reason.toString('utf8')));
    socket.on('error', (error) => this.log(`WebSocket client error: ${error.message}`));
  }

  private handleMessage(socket: WebSocket, data: RawData, isBinary: boolean): void {
    let message: unknown;
    try {
      if (isBinary) throw new ToolFailure(createToolError('invalid_request', 'Binary messages are not supported.', false));
      message = parseJsonMessage(rawDataToString(data));
    } catch (error: unknown) {
      this.send(socket, externalErrorResponse('unknown', error));
      return;
    }

    const state = this.clients.get(socket);
    if (state === undefined) return;
    if (!state.authenticated) {
      this.authenticate(socket, state, message);
      return;
    }
    if (isPingMessage(message)) {
      this.send(socket, { type: 'pong', timestamp: message.timestamp });
      return;
    }
    if (isPongMessage(message)) {
      state.awaitingPongSince = null;
      return;
    }
    if (state.role === 'extension') {
      this.handleExtensionResponse(message);
    } else {
      this.handleAgentRequest(socket, message);
    }
  }

  private authenticate(socket: WebSocket, state: ClientState, message: unknown): void {
    if (!isAuthMessage(message) || !tokensEqual(message.token, this.options.token)) {
      this.send(socket, {
        type: 'auth_result',
        ok: false,
        error: createToolError('authentication_failed', 'Invalid authentication token or handshake.', false),
      });
      socket.close(AUTH_FAILURE_CODE, 'Authentication failed');
      return;
    }

    state.authenticated = true;
    state.role = message.role;
    if (message.role === 'extension') {
      if (this.extension !== null && this.extension !== socket) this.extension.close(4002, 'Replaced by new extension connection');
      this.extension = socket;
      this.log('Extension authenticated.');
    } else {
      this.log('Agent authenticated.');
    }
    this.send(socket, { type: 'auth_result', ok: true, role: message.role });
    if (message.role === 'extension') this.pingExtension(socket, state);
  }

  private handleAgentRequest(agent: WebSocket, message: unknown): void {
    const requestId = getRequestId(message);
    let request;
    try {
      request = parseExternalToolRequest(message);
    } catch (error: unknown) {
      this.send(agent, externalErrorResponse(requestId, error));
      return;
    }

    const websocketExtensionAvailable = this.extension !== null && this.extension.readyState === WebSocket.OPEN;
    if (this.nativeExtension === null && !websocketExtensionAvailable) {
      this.send(agent, externalErrorResponse(request.request_id, new ToolFailure(
        createToolError('bridge_unavailable', 'Chrome Extension is not connected.', true),
      )));
      return;
    }
    if (this.pending.has(request.request_id)) {
      this.send(agent, externalErrorResponse(request.request_id, new ToolFailure(
        createToolError('invalid_request', 'request_id is already pending.', false),
      )));
      return;
    }

    const timeout = setTimeout(() => {
      const pending = this.pending.get(request.request_id);
      if (pending === undefined) return;
      this.pending.delete(request.request_id);
      this.log(`Tool request timed out: ${request.tool} (${request.request_id}).`);
      this.send(pending.agent, externalErrorResponse(request.request_id, new ToolFailure(
        createToolError('request_timeout', 'Bridge timed out waiting for the Extension.', true),
      )));
    }, this.requestTimeoutMs);
    this.pending.set(request.request_id, { agent, timeout });
    this.log(`Forwarding Tool request: ${request.tool} (${request.request_id}).`);
    const externalRequest = toExternalToolRequest(request);
    if (this.nativeExtension !== null) {
      try {
        this.nativeExtension(externalRequest);
      } catch (error: unknown) {
        clearTimeout(timeout);
        this.pending.delete(request.request_id);
        this.send(agent, externalErrorResponse(request.request_id, error));
      }
    } else if (this.extension !== null) {
      this.send(this.extension, externalRequest);
    }
  }

  private handleExtensionResponse(message: unknown): void {
    if (!isExternalToolResponse(message)) {
      this.log('Ignored malformed Extension response.');
      return;
    }
    const pending = this.pending.get(message.request_id);
    if (pending === undefined) {
      this.log(`Ignored unmatched Extension response (${message.request_id}).`);
      return;
    }
    clearTimeout(pending.timeout);
    this.pending.delete(message.request_id);
    this.log(`Forwarding Tool response (${message.request_id}).`);
    this.send(pending.agent, message);
  }

  private handleClose(socket: WebSocket, code: number, reason: string): void {
    const state = this.clients.get(socket);
    this.clients.delete(socket);
    this.log(`${state?.role ?? 'unauthenticated'} connection closed (${code}${reason === '' ? '' : `: ${reason}`}).`);
    if (this.extension === socket) {
      this.extension = null;
      this.failAllPending('transport_disconnected', 'Chrome Extension disconnected before completing the request.');
    } else if (state?.role === 'agent') {
      for (const [requestId, pending] of this.pending) {
        if (pending.agent === socket) {
          clearTimeout(pending.timeout);
          this.pending.delete(requestId);
        }
      }
    }
  }

  private failAllPending(code: 'transport_disconnected', message: string): void {
    for (const [requestId, pending] of this.pending) {
      clearTimeout(pending.timeout);
      this.send(pending.agent, {
        request_id: requestId,
        ok: false,
        error: createToolError(code, message, true),
      } satisfies ExternalToolResponse);
    }
    this.pending.clear();
  }

  private send(socket: WebSocket, message: unknown): void {
    if (socket.readyState === WebSocket.OPEN) socket.send(serializeMessage(message));
  }

  private sendExtensionHeartbeat(): void {
    const extension = this.extension;
    if (extension === null || extension.readyState !== WebSocket.OPEN) return;
    const state = this.clients.get(extension);
    if (state === undefined) return;
    if (state.awaitingPongSince === null) {
      this.pingExtension(extension, state);
      return;
    }
    if (Date.now() - state.awaitingPongSince >= this.heartbeatTimeoutMs) {
      extension.close(4000, 'Heartbeat timeout');
    }
  }

  private pingExtension(extension: WebSocket, state: ClientState): void {
    const timestamp = Date.now();
    state.awaitingPongSince = timestamp;
    this.send(extension, { type: 'ping', timestamp });
  }
}

function isExternalToolResponse(value: unknown): value is ExternalToolResponse {
  if (!isRecord(value) || typeof value.request_id !== 'string' || typeof value.ok !== 'boolean') return false;
  return value.ok ? 'result' in value : isRecord(value.error);
}

function tokensEqual(received: string, expected: string): boolean {
  const receivedBuffer = Buffer.from(received);
  const expectedBuffer = Buffer.from(expected);
  return receivedBuffer.length === expectedBuffer.length && timingSafeEqual(receivedBuffer, expectedBuffer);
}

function rawDataToString(data: RawData): string {
  if (Buffer.isBuffer(data)) return data.toString('utf8');
  if (data instanceof ArrayBuffer) return Buffer.from(data).toString('utf8');
  return Buffer.concat(data).toString('utf8');
}

export async function runBridgeCli(): Promise<void> {
  const token = process.env.BROWSER_BRIDGE_TOKEN || randomBytes(32).toString('hex');
  const port = Number(process.env.BROWSER_BRIDGE_PORT || 8765);
  const bridge = new BrowserBridgeServer({ port, token });
  const actualPort = await bridge.waitUntilListening();
  console.log(`Browser Bridge listening on ws://127.0.0.1:${actualPort}`);
  console.log(`Authentication token: ${token}`);
  console.log('Set BROWSER_BRIDGE_TOKEN to reuse a stable development token.');

  const shutdown = (): void => {
    void bridge.close().finally(() => process.exit(0));
  };
  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
}
