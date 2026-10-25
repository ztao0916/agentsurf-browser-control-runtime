import { createToolError, ToolFailure } from '../core/protocol/errors';
import { parseToolRequest } from '../core/protocol/schemas';
import type { ToolRequest, ToolResponse } from '../core/protocol/tool-contract';
import { externalErrorResponse, toExternalToolResponse } from './external-tool-protocol';
import {
  isHostReadyMessage,
  isNativeHostErrorMessage,
  isNativePingMessage,
  isNativePongMessage,
  isNativeToolRequestMessage,
  type ExtensionToHostMessage,
} from './native-messaging-protocol';
import type { NativeConnectionState, NativeTransportEvent } from './native-messaging-transport';
import type { TransportConnectionSnapshot } from './transport-control';

export interface RemoteGatewayTransportOptions {
  gatewayUrl?: string;
  token?: string;
  requestTimeoutMs?: number;
  reconnectBaseMs?: number;
  reconnectMaxMs?: number;
}

const GATEWAY_RECONNECT_ALARM = 'browser-control-gateway-reconnect';

interface PendingExecution {
  timeout: ReturnType<typeof setTimeout>;
}

export class RemoteGatewayTransport {
  private state: NativeConnectionState = 'disconnected';
  private socket: WebSocket | null = null;
  private gatewayUrl: string;
  private token: string;
  private reconnectAttempt = 0;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private shouldReconnect = false;
  private lastError: string | null = null;
  private readonly pending = new Map<string, PendingExecution>();
  private readonly requestTimeoutMs: number;
  private readonly reconnectBaseMs: number;
  private readonly reconnectMaxMs: number;

  public constructor(
    private readonly executeTool: (request: ToolRequest) => Promise<ToolResponse>,
    private readonly emitEvent: (event: NativeTransportEvent) => void,
    options: RemoteGatewayTransportOptions = {},
  ) {
    this.gatewayUrl = options.gatewayUrl ?? '';
    this.token = options.token ?? '';
    this.requestTimeoutMs = options.requestTimeoutMs ?? 35_000;
    this.reconnectBaseMs = options.reconnectBaseMs ?? 1_000;
    this.reconnectMaxMs = options.reconnectMaxMs ?? 30_000;

    if (typeof chrome !== 'undefined' && chrome.alarms) {
      chrome.alarms.onAlarm.addListener((alarm) => {
        if (alarm.name === GATEWAY_RECONNECT_ALARM && this.shouldReconnect && this.socket === null) {
          this.openSocket(true);
        }
      });
    }
  }

  public updateCredentials(gatewayUrl: string, token: string): void {
    this.gatewayUrl = gatewayUrl.trim();
    this.token = token.trim();
  }

  public connect(): void {
    if (!this.gatewayUrl) {
      this.setState('error', 'Gateway URL is not set.');
      return;
    }
    this.shouldReconnect = true;
    this.reconnectAttempt = 0;
    this.closeSocket();
    this.openSocket(false);
  }

  public disconnect(): void {
    this.shouldReconnect = false;
    this.clearReconnect();
    this.closeSocket();
    this.setState('disconnected', 'Remote gateway disconnected by user.');
  }

  public reconnect(): void {
    this.shouldReconnect = true;
    this.clearReconnect();
    this.closeSocket();
    this.openSocket(true);
  }

  public getSnapshot(): TransportConnectionSnapshot {
    return {
      mode: 'remote',
      transport: 'remote_gateway',
      state: this.state,
      gateway_url: this.gatewayUrl || null,
      reconnect_attempt: this.reconnectAttempt,
      pending_requests: this.pending.size,
      error: this.lastError,
    };
  }

  private openSocket(reconnecting: boolean): void {
    if (!this.gatewayUrl) {
      this.setState('error', 'Gateway URL is empty.');
      return;
    }

    this.setState(
      reconnecting ? 'reconnecting' : 'connecting',
      reconnecting ? 'Reconnecting to Remote Gateway…' : 'Connecting to Remote Gateway…',
    );

    let connectUrl: string;
    try {
      const parsed = new URL(this.gatewayUrl);
      if (this.token) {
        parsed.searchParams.set('token', this.token);
      }
      connectUrl = parsed.toString();
    } catch {
      this.lastError = `Invalid Gateway URL: ${this.gatewayUrl}`;
      this.setState('error', this.lastError);
      return;
    }

    try {
      const ws = new WebSocket(connectUrl);
      this.socket = ws;

      ws.onopen = () => {
        if (this.socket !== ws) return;
        this.send({
          type: 'extension_hello',
          protocol_version: '1',
          extension_id: typeof chrome !== 'undefined' && chrome.runtime?.id ? chrome.runtime.id : 'agentsurf-extension',
        });
      };

      ws.onmessage = (event) => {
        if (this.socket !== ws) return;
        let message: unknown;
        try {
          message = JSON.parse(typeof event.data === 'string' ? event.data : String(event.data));
        } catch {
          this.log('error', 'Gateway sent non-JSON message');
          return;
        }
        this.handleMessage(ws, message);
      };

      ws.onerror = () => {
        if (this.socket !== ws) return;
        this.lastError = 'Remote Gateway connection error';
        this.log('error', this.lastError);
      };

      ws.onclose = (event) => {
        if (this.socket !== ws) return;
        this.socket = null;
        this.failAllPending('transport_disconnected', 'Remote Gateway disconnected.');
        if (this.shouldReconnect) {
          const reason = event.reason ? `: ${event.reason}` : '';
          this.lastError = `Connection closed (code ${event.code}${reason})`;
          this.scheduleReconnect();
        } else {
          this.setState('disconnected', 'Disconnected from Remote Gateway.');
        }
      };
    } catch (error: unknown) {
      this.lastError = error instanceof Error ? error.message : String(error);
      this.log('error', this.lastError);
      this.scheduleReconnect();
    }
  }

  private handleMessage(_ws: WebSocket, message: unknown): void {
    if (isHostReadyMessage(message)) {
      this.reconnectAttempt = 0;
      this.lastError = null;
      this.clearReconnect();
      this.setState('connected', `Remote Gateway connected to ${this.gatewayUrl}`);
      return;
    }
    if (isNativePingMessage(message)) {
      this.send({ type: 'pong', timestamp: message.timestamp });
      return;
    }
    if (isNativePongMessage(message)) {
      return;
    }
    if (isNativeHostErrorMessage(message)) {
      this.lastError = message.error.message;
      this.log('error', message.error.message);
      this.setState('error', message.error.message);
      return;
    }
    if (isNativeToolRequestMessage(message)) {
      this.handleToolRequest(message.request);
      return;
    }
    this.log('error', 'Remote Gateway sent an unsupported message.');
  }

  private handleToolRequest(message: unknown): void {
    let request: ToolRequest;
    try {
      request = parseToolRequest({ ...(message as Record<string, unknown>), kind: 'tool-request' });
    } catch (error: unknown) {
      this.send({ type: 'tool_response', response: externalErrorResponse('unknown', error) });
      return;
    }

    if (this.pending.has(request.request_id)) {
      const error = new ToolFailure(createToolError(
        'invalid_request',
        `Request ${request.request_id} is already executing.`,
        false,
      ));
      this.send({ type: 'tool_response', response: externalErrorResponse(request.request_id, error) });
      return;
    }

    this.log('request', `Remote tool request: ${request.tool}`, request.request_id);
    const timeout = setTimeout(() => {
      if (!this.pending.delete(request.request_id)) return;
      this.send({
        type: 'tool_response',
        response: externalErrorResponse(request.request_id, new ToolFailure(
          createToolError('request_timeout', 'Browser Tool request timed out.', true),
        )),
      });
      this.log('error', 'Browser Tool request timed out.', request.request_id);
    }, this.requestTimeoutMs);
    this.pending.set(request.request_id, { timeout });

    void this.executeTool(request)
      .then((response) => {
        if (!this.pending.delete(request.request_id)) return;
        clearTimeout(timeout);
        this.send({ type: 'tool_response', response: toExternalToolResponse(response) });
        this.log('response', response.ok ? `Tool ${request.tool} succeeded` : `Tool ${request.tool} failed`, request.request_id);
      })
      .catch((error: unknown) => {
        if (!this.pending.delete(request.request_id)) return;
        clearTimeout(timeout);
        this.send({ type: 'tool_response', response: externalErrorResponse(request.request_id, error) });
        this.log('error', error instanceof Error ? error.message : String(error), request.request_id);
      });
  }

  private send(message: ExtensionToHostMessage): void {
    if (this.socket && this.socket.readyState === WebSocket.OPEN) {
      try {
        this.socket.send(JSON.stringify(message));
      } catch (error: unknown) {
        this.log('error', `Failed to send to Gateway: ${error instanceof Error ? error.message : String(error)}`);
      }
    }
  }

  private closeSocket(): void {
    if (this.socket !== null) {
      const ws = this.socket;
      this.socket = null;
      ws.onclose = null;
      ws.onerror = null;
      ws.onmessage = null;
      ws.onopen = null;
      try {
        ws.close(1000, 'Client closed');
      } catch { /* ignored */ }
    }
    this.failAllPending('transport_disconnected', 'Socket closed.');
  }

  private scheduleReconnect(): void {
    if (!this.shouldReconnect) return;
    this.clearReconnect();
    this.reconnectAttempt += 1;
    const delay = Math.min(
      this.reconnectBaseMs * 2 ** (this.reconnectAttempt - 1) + Math.random() * 500,
      this.reconnectMaxMs,
    );
    this.setState('reconnecting', `Reconnecting to Remote Gateway in ${Math.round(delay)}ms (attempt ${this.reconnectAttempt})…`);

    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      if (this.shouldReconnect && this.socket === null) this.openSocket(true);
    }, delay);

    if (typeof chrome !== 'undefined' && chrome.alarms) {
      chrome.alarms.create(GATEWAY_RECONNECT_ALARM, { delayInMinutes: Math.max(delay / 60_000, 0.5) });
    }
  }

  private clearReconnect(): void {
    if (this.reconnectTimer !== null) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
    if (typeof chrome !== 'undefined' && chrome.alarms) {
      chrome.alarms.clear(GATEWAY_RECONNECT_ALARM);
    }
  }

  private failAllPending(_code: 'transport_disconnected', message: string): void {
    for (const [requestId, entry] of this.pending.entries()) {
      clearTimeout(entry.timeout);
      this.log('error', message, requestId);
    }
    this.pending.clear();
  }

  private setState(state: NativeConnectionState, message: string): void {
    this.state = state;
    this.log('state', message, undefined, state);
  }

  private log(category: NativeTransportEvent['category'], message: string, requestId?: string, state?: NativeConnectionState): void {
    this.emitEvent({
      timestamp: Date.now(),
      category,
      message,
      ...(requestId === undefined ? {} : { request_id: requestId }),
      ...(state === undefined ? {} : { state }),
    });
  }
}
