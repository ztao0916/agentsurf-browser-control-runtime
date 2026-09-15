import type { ConsoleEntry } from '../core/protocol/tool-contract';

/**
 * The console collector runs in the MAIN world so it can observe the page's own console, while the
 * Page Agent runs in the isolated world and is the only side that can reach `chrome.runtime`. These
 * two halves talk over `window.postMessage`, so the channel shape lives here to keep them in sync.
 */
export const CONSOLE_CHANNEL = 'agentsurf-page-console';

export interface ConsoleQueryMessage {
  channel: typeof CONSOLE_CHANNEL;
  kind: 'query';
  request_id: string;
}

export interface ConsoleEntriesMessage {
  channel: typeof CONSOLE_CHANNEL;
  kind: 'entries';
  request_id: string;
  available: true;
  entries: ConsoleEntry[];
  dropped: number;
}

export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

export function isConsoleQueryMessage(value: unknown): value is ConsoleQueryMessage {
  return isRecord(value) && value.channel === CONSOLE_CHANNEL && value.kind === 'query' &&
    typeof value.request_id === 'string';
}

export function isConsoleEntriesMessage(value: unknown): value is ConsoleEntriesMessage {
  return isRecord(value) && value.channel === CONSOLE_CHANNEL && value.kind === 'entries' &&
    typeof value.request_id === 'string' && Array.isArray(value.entries);
}
