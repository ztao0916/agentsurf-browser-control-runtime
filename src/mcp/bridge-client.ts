import WebSocket, { type RawData } from 'ws';
import { readConfig } from '../native-host/config';
import { type ToolError } from '../core/protocol/errors';
import { type ToolName, type ToolRequest } from '../core/protocol/tool-contract';

const REQUEST_TIMEOUT_MS = 40_000;

export class LocalBridgeError extends Error {
  public readonly toolError: ToolError;

  public constructor(error: ToolError) {
    super(error.message);
    this.name = 'LocalBridgeError';
    this.toolError = error;
  }
}

/**
 * `session_id` travels at the root of the request, not inside `args`, because that is where
 * `parseToolRequest` reads it and where the runtime's ownership checks look for it. Without it a
 * session can claim a tab but nothing stops another session from driving that same tab.
 */
export async function callLocalBridge(
  tool: ToolName,
  args: ToolRequest['args'],
  sessionId?: string,
): Promise<unknown> {
  const configuredUrl = process.env.BROWSER_BRIDGE_URL;
  const configuredToken = process.env.BROWSER_BRIDGE_TOKEN;
  const config = configuredUrl !== undefined && configuredToken !== undefined ? undefined : await readConfig();
  const bridgeUrl = configuredUrl || `ws://127.0.0.1:${config?.port ?? 8765}`;
  const token = configuredToken || config?.token;
  if (!token) throw new Error('AgentSurf Bridge token is not configured.');
  const requestId = `mcp_${crypto.randomUUID()}`;

  return new Promise((resolve, reject) => {
    const socket = new WebSocket(bridgeUrl);
    let finished = false;
    let authenticated = false;

    const finish = (error?: Error, result?: unknown): void => {
      if (finished) return;
      finished = true;
      clearTimeout(timeout);
      socket.close();
      if (error === undefined) resolve(result);
      else reject(error);
    };

    const timeout = setTimeout(() => finish(new Error('AgentSurf request timed out.')), REQUEST_TIMEOUT_MS);

    socket.on('open', () => {
      socket.send(JSON.stringify({ type: 'auth', role: 'agent', token }));
    });
    socket.on('message', (data: RawData) => {
      let message: Record<string, unknown>;
      try {
        message = JSON.parse(rawDataToString(data)) as Record<string, unknown>;
      } catch {
        finish(new Error('AgentSurf returned an invalid response.'));
        return;
      }

      if (message.type === 'auth_result') {
        if (message.ok !== true) {
          finish(new LocalBridgeError(readToolError(message.error, 'AgentSurf authentication failed.')));
          return;
        }
        if (authenticated) return;
        authenticated = true;
        socket.send(JSON.stringify({
          protocol_version: '1',
          request_id: requestId,
          tool,
          args,
          ...(sessionId === undefined ? {} : { session_id: sessionId }),
        }));
        return;
      }
      if (message.type === 'ping' && typeof message.timestamp === 'number') {
        socket.send(JSON.stringify({ type: 'pong', timestamp: message.timestamp }));
        return;
      }
      if (message.request_id !== requestId) return;
      if (message.ok === true) finish(undefined, message.result);
      else finish(new LocalBridgeError(readToolError(message.error, 'AgentSurf returned an error.')));
    });
    socket.on('error', (error) => finish(new Error(`Cannot connect to AgentSurf: ${error.message}`)));
    socket.on('close', () => {
      if (!finished) finish(new Error('AgentSurf connection closed before a response was received.'));
    });
  });
}

function rawDataToString(data: RawData): string {
  if (Buffer.isBuffer(data)) return data.toString('utf8');
  if (data instanceof ArrayBuffer) return Buffer.from(data).toString('utf8');
  return Buffer.concat(data).toString('utf8');
}

function readToolError(value: unknown, fallback: string): ToolError {
  if (typeof value === 'object' && value !== null &&
    'code' in value && typeof value.code === 'string' &&
    'message' in value && typeof value.message === 'string' &&
    'retryable' in value && typeof value.retryable === 'boolean') {
    return {
      code: value.code as ToolError['code'],
      message: value.message,
      retryable: value.retryable,
      ...('details' in value && typeof value.details === 'object' && value.details !== null
        ? { details: value.details as Record<string, unknown> }
        : {}),
    };
  }
  return { code: 'internal_error', message: fallback, retryable: false };
}
