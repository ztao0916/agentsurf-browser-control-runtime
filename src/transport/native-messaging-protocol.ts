import type { ToolError } from '../core/protocol/errors';
import type { ExternalToolRequest, ExternalToolResponse } from './external-tool-protocol';

export const NATIVE_HOST_NAME = 'com.browsercontrol.runtime' as const;

export interface ExtensionHelloMessage {
  type: 'extension_hello';
  protocol_version: '1';
  extension_id: string;
}

export interface HostReadyMessage {
  type: 'host_ready';
  protocol_version: '1';
  bridge_url: string;
  authentication_required: true;
}

export interface NativeToolRequestMessage {
  type: 'tool_request';
  request: ExternalToolRequest;
}

export interface NativeToolResponseMessage {
  type: 'tool_response';
  response: ExternalToolResponse;
}

export interface NativePingMessage {
  type: 'ping';
  timestamp: number;
}

export interface NativePongMessage {
  type: 'pong';
  timestamp: number;
}

export interface NativeHostErrorMessage {
  type: 'host_error';
  error: ToolError;
}

export type ExtensionToHostMessage =
  | ExtensionHelloMessage
  | NativeToolResponseMessage
  | NativePingMessage
  | NativePongMessage;

export type HostToExtensionMessage =
  | HostReadyMessage
  | NativeToolRequestMessage
  | NativePingMessage
  | NativePongMessage
  | NativeHostErrorMessage;

export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

export function isHostReadyMessage(value: unknown): value is HostReadyMessage {
  return isRecord(value) && value.type === 'host_ready' && value.protocol_version === '1' &&
    typeof value.bridge_url === 'string' && value.authentication_required === true;
}

export function isNativeToolRequestMessage(value: unknown): value is NativeToolRequestMessage {
  return isRecord(value) && value.type === 'tool_request' && isRecord(value.request);
}

export function isNativeToolResponseMessage(value: unknown): value is NativeToolResponseMessage {
  return isRecord(value) && value.type === 'tool_response' && isRecord(value.response);
}

export function isNativePingMessage(value: unknown): value is NativePingMessage {
  return isRecord(value) && value.type === 'ping' && typeof value.timestamp === 'number';
}

export function isNativePongMessage(value: unknown): value is NativePongMessage {
  return isRecord(value) && value.type === 'pong' && typeof value.timestamp === 'number';
}

export function isNativeHostErrorMessage(value: unknown): value is NativeHostErrorMessage {
  return isRecord(value) && value.type === 'host_error' && isRecord(value.error);
}
