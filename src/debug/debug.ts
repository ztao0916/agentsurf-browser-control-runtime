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
const cardLocal = getElement<HTMLDivElement>('card-local');
const localToggle = getElement<HTMLInputElement>('local-toggle');
const localStatusBox = getElement<HTMLDivElement>('local-status-box');
const localStatusDot = getElement<HTMLSpanElement>('local-status-dot');
const localStatusText = getElement<HTMLSpanElement>('local-status-text');

// Card 2: Remote Gateway elements
const gatewayToggle = getElement<HTMLInputElement>('gateway-toggle');
const cardGateway = getElement<HTMLDivElement>('card-gateway');
const gatewayContentEnabled = getElement<HTMLDivElement>('gateway-content-enabled');
const gatewayContentDisabled = getElement<HTMLDivElement>('gateway-content-disabled');

const gatewayViewConnected = getElement<HTMLDivElement>('gateway-view-connected');
const gatewayStatusDot = getElement<HTMLSpanElement>('gateway-status-dot');
const gatewayStatusText = getElement<HTMLSpanElement>('gateway-status-text');
const gatewayDeviceLabel = getElement<HTMLSpanElement>('gateway-device-label');
const btnPinDevice = getElement<HTMLButtonElement>('btn-pin-device');
const btnEditConfig = getElement<HTMLButtonElement>('btn-edit-config');
const btnConfigGateway = getElement<HTMLButtonElement>('btn-config-gateway');

// Modal elements
const modalGateway = getElement<HTMLDivElement>('modal-gateway');
const modalViewPrompt = getElement<HTMLDivElement>('modal-view-prompt');
const modalViewForm = getElement<HTMLDivElement>('modal-view-form');
const btnModalCancel = getElement<HTMLButtonElement>('btn-modal-cancel');
const btnModalConfigure = getElement<HTMLButtonElement>('btn-modal-configure');
const btnModalClose = getElement<HTMLButtonElement>('btn-modal-close');

const gatewayUrlInput = getElement<HTMLInputElement>('gateway-url');
const gatewayTokenInput = getElement<HTMLInputElement>('gateway-token');
const gatewayDeviceNameInput = getElement<HTMLInputElement>('gateway-device-name');
const btnClearConfig = getElement<HTMLButtonElement>('btn-clear-config');
const btnCancelConfig = getElement<HTMLButtonElement>('btn-cancel-config');
const btnSaveRemote = getElement<HTMLButtonElement>('btn-save-remote');

// Feedback & Footer
const result = getElement<HTMLDivElement>('result');
const btnCopy = getElement<HTMLButtonElement>('copy');
const versionLabel = document.getElementById('version-label');
if (versionLabel) {
  try {
    const v = chrome.runtime?.getManifest?.()?.version;
    if (v) versionLabel.textContent = `v${v}`;
  } catch {
    // fallback
  }
}

const events: NativeTransportEvent[] = [];
let snapshot: TransportConnectionSnapshot | null = null;
let currentMode: 'local' | 'remote' = 'local';

function getElement<T extends HTMLElement>(id: string): T {
  const element = document.getElementById(id);
  if (element === null) throw new Error(`Debug element #${id} was not found.`);
  return element as T;
}

function showPromptModal(): void {
  modalViewPrompt.style.display = 'block';
  modalViewForm.style.display = 'none';
  modalGateway.style.display = 'flex';
}

function showFormModal(): void {
  modalViewPrompt.style.display = 'none';
  modalViewForm.style.display = 'block';
  modalGateway.style.display = 'flex';

  const hasConfig = Boolean(gatewayUrlInput.value.trim());
  btnClearConfig.style.display = hasConfig ? 'inline-flex' : 'none';
  gatewayUrlInput.focus();
}

function closeModal(): void {
  modalGateway.style.display = 'none';
}

function setResult(text: string, isError = false): void {
  result.textContent = text;
  result.className = isError ? 'feedback error' : 'feedback success';
}

function renderState(state: TransportConnectionSnapshot): void {
  snapshot = state;
  currentMode = state.mode;

  const isRemote = state.mode === 'remote';
  const remoteState = state.remote_state ?? (isRemote ? state.state : 'disconnected');
  const localState = state.local_state ?? (state.mode === 'local' ? state.state : 'connected');

  // Mutually exclusive toggle states
  localToggle.checked = !isRemote;
  gatewayToggle.checked = isRemote;

  if (isRemote) {
    gatewayContentEnabled.style.display = 'block';
    gatewayContentDisabled.style.display = 'none';

    if (state.gateway_url && !gatewayUrlInput.value) {
      gatewayUrlInput.value = state.gateway_url;
    }
    if (state.device_name) {
      gatewayDeviceLabel.textContent = state.pinned ? `Device: ${state.device_name} (Pinned)` : `Device: ${state.device_name}`;
      if (!gatewayDeviceNameInput.value) {
        gatewayDeviceNameInput.value = state.device_name;
      }
    }
    btnPinDevice.textContent = state.pinned ? 'Unpin active' : 'Pin as active';
    btnPinDevice.style.display = remoteState === 'connected' ? 'inline-block' : 'none';

    if (remoteState === 'connected') {
      // Remote Gateway is Active
      cardLocal.className = 'card';
      cardGateway.className = 'card active';
      localStatusBox.className = 'gateway-status-box standby';
      localStatusDot.style.background = '#94a3b8';
      localStatusText.textContent = 'Local Native Standby';

      headerStatusBadge.className = 'status-badge connected';
      headerStatusText.textContent = 'Remote Gateway Active';

      gatewayStatusText.textContent = 'Connected';
      gatewayStatusDot.style.background = 'var(--success)';
      gatewayViewConnected.className = 'gateway-status-box';
    } else if (remoteState === 'connecting' || remoteState === 'reconnecting') {
      // Connecting to remote
      cardLocal.className = 'card';
      cardGateway.className = 'card active';
      localStatusBox.className = 'gateway-status-box standby';
      localStatusDot.style.background = '#94a3b8';
      localStatusText.textContent = 'Local Native Standby';

      headerStatusBadge.className = 'status-badge connecting';
      headerStatusText.textContent = 'Connecting...';

      gatewayStatusText.textContent = state.reconnect_attempt > 0 ? `Reconnecting (${state.reconnect_attempt})...` : 'Connecting to Remote Gateway...';
      gatewayStatusDot.style.background = 'var(--warn)';
      gatewayViewConnected.className = 'gateway-status-box warn';
    } else {
      // Remote error / disconnected
      cardLocal.className = 'card';
      cardGateway.className = 'card error';
      localStatusBox.className = 'gateway-status-box standby';
      localStatusDot.style.background = '#94a3b8';
      localStatusText.textContent = 'Local Native Available';

      headerStatusBadge.className = 'status-badge error';
      headerStatusText.textContent = 'Remote Offline (Local Ready)';

      gatewayStatusText.textContent = state.error ? `Failed: ${state.error}` : 'Disconnected';
      gatewayStatusDot.style.background = 'var(--danger)';
      gatewayViewConnected.className = 'gateway-status-box warn';
    }
  } else {
    // Local mode is Active
    cardLocal.className = localState === 'error' ? 'card error' : 'card active';
    cardGateway.className = 'card';
    localStatusBox.className = localState === 'connected' ? 'gateway-status-box' : 'gateway-status-box standby';
    localStatusDot.style.background = localState === 'error' ? 'var(--danger)' : localState === 'connected' ? 'var(--success)' : '#94a3b8';
    localStatusText.textContent = localState === 'error' ? 'Local connection failed' : localState === 'connected' ? 'Connected' : 'Waiting for local client';

    gatewayContentEnabled.style.display = 'none';
    gatewayContentDisabled.style.display = 'flex';

    headerStatusBadge.className = 'status-badge connected';
    headerStatusText.textContent = 'Local Native Active';
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
        if (response.config.deviceName && !gatewayDeviceNameInput.value) {
          gatewayDeviceNameInput.value = response.config.deviceName;
        }
      }
      renderState(response.state);
      return;
    }
    setResult('Failed to read extension runtime state', true);
  } catch (error: unknown) {
    setResult(`Failed to reach extension background: ${error instanceof Error ? error.message : String(error)}`, true);
  }
}

async function switchMode(
  targetMode: 'local' | 'remote',
  url?: string,
  token?: string,
  deviceName?: string,
): Promise<void> {
  setResult('');
  const response = await sendRuntimeMessage({
    kind: 'transport-control',
    action: 'set-mode',
    mode: targetMode,
    ...(url !== undefined ? { gatewayUrl: url } : {}),
    ...(token !== undefined ? { gatewayToken: token } : {}),
    ...(deviceName !== undefined ? { deviceName } : {}),
  } satisfies TransportControlRequest);

  if (isTransportControlResponse(response) && response.ok) {
    renderState(response.state);
    setResult(targetMode === 'remote' ? 'Switched to Remote Gateway' : 'Switched to Local Native mode');
  } else {
    setResult('Operation failed', true);
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
    setResult('Diagnostics copied to clipboard.');
  } catch (error: unknown) {
    setResult(`Copy failed: ${error instanceof Error ? error.message : String(error)}`, true);
  }
}

// Event Listeners
localToggle.addEventListener('change', () => {
  if (localToggle.checked) {
    // 开启本地开关：云端开关关闭，切换为仅本地模式
    gatewayToggle.checked = false;
    void switchMode('local');
  } else {
    // 关闭本地开关：意图切换到云端
    const url = gatewayUrlInput.value.trim();
    const token = gatewayTokenInput.value.trim();
    if (!url || !token) {
      // 云端未配置：本地开关恢复开启，弹出形式 A 毛玻璃模态引导弹窗
      localToggle.checked = true;
      showPromptModal();
      return;
    }
    // 云端已配置：云端开关打开，切换为云端网关模式
    gatewayToggle.checked = true;
    void switchMode('remote', url, token);
  }
});

gatewayToggle.addEventListener('change', () => {
  if (gatewayToggle.checked) {
    const url = gatewayUrlInput.value.trim();
    const token = gatewayTokenInput.value.trim();
    if (!url || !token) {
      // 未配置过：云端开关保持 OFF，本地开关保持 ON，弹出形式 A 毛玻璃模态引导弹窗
      gatewayToggle.checked = false;
      localToggle.checked = true;
      showPromptModal();
      return;
    }
    // 之前已配置过：本地开关关闭，云端开关开启，立即发起云端连接
    localToggle.checked = false;
    void switchMode('remote', url, token);
  } else {
    // 关掉云端开关：本地开关打开，直接回归本地直连生效
    localToggle.checked = true;
    void switchMode('local');
  }
});

btnModalCancel.addEventListener('click', () => {
  closeModal();
  localToggle.checked = currentMode === 'local';
  gatewayToggle.checked = currentMode === 'remote';
});

btnModalConfigure.addEventListener('click', showFormModal);
btnEditConfig.addEventListener('click', showFormModal);
btnConfigGateway.addEventListener('click', showFormModal);

btnModalClose.addEventListener('click', () => {
  closeModal();
  localToggle.checked = currentMode === 'local';
  gatewayToggle.checked = currentMode === 'remote';
});

btnCancelConfig.addEventListener('click', () => {
  closeModal();
  localToggle.checked = currentMode === 'local';
  gatewayToggle.checked = currentMode === 'remote';
});

btnClearConfig.addEventListener('click', async () => {
  gatewayUrlInput.value = '';
  gatewayTokenInput.value = '';
  closeModal();
  localToggle.checked = true;
  gatewayToggle.checked = false;
  await switchMode('local', '', '');
  setResult('Cleared remote configuration; switched to Local Native mode');
});

btnSaveRemote.addEventListener('click', () => {
  const url = gatewayUrlInput.value.trim();
  const token = gatewayTokenInput.value.trim();
  const deviceName = gatewayDeviceNameInput.value.trim();
  if (!url) {
    setResult('Please enter a Gateway WSS URL', true);
    return;
  }
  closeModal();
  localToggle.checked = false;
  gatewayToggle.checked = true;
  void switchMode('remote', url, token, deviceName);
});

btnPinDevice.addEventListener('click', async () => {
  const nextPin = !snapshot?.pinned;
  const response = await sendRuntimeMessage({
    kind: 'transport-control',
    action: 'set-device',
    pinActive: nextPin,
  } satisfies TransportControlRequest);
  if (isTransportControlResponse(response) && response.ok) {
    renderState(response.state);
    setResult(nextPin ? 'Pinned this browser as the active target' : 'Unpinned; automatic active-browser routing resumed');
  } else {
    setResult('Failed to update active device pin', true);
  }
});

modalGateway.addEventListener('click', (event) => {
  if (event.target === modalGateway) {
    closeModal();
    localToggle.checked = currentMode === 'local';
    gatewayToggle.checked = currentMode === 'remote';
  }
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
