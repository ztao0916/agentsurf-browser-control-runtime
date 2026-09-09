import { createToolError, ToolFailure, toToolError } from '../core/protocol/errors';
import type { ToolError } from '../core/protocol/errors';
import { parseToolRequest } from '../core/protocol/schemas';
import type { PROTOCOL_VERSION, ToolRequest, ToolResponse } from '../core/protocol/tool-contract';

export type ConnectionRole = 'extension' | 'agent';

export interface AuthMessage {
  type: 'auth';
  role: ConnectionRole;
  token: string;
}

export type AuthResultMessage =
  | { type: 'auth_result'; ok: true; role: ConnectionRole }
  | { type: 'auth_result'; ok: false; error: ToolError };

export interface PingMessage {
  type: 'ping';
  timestamp: number;
}

export interface PongMessage {
  type: 'pong';
  timestamp: number;
}

export interface ExternalToolRequest {
  protocol_version: typeof PROTOCOL_VERSION;
  request_id: string;
  session_id?: string;
  turn_id?: string;
  tool: string;
  args: ToolRequest['args'];
}

export type ExternalToolResponse =
  | { request_id: string; ok: true; result: unknown }
  | { request_id: string; ok: false; error: ToolError };

export function parseJsonMessage(data: unknown): unknown {
  if (typeof data !== 'string') {
    throw new ToolFailure(createToolError('invalid_request', 'WebSocket messages must be JSON text.', false));
  }
  try {
    return JSON.parse(data) as unknown;
  } catch {
    throw new ToolFailure(createToolError('invalid_request', 'WebSocket message is not valid JSON.', false));
  }
}

export function parseExternalToolRequest(value: unknown): ToolRequest {
  if (!isRecord(value)) {
    throw new ToolFailure(createToolError('invalid_request', 'Tool request must be an object.', false));
  }
  return parseToolRequest({ ...value, kind: 'tool-request' });
}

export function toExternalToolRequest(request: ToolRequest): ExternalToolRequest {
  return {
    protocol_version: request.protocol_version,
    request_id: request.request_id,
    ...(request.session_id === undefined ? {} : { session_id: request.session_id }),
    ...(request.turn_id === undefined ? {} : { turn_id: request.turn_id }),
    tool: request.tool,
    args: request.args,
  };
}

export function toExternalToolResponse(response: ToolResponse): ExternalToolResponse {
  return response.ok
    ? { request_id: response.request_id, ok: true, result: response.result }
    : { request_id: response.request_id, ok: false, error: response.error };
}

export function externalErrorResponse(requestId: string, error: unknown): ExternalToolResponse {
  return { request_id: requestId, ok: false, error: toToolError(error) };
}

export function isAuthMessage(value: unknown): value is AuthMessage {
  return isRecord(value) && value.type === 'auth' &&
    (value.role === 'extension' || value.role === 'agent') && typeof value.token === 'string';
}

export function isAuthResultMessage(value: unknown): value is AuthResultMessage {
  return isRecord(value) && value.type === 'auth_result' && typeof value.ok === 'boolean';
}

export function isPingMessage(value: unknown): value is PingMessage {
  return isRecord(value) && value.type === 'ping' && typeof value.timestamp === 'number';
}

export function isPongMessage(value: unknown): value is PongMessage {
  return isRecord(value) && value.type === 'pong' && typeof value.timestamp === 'number';
}

export function getRequestId(value: unknown): string {
  return isRecord(value) && typeof value.request_id === 'string' ? value.request_id : 'unknown';
}

export function serializeMessage(value: unknown): string {
  return JSON.stringify(value);
}

export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}
