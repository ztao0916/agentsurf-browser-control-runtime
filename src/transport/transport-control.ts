import type { ToolError } from '../core/protocol/errors';
import type { NativeConnectionSnapshot, NativeTransportEvent } from './native-messaging-transport';

export type TransportControlRequest =
  | { kind: 'transport-control'; action: 'connect' }
  | { kind: 'transport-control'; action: 'disconnect' }
  | { kind: 'transport-control'; action: 'reconnect' }
  | { kind: 'transport-control'; action: 'get-state' };

export type TransportControlResponse =
  | { ok: true; state: NativeConnectionSnapshot }
  | { ok: false; error: ToolError };

export interface TransportEventMessage {
  kind: 'transport-event';
  event: NativeTransportEvent;
}

export function isTransportControlRequest(value: unknown): value is TransportControlRequest {
  return typeof value === 'object' && value !== null && 'kind' in value && value.kind === 'transport-control' &&
    'action' in value && typeof value.action === 'string';
}

export function isTransportControlResponse(value: unknown): value is TransportControlResponse {
  if (typeof value !== 'object' || value === null || !('ok' in value) || typeof value.ok !== 'boolean') {
    return false;
  }
  return value.ok ? 'state' in value && typeof value.state === 'object' && value.state !== null :
    'error' in value && typeof value.error === 'object' && value.error !== null;
}
