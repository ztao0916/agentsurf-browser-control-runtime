import { sendRuntimeMessage } from '../transport/runtime-message-transport';
import {
  isTransportControlResponse,
  type TransportConnectionSnapshot,
  type TransportControlRequest,
  type TransportEventMessage,
} from '../transport/transport-control';
import type { NativeTransportEvent } from '../transport/native-messaging-transport';

const MAX_EVENTS = 5;
const LISTED_CATEGORIES = new Set<NativeTransportEvent['category']>(['state', 'error']);

const modeBadge = getElement<HTMLSpanElement>('mode-badge');
const btnModeLocal = getElement<HTMLButtonElement>('btn-mode-local');
const btnModeRemote = getElement<HTMLButtonElement>('btn-mode-remote');
const panelLocal = getElement<HTMLDivElement>('panel-local');
const panelRemote = getElement<HTMLDivElement>('panel-remote');

const stateDot = getElement<HTMLSpanElement>('state-dot');
const stateText = getElement<HTMLSpanElement>('state-text');
const hostName = getElement<HTMLElement>('host-name');
const bridgeUrl = getElement<HTMLElement>('bridge-url');
const pendingCount = getElement<HTMLElement>('pending');
const gatewayUrlInput = getElement<HTMLInputElement>('gateway-url');
const gatewayTokenInput = getElement<HTMLInputElement>('gateway-token');
const btnSaveRemote = getElement<HTMLButtonElement>('btn-save-remote');
const btnDisconnectRemote = getElement<HTMLButtonElement>('btn-disconnect-remote');
const eventsList = getElement<HTMLUListElement>('events');
const result = getElement<HTMLParagraphElement>('result');

const events: NativeTransportEvent[] = [];
let snapshot: TransportConnectionSnapshot | null = null;
let currentMode: 'local' | 'remote' = 'local';

function getElement<T extends HTMLElement>(id: string): T {
  const element = document.getElementById(id);
  if (element === null) throw new Error(`Debug element #${id} was not found.`);
  return element as T;
}

function updateModeUI(mode: 'local' | 'remote'): void {
  currentMode = mode;
  if (mode === 'local') {
    modeBadge.textContent = '本地模式';
    btnModeLocal.classList.add('active');
    btnModeRemote.classList.remove('active');
    panelLocal.style.display = 'block';
    panelRemote.style.display = 'none';
  } else {
    modeBadge.textContent = '远程网关配对';
    btnModeLocal.classList.remove('active');
    btnModeRemote.classList.add('active');
    panelLocal.style.display = 'none';
    panelRemote.style.display = 'block';
  }
}

function renderState(state: TransportConnectionSnapshot): void {
  snapshot = state;
  updateModeUI(state.mode);

  stateDot.className = `dot ${state.state}`;
  stateText.textContent = state.error === null ? state.state : `${state.state} — ${state.error}`;

  if (state.mode === 'local') {
    hostName.textContent = state.host_name ?? 'com.browsercontrol.runtime';
    bridgeUrl.textContent = state.bridge_url ?? 'unavailable';
    pendingCount.textContent = state.reconnect_attempt > 0
      ? `${state.pending_requests} (reconnect attempt ${state.reconnect_attempt})`
      : String(state.pending_requests);
  } else {
    if (state.gateway_url && !gatewayUrlInput.value) {
      gatewayUrlInput.value = state.gateway_url;
    }
  }
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
      if (response.config) {
        if (response.config.gatewayUrl && !gatewayUrlInput.value) {
          gatewayUrlInput.value = response.config.gatewayUrl;
        }
        if (response.config.gatewayToken && !gatewayTokenInput.value) {
          gatewayTokenInput.value = response.config.gatewayToken;
        }
      }
      renderState(response.state);
      return;
    }
    setResult('The extension service worker returned an unusable state.', true);
  } catch (error: unknown) {
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
  setResult(
    isTransportControlResponse(response) && !response.ok
      ? response.error.message
      : 'The extension service worker did not answer.',
    true,
  );
}

async function switchMode(targetMode: 'local' | 'remote', url?: string, token?: string): Promise<void> {
  setResult('');
  const response = await sendRuntimeMessage({
    kind: 'transport-control',
    action: 'set-mode',
    mode: targetMode,
    ...(url !== undefined ? { gatewayUrl: url } : {}),
    ...(token !== undefined ? { gatewayToken: token } : {}),
  } satisfies TransportControlRequest);

  if (isTransportControlResponse(response) && response.ok) {
    renderState(response.state);
    setResult(targetMode === 'remote' ? '已切换并连接到远程网关' : '已切换到本地 Native 模式');
  } else {
    setResult('切换模式失败', true);
  }
}

function diagnosticsText(): string {
  const lines = [
    `AgentSurf diagnostics ${new Date().toISOString()}`,
    `extension ${chrome.runtime.getManifest().version}`,
    `mode ${currentMode}`,
    snapshot === null ? 'state unavailable' : `state ${snapshot.state}`,
    snapshot?.gateway_url ? `gateway ${snapshot.gateway_url}` : '',
    snapshot?.host_name ? `host ${snapshot.host_name}` : '',
    snapshot?.bridge_url ? `endpoint ${snapshot.bridge_url}` : '',
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
    setResult('诊断日志已复制到剪贴板。');
  } catch (error: unknown) {
    setResult(`复制失败: ${error instanceof Error ? error.message : String(error)}`, true);
  }
}

btnModeLocal.addEventListener('click', () => {
  if (currentMode !== 'local') {
    void switchMode('local');
  }
});

btnModeRemote.addEventListener('click', () => {
  if (currentMode !== 'remote') {
    updateModeUI('remote');
  }
});

btnSaveRemote.addEventListener('click', () => {
  const url = gatewayUrlInput.value.trim();
  const token = gatewayTokenInput.value.trim();
  if (!url) {
    setResult('请输入网关地址', true);
    return;
  }
  void switchMode('remote', url, token);
});

btnDisconnectRemote.addEventListener('click', () => {
  void control('disconnect');
});

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
