import { createToolError, ToolFailure, toToolError } from '../core/protocol/errors';
import { parseToolRequest } from '../core/protocol/schemas';
import type { ToolRequest, ToolResponse } from '../core/protocol/tool-contract';
import { externalErrorResponse, toExternalToolResponse } from './external-tool-protocol';
import {
  NATIVE_HOST_NAME,
  isHostReadyMessage,
  isNativeHostErrorMessage,
  isNativePingMessage,
  isNativePongMessage,
  isNativeToolRequestMessage,
  type ExtensionToHostMessage,
} from './native-messaging-protocol';

export type NativeConnectionState = 'disconnected' | 'connecting' | 'connected' | 'reconnecting' | 'error';

export interface NativeConnectionSnapshot {
  transport: 'native_messaging';
  state: NativeConnectionState;
  host_name: string;
  bridge_url: string | null;
  reconnect_attempt: number;
  pending_requests: number;
  error: string | null;
}

export interface NativeTransportEvent {
  timestamp: number;
  category: 'state' | 'request' | 'response' | 'error';
  message: string;
  request_id?: string;
  state?: NativeConnectionState;
}

interface PendingExecution {
  timeout: ReturnType<typeof setTimeout>;
}

export interface NativeMessagingTransportOptions {
  hostName?: string;
  requestTimeoutMs?: number;
  reconnectBaseMs?: number;
  reconnectMaxMs?: number;
  connectNative?: (hostName: string) => chrome.runtime.Port;
  setTimeoutFn?: typeof setTimeout;
  clearTimeoutFn?: typeof clearTimeout;
}

const RECONNECT_ALARM = 'browser-control-native-reconnect';

export class NativeMessagingTransport {
  private state: NativeConnectionState = 'disconnected';
  private port: chrome.runtime.Port | null = null;
  private bridgeUrl: string | null = null;
  private reconnectAttempt = 0;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private shouldReconnect = false;
  private lastError: string | null = null;
  private readonly pending = new Map<string, PendingExecution>();
  private readonly hostName: string;
  private readonly requestTimeoutMs: number;
  private readonly reconnectBaseMs: number;
  private readonly reconnectMaxMs: number;
  private readonly connectNative: (hostName: string) => chrome.runtime.Port;
  private readonly setTimeoutFn: typeof setTimeout;
  private readonly clearTimeoutFn: typeof clearTimeout;

  public constructor(
    private readonly executeTool: (request: ToolRequest) => Promise<ToolResponse>,
    private readonly emitEvent: (event: NativeTransportEvent) => void,
    options: NativeMessagingTransportOptions = {},
  ) {
    this.hostName = options.hostName ?? NATIVE_HOST_NAME;
    this.requestTimeoutMs = options.requestTimeoutMs ?? 35_000;
    this.reconnectBaseMs = options.reconnectBaseMs ?? 1_000;
    this.reconnectMaxMs = options.reconnectMaxMs ?? 30_000;
    this.connectNative = options.connectNative ?? ((hostName) => chrome.runtime.connectNative(hostName));
    // Keep the browser global as the receiver. Calling a detached DOM timer
    // function as an object member throws "Illegal invocation" in Chrome.
    this.setTimeoutFn = options.setTimeoutFn ?? setTimeout.bind(globalThis);
    this.clearTimeoutFn = options.clearTimeoutFn ?? clearTimeout.bind(globalThis);
    chrome.alarms.onAlarm.addListener((alarm) => {
      if (alarm.name === RECONNECT_ALARM && this.shouldReconnect && this.port === null) this.openPort(true);
    });
  }

  public connect(): void {
    this.shouldReconnect = true;
    this.reconnectAttempt = 0;
    this.closePort();
    this.openPort(false);
  }

  public disconnect(): void {
    this.shouldReconnect = false;
    this.clearReconnect();
    this.closePort();
    this.setState('disconnected', 'Native Messaging disconnected by user.');
  }

  public reconnect(): void {
    this.shouldReconnect = true;
    this.clearReconnect();
    this.closePort();
    this.openPort(true);
  }

  public getSnapshot(): NativeConnectionSnapshot {
    return {
      transport: 'native_messaging',
      state: this.state,
      host_name: this.hostName,
      bridge_url: this.bridgeUrl,
      reconnect_attempt: this.reconnectAttempt,
      pending_requests: this.pending.size,
      error: this.lastError,
    };
  }

  private openPort(reconnecting: boolean): void {
    this.setState(reconnecting ? 'reconnecting' : 'connecting', reconnecting
      ? 'Reconnecting to Native Host.'
      : 'Connecting to Native Host.');
    try {
      const port = this.connectNative(this.hostName);
      this.port = port;
      port.onMessage.addListener((message: unknown) => this.handleMessage(port, message));
      port.onDisconnect.addListener(() => this.handleDisconnect(port));
      this.send(port, {
        type: 'extension_hello',
        protocol_version: '1',
        extension_id: chrome.runtime.id,
      });
    } catch (error: unknown) {
      this.lastError = error instanceof Error ? error.message : String(error);
      this.log('error', this.lastError);
      this.scheduleReconnect();
    }
  }

  private handleMessage(port: chrome.runtime.Port, message: unknown): void {
    if (this.port !== port) return;
    if (isHostReadyMessage(message)) {
      this.bridgeUrl = message.bridge_url;
      this.reconnectAttempt = 0;
      this.lastError = null;
      this.clearReconnect();
      this.setState('connected', `Native Host ready at ${message.bridge_url}.`);
      return;
    }
    if (isNativePingMessage(message)) {
      this.send(port, { type: 'pong', timestamp: message.timestamp });
      return;
    }
    if (isNativePongMessage(message)) return;
    if (isNativeHostErrorMessage(message)) {
      this.lastError = message.error.message;
      this.log('error', message.error.message);
      this.setState('error', message.error.message);
      return;
    }
    if (isNativeToolRequestMessage(message)) {
      this.handleToolRequest(port, message.request);
      return;
    }
    this.log('error', 'Native Host sent an unsupported message.');
  }

  private handleToolRequest(port: chrome.runtime.Port, message: unknown): void {
    let request: ToolRequest;
    try {
      request = parseToolRequest({ ...(message as Record<string, unknown>), kind: 'tool-request' });
    } catch (error: unknown) {
      this.send(port, { type: 'tool_response', response: externalErrorResponse('unknown', error) });
      return;
    }
    if (this.pending.has(request.request_id)) {
      const error = new ToolFailure(createToolError(
        'invalid_request',
        `Request ${request.request_id} is already executing.`,
        false,
      ));
      this.send(port, { type: 'tool_response', response: externalErrorResponse(request.request_id, error) });
      return;
    }

    this.log('request', `Tool request: ${request.tool}`, request.request_id);
    const timeout = this.setTimeoutFn(() => {
      if (!this.pending.delete(request.request_id)) return;
      this.send(port, {
        type: 'tool_response',
        response: externalErrorResponse(request.request_id, new ToolFailure(
          createToolError('request_timeout', 'Browser Tool request timed out.', true),
        )),
      });
      this.log('error', 'Browser Tool request timed out.', request.request_id);
    }, this.requestTimeoutMs);
    this.pending.set(request.request_id, { timeout });

    void this.executeTool(request)
      .then((response) => this.completeRequest(port, request.request_id, toExternalToolResponse(response)))
      .catch((error: unknown) => this.completeRequest(port, request.request_id, externalErrorResponse(request.request_id, error)));
  }

  private completeRequest(
    port: chrome.runtime.Port,
    requestId: string,
    response: ReturnType<typeof toExternalToolResponse>,
  ): void {
    const pending = this.pending.get(requestId);
    if (pending === undefined || this.port !== port) return;
    this.clearTimeoutFn(pending.timeout);
    this.pending.delete(requestId);
    this.send(port, { type: 'tool_response', response });
    this.log('response', response.ok ? 'Tool response completed.' : `Tool response error: ${response.error.code}`, requestId);
  }

  private handleDisconnect(port: chrome.runtime.Port): void {
    if (this.port !== port) return;
    this.port = null;
    this.bridgeUrl = null;
    this.clearPending();
    this.lastError = chrome.runtime.lastError?.message ?? 'Native Host disconnected.';
    this.log('error', this.lastError);
    if (this.shouldReconnect) this.scheduleReconnect();
    else this.setState('disconnected', 'Native Host disconnected.');
  }

  private scheduleReconnect(): void {
    if (!this.shouldReconnect || this.reconnectTimer !== null) return;
    this.reconnectAttempt += 1;
    const delay = Math.min(this.reconnectMaxMs, this.reconnectBaseMs * 2 ** (this.reconnectAttempt - 1));
    this.setState('reconnecting', `Native Host reconnect scheduled in ${delay}ms.`);
    this.reconnectTimer = this.setTimeoutFn(() => {
      this.reconnectTimer = null;
      if (this.shouldReconnect && this.port === null) this.openPort(true);
    }, delay);
    void chrome.alarms.create(RECONNECT_ALARM, { when: Date.now() + delay });
  }

  private clearReconnect(): void {
    if (this.reconnectTimer !== null) this.clearTimeoutFn(this.reconnectTimer);
    this.reconnectTimer = null;
    void chrome.alarms.clear(RECONNECT_ALARM);
  }

  private closePort(): void {
    const port = this.port;
    this.port = null;
    this.bridgeUrl = null;
    this.clearPending();
    if (port !== null) port.disconnect();
  }

  private clearPending(): void {
    for (const pending of this.pending.values()) this.clearTimeoutFn(pending.timeout);
    this.pending.clear();
  }

  private send(port: chrome.runtime.Port, message: ExtensionToHostMessage): void {
    if (this.port !== port) return;
    try {
      port.postMessage(message);
    } catch (error: unknown) {
      this.log('error', toToolError(error).message);
    }
  }

  private setState(state: NativeConnectionState, message: string): void {
    this.state = state;
    this.emitEvent({ timestamp: Date.now(), category: 'state', message, state });
  }

  private log(category: NativeTransportEvent['category'], message: string, requestId?: string): void {
    this.emitEvent({
      timestamp: Date.now(),
      category,
      message,
      ...(requestId === undefined ? {} : { request_id: requestId }),
    });
  }
}
