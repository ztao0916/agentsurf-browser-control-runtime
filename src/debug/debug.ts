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
const hostName = getElement<HTMLElement>('host-name');

// Card 2: Remote Gateway elements
const gatewayToggle = getElement<HTMLInputElement>('gateway-toggle');
const gatewayContentEnabled = getElement<HTMLDivElement>('gateway-content-enabled');
const gatewayContentDisabled = getElement<HTMLDivElement>('gateway-content-disabled');

const gatewayViewConnected = getElement<HTMLDivElement>('gateway-view-connected');
const gatewayStatusDot = getElement<HTMLSpanElement>('gateway-status-dot');
const gatewayStatusText = getElement<HTMLSpanElement>('gateway-status-text');
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

  // Update Host name
  hostName.textContent = state.host_name ?? 'com.browsercontrol.runtime';

  // Mutually exclusive toggle states
  localToggle.checked = !isRemote;
  gatewayToggle.checked = isRemote;

  if (isRemote) {
    gatewayContentEnabled.style.display = 'block';
    gatewayContentDisabled.style.display = 'none';

    if (state.gateway_url && !gatewayUrlInput.value) {
      gatewayUrlInput.value = state.gateway_url;
    }

    if (remoteState === 'connected') {
      // Remote Gateway is Active
      cardLocal.className = 'card';
      localStatusBox.className = 'gateway-status-box standby';
      localStatusDot.style.background = '#94a3b8';
      localStatusText.textContent = '待命中';

      headerStatusBadge.className = 'status-badge connected';
      headerStatusText.textContent = '云端网关生效中';

      gatewayStatusText.textContent = '已配对 · 当前生效';
      gatewayStatusDot.style.background = 'var(--success)';
      gatewayViewConnected.className = 'gateway-status-box';
    } else if (remoteState === 'connecting' || remoteState === 'reconnecting') {
      // Connecting to remote
      cardLocal.className = 'card';
      localStatusBox.className = 'gateway-status-box standby';
      localStatusDot.style.background = '#94a3b8';
      localStatusText.textContent = '待命中 (本地可用)';

      headerStatusBadge.className = 'status-badge connecting';
      headerStatusText.textContent = '云端连接中...';

      gatewayStatusText.textContent = state.reconnect_attempt > 0 ? `重试连接 (${state.reconnect_attempt})...` : '正在连接云端网关...';
      gatewayStatusDot.style.background = 'var(--warn)';
      gatewayViewConnected.className = 'gateway-status-box warn';
    } else {
      // Remote error / disconnected
      cardLocal.className = 'card';
      localStatusBox.className = 'gateway-status-box standby';
      localStatusDot.style.background = '#94a3b8';
      localStatusText.textContent = '待命中 (本地可用)';

      headerStatusBadge.className = 'status-badge error';
      headerStatusText.textContent = '云端未连接 (本地可用)';

      gatewayStatusText.textContent = state.error ? `连接失败: ${state.error}` : '网关未连接';
      gatewayStatusDot.style.background = 'var(--danger)';
      gatewayViewConnected.className = 'gateway-status-box warn';
    }
  } else {
    // Local mode is Active
    cardLocal.className = 'card';
    localStatusBox.className = 'gateway-status-box';
    localStatusDot.style.background = localState === 'error' ? 'var(--danger)' : 'var(--success)';
    localStatusText.textContent = localState === 'error' ? '本地异常' : '当前生效';

    gatewayContentEnabled.style.display = 'none';
    gatewayContentDisabled.style.display = 'flex';

    headerStatusBadge.className = 'status-badge connected';
    headerStatusText.textContent = '本地直连生效中';
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
  setResult('已清空云端配置，回归本地直连模式');
});

btnSaveRemote.addEventListener('click', () => {
  const url = gatewayUrlInput.value.trim();
  const token = gatewayTokenInput.value.trim();
  if (!url) {
    setResult('请输入网关地址', true);
    return;
  }
  closeModal();
  localToggle.checked = false;
  gatewayToggle.checked = true;
  void switchMode('remote', url, token);
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
