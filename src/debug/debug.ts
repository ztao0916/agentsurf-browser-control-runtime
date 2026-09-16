import { sendRuntimeMessage } from '../transport/runtime-message-transport';
import {
  isTransportControlResponse,
  type TransportControlRequest,
  type TransportEventMessage,
} from '../transport/transport-control';
import type { NativeConnectionSnapshot, NativeTransportEvent } from '../transport/native-messaging-transport';

/**
 * The popup is a status card, not a tool playground: browser work is driven from code (MCP or
 * `npm run bridge:call`). What cannot be done from code is seeing whether the native host is
 * connected, forcing a reconnect, and reading the last connection errors.
 *
 * Every tool call emits a request and a response event, so keeping those here would flush the
 * connection history within a dozen calls. Only the connection lifecycle is listed.
 */
const MAX_EVENTS = 5;
const LISTED_CATEGORIES = new Set<NativeTransportEvent['category']>(['state', 'error']);

const stateDot = getElement<HTMLSpanElement>('state-dot');
const stateText = getElement<HTMLSpanElement>('state-text');
const hostName = getElement<HTMLElement>('host-name');
const bridgeUrl = getElement<HTMLElement>('bridge-url');
const pendingCount = getElement<HTMLElement>('pending');
const eventsList = getElement<HTMLUListElement>('events');
const result = getElement<HTMLParagraphElement>('result');

const events: NativeTransportEvent[] = [];
let snapshot: NativeConnectionSnapshot | null = null;

function getElement<T extends HTMLElement>(id: string): T {
  const element = document.getElementById(id);
  if (element === null) throw new Error(`Debug element #${id} was not found.`);
  return element as T;
}

function renderState(state: NativeConnectionSnapshot): void {
  snapshot = state;
  stateDot.className = `dot ${state.state}`;
  stateText.textContent = state.error === null ? state.state : `${state.state} — ${state.error}`;
  hostName.textContent = state.host_name;
  bridgeUrl.textContent = state.bridge_url ?? 'unavailable';
  pendingCount.textContent = state.reconnect_attempt > 0
    ? `${state.pending_requests} (reconnect attempt ${state.reconnect_attempt})`
    : String(state.pending_requests);
}

function renderEvents(): void {
  if (events.length === 0) {
    eventsList.replaceChildren(createEventRow({ timestamp: Date.now(), category: 'state', message: 'No events yet.' }, 'empty'));
    return;
  }
  eventsList.replaceChildren(
    ...events.map((event) => createEventRow(event, event.category === 'error' ? 'error' : '')),
  );
}

function createEventRow(event: NativeTransportEvent, extraClass: string): HTMLLIElement {
  const row = document.createElement('li');
  if (extraClass !== '') row.className = extraClass;
  const time = document.createElement('span');
  time.className = 'time';
  time.textContent = new Date(event.timestamp).toLocaleTimeString();
  const message = document.createElement('span');
  message.className = 'message';
  message.textContent = event.request_id === undefined ? event.message : `${event.message} (${event.request_id})`;
  row.append(time, message);
  return row;
}

function addEvent(event: NativeTransportEvent): void {
  if (!LISTED_CATEGORIES.has(event.category)) return;
  events.unshift(event);
  events.length = Math.min(events.length, MAX_EVENTS);
  renderEvents();
}

function setResult(text: string, isError = false): void {
  result.textContent = text;
  result.style.color = isError ? '#d93025' : '#1e8e3e';
}

async function refresh(): Promise<void> {
  try {
    const response = await sendRuntimeMessage({ kind: 'transport-control', action: 'get-state' } satisfies TransportControlRequest);
    if (isTransportControlResponse(response) && response.ok) {
      renderState(response.state);
      return;
    }
    setResult('The extension service worker returned an unusable state.', true);
  } catch (error: unknown) {
    // Without this the card would sit on "loading…" and read as if the link were down.
    setResult(`Cannot reach the extension service worker: ${error instanceof Error ? error.message : String(error)}`, true);
  }
}

async function control(action: 'connect' | 'disconnect' | 'reconnect'): Promise<void> {
  setResult('');
  const response = await sendRuntimeMessage({ kind: 'transport-control', action } satisfies TransportControlRequest);
  if (isTransportControlResponse(response) && response.ok) {
    renderState(response.state);
    return;
  }
  // The service worker also reports failures as events; this covers a rejected message.
  setResult(
    isTransportControlResponse(response) && !response.ok
      ? response.error.message
      : 'The extension service worker did not answer.',
    true,
  );
}

/**
 * Diagnostics intentionally carry no token: the connection snapshot holds the endpoint and host
 * name, never the bridge credential.
 */
function diagnosticsText(): string {
  const lines = [
    `AgentSurf diagnostics ${new Date().toISOString()}`,
    `extension ${chrome.runtime.getManifest().version}`,
    `user agent ${navigator.userAgent}`,
    snapshot === null ? 'state unavailable' : `state ${snapshot.state}`,
    snapshot === null ? '' : `host ${snapshot.host_name}`,
    snapshot === null ? '' : `endpoint ${snapshot.bridge_url ?? 'unavailable'}`,
    snapshot === null ? '' : `pending ${snapshot.pending_requests} reconnect_attempt ${snapshot.reconnect_attempt}`,
    snapshot?.error == null ? '' : `last error ${snapshot.error}`,
    'events:',
    ...events.map((event) =>
      `  ${new Date(event.timestamp).toISOString()} ${event.category} ${event.message}${event.request_id === undefined ? '' : ` (${event.request_id})`}`),
  ];
  return lines.filter((line) => line !== '').join('\n');
}

async function copyDiagnostics(): Promise<void> {
  try {
    await navigator.clipboard.writeText(diagnosticsText());
    setResult('Diagnostics copied.');
  } catch (error: unknown) {
    setResult(`Could not copy: ${error instanceof Error ? error.message : String(error)}`, true);
  }
}

chrome.runtime.onMessage.addListener((message: unknown) => {
  if (typeof message !== 'object' || message === null || !('kind' in message) || message.kind !== 'transport-event') {
    return undefined;
  }
  const event = (message as TransportEventMessage).event;
  if (typeof event === 'object' && event !== null) {
    addEvent(event);
    void refresh();
  }
  return undefined;
});

for (const [id, action] of [['connect', 'connect'], ['disconnect', 'disconnect'], ['reconnect', 'reconnect']] as const) {
  getElement<HTMLButtonElement>(id).addEventListener('click', () => void control(action));
}
getElement<HTMLButtonElement>('copy').addEventListener('click', () => void copyDiagnostics());

renderEvents();
void refresh();
