import type { ToolName } from './protocol/tool-contract';

export const REMOTE_READ_TOOLS: readonly ToolName[] = [
  'browser.list_tabs', 'browser.get_frames', 'browser.get_page', 'browser.get_interactives',
  'browser.get_page_content', 'browser.screenshot', 'browser.observe',
];

export const REMOTE_EXCLUDED_TOOLS: readonly ToolName[] = [
  'browser.reset_sessions', 'browser.set_files', 'browser.list_downloads', 'browser.wait_for_download',
];

export type RemoteAccessMode = 'read-only' | 'interactive';

const REMOTE_SESSION_TOOLS: readonly ToolName[] = [
  'browser.start_session', 'browser.end_session', 'browser.get_operation',
];

export function isRemoteToolAllowed(tool: ToolName, mode: RemoteAccessMode): boolean {
  if (REMOTE_EXCLUDED_TOOLS.includes(tool)) return false;
  return mode === 'interactive' || REMOTE_READ_TOOLS.includes(tool) || REMOTE_SESSION_TOOLS.includes(tool);
}

/** Stable hashing input; argument order must not turn a retry into a different operation. */
export function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
  if (typeof value === 'object' && value !== null) {
    const record = value as Record<string, unknown>;
    return `{${Object.keys(record).sort().filter((key) => record[key] !== undefined)
      .map((key) => `${JSON.stringify(key)}:${canonicalJson(record[key])}`).join(',')}}`;
  }
  return JSON.stringify(value) ?? 'null';
}
