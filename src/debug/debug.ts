import { sendRuntimeMessage } from '../transport/runtime-message-transport';
import {
  isTransportControlResponse,
  type TransportConnectionSnapshot,
  type TransportControlRequest,
  type TransportEventMessage,
} from '../transport/transport-control';
import type { NativeTransportEvent } from '../transport/native-messaging-transport';

const MAX_EVENTS = 20;
const LISTED_CATEGORIES = new Set<NativeTransportEvent['category']>(['state', 'error']);

// Header elements
const headerStatusBadge = getElement<HTMLDivElement>('header-status-badge');
const headerStatusText = getElement<HTMLSpanElement>('header-status-text');

// Card 1: Local Native elements
const localStatusBadge = getElement<HTMLDivElement>('local-status-badge');
const localStatusText = getElement<HTMLSpanElement>('local-status-text');
const hostName = getElement<HTMLElement>('host-name');

// Card 2: Remote Gateway elements
const gatewayToggle = getElement<HTMLInputElement>('gateway-toggle');
const gatewayContentEnabled = getElement<HTMLDivElement>('gateway-content-enabled');
const gatewayContentDisabled = getElement<HTMLDivElement>('gateway-content-disabled');

const gatewayViewConnected = getElement<HTMLDivElement>('gateway-view-connected');
const gatewayStatusText = getElement<HTMLSpanElement>('gateway-status-text');
const btnEditConfig = getElement<HTMLButtonElement>('btn-edit-config');

const gatewayViewForm = getElement<HTMLDivElement>('gateway-view-form');
const gatewayUrlInput = getElement<HTMLInputElement>('gateway-url');
const gatewayTokenInput = getElement<HTMLInputElement>('gateway-token');
const btnSaveRemote = getElement<HTMLButtonElement>('btn-save-remote');
const btnCancelConfig = getElement<HTMLButtonElement>('btn-cancel-config');

// Feedback & Footer
const result = getElement<HTMLDivElement>('result');
const btnCopy = getElement<HTMLButtonElement>('copy');

const events: NativeTransportEvent[] = [];
let snapshot: TransportConnectionSnapshot | null = null;
let currentMode: 'local' | 'remote' = 'local';
let isEditingGatewayConfig = false;

function getElement<T extends HTMLElement>(id: string): T {
  const element = document.getElementById(id);
  if (element === null) throw new Error(`Debug element #${id} was not found.`);
  return element as T;
}

function setResult(text: string, isError = false): void {
  result.textContent = text;
  result.className = isError ? 'feedback error' : 'feedback success';
}

function renderState(state: TransportConnectionSnapshot): void {
  snapshot = state;
  currentMode = state.mode;

  // 1. Update Card 1 (Local Native)
  const localState = state.local_state ?? (state.mode === 'local' ? state.state : 'connected');
  if (localState === 'connected') {
    localStatusBadge.className = 'status-badge connected';
    localStatusText.textContent = '已就绪';
  } else if (localState === 'error') {
    localStatusBadge.className = 'status-badge error';
    localStatusText.textContent = '异常';
  } else {
    localStatusBadge.className = 'status-badge';
    localStatusText.textContent = localState;
  }
  hostName.textContent = state.host_name ?? 'com.browsercontrol.runtime';

  // 2. Update Card 2 (Remote Gateway)
  const isRemote = state.mode === 'remote';
  gatewayToggle.checked = isRemote;

  if (isRemote) {
    gatewayContentEnabled.style.display = 'block';
    gatewayContentDisabled.style.display = 'none';

    if (state.gateway_url && !gatewayUrlInput.value) {
      gatewayUrlInput.value = state.gateway_url;
    }

    const remoteState = state.remote_state ?? state.state;
    if (remoteState === 'connected') {
      gatewayStatusText.textContent = '网关已配对连接';
      gatewayViewConnected.className = 'gateway-status-box';
    } else if (remoteState === 'connecting' || remoteState === 'reconnecting') {
      gatewayStatusText.textContent = state.reconnect_attempt > 0 ? `重试连接 (${state.reconnect_attempt})...` : '正在连接云端网关...';
      gatewayViewConnected.className = 'gateway-status-box warn';
    } else {
      gatewayStatusText.textContent = state.error ? `连接失败: ${state.error}` : '网关未连接';
      gatewayViewConnected.className = 'gateway-status-box warn';
    }

    // By default when connected or configured, hide the domain input to protect privacy
    if (!isEditingGatewayConfig && (remoteState === 'connected' || gatewayUrlInput.value)) {
      gatewayViewConnected.style.display = 'flex';
      gatewayViewForm.style.display = 'none';
    } else {
      gatewayViewConnected.style.display = 'none';
      gatewayViewForm.style.display = 'block';
    }
  } else {
    gatewayContentEnabled.style.display = 'none';
    gatewayContentDisabled.style.display = 'block';
  }

  // 3. Update Overall Header Status
  if (localState === 'connected' || (isRemote && state.state === 'connected')) {
    headerStatusBadge.className = 'status-badge connected';
    headerStatusText.textContent = '运行正常';
  } else {
    headerStatusBadge.className = 'status-badge';
    headerStatusText.textContent = '待命';
  }

  if (state.error && isRemote) {
    setResult(state.error, true);
  }
}

function addEvent(event: NativeTransportEvent): void {
  if (!LISTED_CATEGORIES.has(event.category)) return;
  events.unshift(event);
  events.length = Math.min(events.length, MAX_EVENTS);
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
    setResult('无法获取扩展运行时状态', true);
  } catch (error: unknown) {
    setResult(`无法连接扩展后台: ${error instanceof Error ? error.message : String(error)}`, true);
  }
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
    setResult(targetMode === 'remote' ? '已启用并连接云端网关' : '已切换为仅本地模式');
  } else {
    setResult('操作失败', true);
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

// Event Listeners
gatewayToggle.addEventListener('change', () => {
  if (gatewayToggle.checked) {
    const url = gatewayUrlInput.value.trim();
    const token = gatewayTokenInput.value.trim();
    if (!url) {
      isEditingGatewayConfig = true;
      gatewayContentEnabled.style.display = 'block';
      gatewayContentDisabled.style.display = 'none';
      gatewayViewConnected.style.display = 'none';
      gatewayViewForm.style.display = 'block';
      return;
    }
    void switchMode('remote', url, token);
  } else {
    isEditingGatewayConfig = false;
    void switchMode('local');
  }
});

btnEditConfig.addEventListener('click', () => {
  isEditingGatewayConfig = true;
  gatewayViewConnected.style.display = 'none';
  gatewayViewForm.style.display = 'block';
});

btnCancelConfig.addEventListener('click', () => {
  isEditingGatewayConfig = false;
  gatewayViewConnected.style.display = 'flex';
  gatewayViewForm.style.display = 'none';
});

btnSaveRemote.addEventListener('click', () => {
  const url = gatewayUrlInput.value.trim();
  const token = gatewayTokenInput.value.trim();
  if (!url) {
    setResult('请输入网关地址', true);
    return;
  }
  isEditingGatewayConfig = false;
  void switchMode('remote', url, token);
});

btnCopy.addEventListener('click', () => void copyDiagnostics());

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

void refresh();
