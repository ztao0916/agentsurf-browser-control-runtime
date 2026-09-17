import type { ConsoleEntry, ConsoleEntrySource, ConsoleLevel } from '../core/protocol/tool-contract';
import { CONSOLE_CHANNEL, isConsoleQueryMessage, type ConsoleEntriesMessage } from './console-channel';

const INSTALLATION_KEY = '__agentsurfConsoleCollectorInstalled';
const MAX_ENTRIES = 500;
const MAX_MESSAGE_LENGTH = 2_000;
const MAX_DEPTH = 4;
const MAX_OBJECT_KEYS = 20;
const CONSOLE_LEVELS: readonly ConsoleLevel[] = ['log', 'info', 'warn', 'error', 'debug'];

declare global {
  interface Window {
    __agentsurfConsoleCollectorInstalled?: boolean;
  }
}

/**
 * Runs in the page's MAIN world so the page's own console output is observable. Patching `console`
 * from the isolated world would only see the content script's own messages. Because this patch makes
 * Chrome blame the extension for the page's console errors, it is injected only into tabs a session
 * drives (`ChromeConsoleCollector`), and the guard below keeps repeat injections harmless.
 */
function install(): void {
  const entries: ConsoleEntry[] = [];
  let sequence = 0;
  let dropped = 0;

  const record = (level: ConsoleLevel, source: ConsoleEntrySource, message: string, stack: string | null): void => {
    entries.push({
      sequence: ++sequence,
      level,
      source,
      message: message.slice(0, MAX_MESSAGE_LENGTH),
      stack: stack === null ? null : stack.slice(0, MAX_MESSAGE_LENGTH),
      timestamp: Date.now(),
    });
    if (entries.length > MAX_ENTRIES) {
      dropped += entries.length - MAX_ENTRIES;
      entries.splice(0, entries.length - MAX_ENTRIES);
    }
  };

  for (const level of CONSOLE_LEVELS) {
    const original = console[level].bind(console);
    console[level] = (...args: unknown[]): void => {
      try {
        record(level, 'console', formatArguments(args), null);
      } catch {
        // Capturing a log must never break the page.
      }
      original(...args);
    };
  }

  window.addEventListener('error', (event) => {
    try {
      const error: unknown = event.error;
      record('error', 'exception', error instanceof Error ? `${error.name}: ${error.message}` : event.message, error instanceof Error ? (error.stack ?? null) : null);
    } catch {
      // ignore
    }
  });

  window.addEventListener('unhandledrejection', (event) => {
    try {
      const reason: unknown = event.reason;
      record(
        'error',
        'unhandledrejection',
        reason instanceof Error ? `Unhandled rejection: ${reason.name}: ${reason.message}` : `Unhandled rejection: ${describe(reason, 0, new WeakSet())}`,
        reason instanceof Error ? (reason.stack ?? null) : null,
      );
    } catch {
      // ignore
    }
  });

  window.addEventListener('message', (event) => {
    if (event.source !== window || !isConsoleQueryMessage(event.data)) return;
    const reply: ConsoleEntriesMessage = {
      channel: CONSOLE_CHANNEL,
      kind: 'entries',
      request_id: event.data.request_id,
      available: true,
      entries: [...entries],
      dropped,
    };
    window.postMessage(reply, '*');
  });
}

function formatArguments(args: unknown[]): string {
  return args.map((value) => describe(value, 0, new WeakSet())).join(' ');
}

function describe(value: unknown, depth: number, seen: WeakSet<object>): string {
  if (value === null) return 'null';
  switch (typeof value) {
    case 'undefined':
      return 'undefined';
    case 'string':
      return depth === 0 ? value : JSON.stringify(value);
    case 'number':
    case 'boolean':
    case 'bigint':
      return String(value);
    case 'symbol':
      return value.toString();
    case 'function':
      return `[Function ${value.name === '' ? 'anonymous' : value.name}]`;
    default:
      break;
  }

  if (value instanceof Error) return `${value.name}: ${value.message}`;
  if (value instanceof Node) return describeNode(value);
  if (depth >= MAX_DEPTH) return Array.isArray(value) ? '[Array]' : '[Object]';
  if (seen.has(value)) return '[Circular]';
  seen.add(value);

  if (Array.isArray(value)) return `[${value.map((item) => describe(item, depth + 1, seen)).join(', ')}]`;
  if (value instanceof Map) return `Map(${value.size})`;
  if (value instanceof Set) return `Set(${value.size})`;

  const keys = Object.keys(value).slice(0, MAX_OBJECT_KEYS);
  const body = keys.map((key) => `${key}: ${describe((value as Record<string, unknown>)[key], depth + 1, seen)}`);
  if (Object.keys(value).length > MAX_OBJECT_KEYS) body.push('…');
  return `{${body.join(', ')}}`;
}

function describeNode(node: Node): string {
  if (node instanceof Element) {
    const id = node.id === '' ? '' : `#${node.id}`;
    const classes = node.classList.length === 0 ? '' : `.${Array.from(node.classList).slice(0, 2).join('.')}`;
    return `<${node.tagName.toLowerCase()}${id}${classes}>`;
  }
  return `[${node.nodeName}]`;
}

if (!window[INSTALLATION_KEY]) {
  window[INSTALLATION_KEY] = true;
  install();
}
