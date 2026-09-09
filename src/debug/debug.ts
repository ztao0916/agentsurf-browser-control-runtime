import { sendRuntimeMessage, sendToolRequest } from '../transport/runtime-message-transport';
import {
  PROTOCOL_VERSION,
  type ListTabsResult,
  type ToolName,
  type ToolRequest,
  type ToolResponse,
} from '../core/protocol/tool-contract';
import { isTransportControlResponse } from '../transport/transport-control';
import type { TransportControlRequest, TransportEventMessage } from '../transport/transport-control';

const output = getElement<HTMLPreElement>('output');
const status = getElement<HTMLParagraphElement>('status');
const tabSelect = getElement<HTMLSelectElement>('tab-select');
const urlInput = getElement<HTMLInputElement>('url-input');
const elementIdInput = getElement<HTMLInputElement>('element-id-input');
const textInput = getElement<HTMLInputElement>('text-input');
const deltaXInput = getElement<HTMLInputElement>('delta-x-input');
const deltaYInput = getElement<HTMLInputElement>('delta-y-input');
const imageFormatSelect = getElement<HTMLSelectElement>('image-format-select');
const screenshotPreview = getElement<HTMLImageElement>('screenshot-preview');
const connectionStatus = getElement<HTMLElement>('connection-status');
const nativeHostName = getElement<HTMLElement>('native-host-name');
const bridgeEndpoint = getElement<HTMLElement>('bridge-endpoint');
const sessionIdInput = getElement<HTMLInputElement>('session-id-input');
const sessionNameInput = getElement<HTMLInputElement>('session-name-input');
const groupClaimedTab = getElement<HTMLInputElement>('group-claimed-tab');
const keyInput = getElement<HTMLInputElement>('key-input');
const fullPageInput = getElement<HTMLInputElement>('full-page-input');
const cdpMethodInput = getElement<HTMLInputElement>('cdp-method-input');
const cdpParamsInput = getElement<HTMLInputElement>('cdp-params-input');
const coordinateXInput = getElement<HTMLInputElement>('coordinate-x-input');
const coordinateYInput = getElement<HTMLInputElement>('coordinate-y-input');
const filePathsInput = getElement<HTMLTextAreaElement>('file-paths-input');
const requestLog = getElement<HTMLPreElement>('request-log');
const responseLog = getElement<HTMLPreElement>('response-log');
const connectionLog = getElement<HTMLPreElement>('connection-log');

function getElement<T extends HTMLElement>(id: string): T {
  const element = document.getElementById(id);
  if (element === null) {
    throw new Error(`Debug element #${id} was not found.`);
  }
  return element as T;
}

function request<TTool extends ToolName>(tool: TTool, args: ToolRequest<TTool>['args']): Promise<ToolResponse<TTool>> {
  const sessionId = sessionIdInput.value.trim();
  const toolRequest = {
    kind: 'tool-request',
    protocol_version: PROTOCOL_VERSION,
    request_id: crypto.randomUUID(),
    ...(sessionId === '' ? {} : { session_id: sessionId, turn_id: `debug-${Date.now()}` }),
    tool,
    args,
  } as ToolRequest;
  appendLog(requestLog, toolRequest);
  return sendToolRequest(toolRequest).then((response) => {
    appendLog(responseLog, summarizeImages(response));
    return response as ToolResponse<TTool>;
  });
}

function appendLog(target: HTMLPreElement, value: unknown): void {
  const line = `[${new Date().toLocaleTimeString()}] ${typeof value === 'string' ? value : JSON.stringify(value)}\n`;
  target.textContent = `${line}${target.textContent ?? ''}`.slice(0, 20_000);
}

function summarizeImages(value: unknown): unknown {
  if (typeof value !== 'object' || value === null) return value;
  return JSON.parse(JSON.stringify(value, (key, fieldValue: unknown) =>
    key === 'image_data' && typeof fieldValue === 'string' ? `[image data: ${fieldValue.length} characters]` : fieldValue)) as unknown;
}

async function sendTransportControl(message: TransportControlRequest): Promise<void> {
  const response = await sendRuntimeMessage(message);
  if (!isTransportControlResponse(response)) {
    appendLog(connectionLog, 'Invalid transport control response.');
    return;
  }
  if (response.ok) {
    connectionStatus.textContent = response.state.state;
    nativeHostName.textContent = response.state.host_name;
    bridgeEndpoint.textContent = response.state.bridge_url ?? 'unavailable';
  } else {
    appendLog(connectionLog, `${response.error.code}: ${response.error.message}`);
  }
}

function show(value: unknown): void {
  output.textContent = JSON.stringify(
    value,
    (key, fieldValue: unknown) =>
      key === 'image_data' && typeof fieldValue === 'string'
        ? `${fieldValue.slice(0, 40)}...[${fieldValue.length} characters]`
        : fieldValue,
    2,
  );
}

function setStatus(message: string): void {
  status.textContent = message;
}

function renderTabs(result: ListTabsResult): void {
  tabSelect.replaceChildren();
  let firstWebTabId: number | undefined;
  for (const tab of result.tabs) {
    const option = document.createElement('option');
    option.value = String(tab.tab_id);
    option.textContent = `${tab.active ? '* ' : ''}${tab.title || tab.url || `Tab ${tab.tab_id}`}`;
    tabSelect.append(option);
    if (firstWebTabId === undefined && /^https?:\/\//u.test(tab.url)) {
      firstWebTabId = tab.tab_id;
    }
  }
  if (firstWebTabId !== undefined) {
    tabSelect.value = String(firstWebTabId);
  }
}

function getSelectedTabId(): number | undefined {
  const tabId = Number(tabSelect.value);
  return Number.isInteger(tabId) ? tabId : undefined;
}

async function run<TTool extends ToolName>(tool: TTool, args: ToolRequest<TTool>['args']): Promise<ToolResponse<TTool> | undefined> {
  setStatus(`Calling ${tool}...`);
  try {
    const response = await request(tool, args);
    show(response);
    setStatus(response.ok ? `${tool} completed.` : `${tool} failed: ${response.error.code}`);
    return response;
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error);
    setStatus(`Transport error: ${message}`);
    show({ error: message });
    return undefined;
  }
}

async function listTabs(): Promise<void> {
  const response = await run('browser.list_tabs', {});
  if (response?.ok) {
    renderTabs(response.result);
  }
}

document.getElementById('list-tabs')?.addEventListener('click', () => void listTabs());
document.getElementById('get-page-state')?.addEventListener('click', () => {
  const tabId = getSelectedTabId();
  void run('browser.get_page_state', tabId === undefined ? {} : { tab_id: tabId });
});
document.getElementById('get-interactives')?.addEventListener('click', () => {
  const tabId = getSelectedTabId();
  void run('browser.get_interactives', tabId === undefined ? {} : { tab_id: tabId });
});
document.getElementById('switch-tab')?.addEventListener('click', () => {
  const tabId = getSelectedTabId();
  if (tabId !== undefined) {
    void run('browser.switch_tab', { tab_id: tabId }).then(() => listTabs());
  }
});
for (const [id, tool] of [
  ['back-tab', 'browser.back'],
  ['forward-tab', 'browser.forward'],
  ['reload-tab', 'browser.reload'],
  ['close-tab', 'browser.close_tab'],
] as const) {
  document.getElementById(id)?.addEventListener('click', () => {
    const tabId = getSelectedTabId();
    if (tabId !== undefined) void run(tool, { tab_id: tabId }).then(() => listTabs());
  });
}
document.getElementById('open-url')?.addEventListener('click', () => {
  void run('browser.open', { url: urlInput.value, activate: true }).then(() => listTabs());
});
document.getElementById('click-element')?.addEventListener('click', () => {
  const tabId = getSelectedTabId();
  if (tabId !== undefined) void run('browser.click', { tab_id: tabId, element_id: elementIdInput.value });
});
document.getElementById('double-click-element')?.addEventListener('click', () => {
  const tabId = getSelectedTabId();
  if (tabId !== undefined) void run('browser.double_click', { tab_id: tabId, element_id: elementIdInput.value });
});
document.getElementById('type-element')?.addEventListener('click', () => {
  const tabId = getSelectedTabId();
  if (tabId !== undefined) {
    void run('browser.type', { tab_id: tabId, element_id: elementIdInput.value, text: textInput.value });
  }
});
document.getElementById('press-element')?.addEventListener('click', () => {
  const tabId = getSelectedTabId();
  if (tabId !== undefined) {
    void run('browser.press', { tab_id: tabId, element_id: elementIdInput.value, key: keyInput.value });
  }
});
document.getElementById('check-element')?.addEventListener('click', () => {
  const tabId = getSelectedTabId();
  if (tabId !== undefined) void run('browser.set_checked', { tab_id: tabId, element_id: elementIdInput.value, checked: true });
});
document.getElementById('uncheck-element')?.addEventListener('click', () => {
  const tabId = getSelectedTabId();
  if (tabId !== undefined) void run('browser.set_checked', { tab_id: tabId, element_id: elementIdInput.value, checked: false });
});
document.getElementById('move-pointer')?.addEventListener('click', () => {
  const tabId = getSelectedTabId();
  if (tabId !== undefined) {
    void run('browser.mouse_move', {
      tab_id: tabId,
      x: Number(coordinateXInput.value),
      y: Number(coordinateYInput.value),
    });
  }
});
document.getElementById('click-coordinate')?.addEventListener('click', () => {
  const tabId = getSelectedTabId();
  if (tabId !== undefined) {
    void run('browser.click_at', {
      tab_id: tabId,
      x: Number(coordinateXInput.value),
      y: Number(coordinateYInput.value),
    });
  }
});
document.getElementById('scroll-coordinate')?.addEventListener('click', () => {
  const tabId = getSelectedTabId();
  if (tabId !== undefined) {
    void run('browser.scroll_at', {
      tab_id: tabId,
      x: Number(coordinateXInput.value),
      y: Number(coordinateYInput.value),
      delta_x: Number(deltaXInput.value),
      delta_y: Number(deltaYInput.value),
    });
  }
});
document.getElementById('scroll-page')?.addEventListener('click', () => {
  const tabId = getSelectedTabId();
  if (tabId !== undefined) {
    void run('browser.scroll', {
      tab_id: tabId,
      delta_x: Number(deltaXInput.value),
      delta_y: Number(deltaYInput.value),
    });
  }
});
document.getElementById('screenshot-page')?.addEventListener('click', () => {
  const tabId = getSelectedTabId();
  const imageFormat = imageFormatSelect.value === 'jpeg' ? 'jpeg' : 'png';
  if (tabId !== undefined) {
    void run('browser.screenshot', {
      tab_id: tabId,
      image_format: imageFormat,
      full_page: fullPageInput.checked,
    }).then((response) => {
      if (response?.ok) screenshotPreview.src = response.result.screenshot.image_data;
    });
  }
});
document.getElementById('observe-page')?.addEventListener('click', () => {
  const tabId = getSelectedTabId();
  if (tabId !== undefined) {
    void run('browser.observe', { tab_id: tabId, image_format: 'png', full_page: fullPageInput.checked })
      .then((response) => {
        if (response?.ok && response.result.observation.screenshot !== undefined) {
          screenshotPreview.src = response.result.observation.screenshot.image_data;
        }
      });
  }
});
document.getElementById('accessibility-tree')?.addEventListener('click', () => {
  const tabId = getSelectedTabId();
  if (tabId !== undefined) void run('browser.get_accessibility_tree', { tab_id: tabId });
});
document.getElementById('set-files')?.addEventListener('click', () => {
  const tabId = getSelectedTabId();
  const files = filePathsInput.value.split(/\r?\n/u).map((file) => file.trim()).filter((file) => file !== '');
  if (tabId !== undefined) {
    void run('browser.set_files', { tab_id: tabId, element_id: elementIdInput.value, files });
  }
});
document.getElementById('list-downloads')?.addEventListener('click', () => {
  void run('browser.list_downloads', {});
});
document.getElementById('wait-download')?.addEventListener('click', () => {
  const tabId = getSelectedTabId();
  if (tabId !== undefined) void run('browser.wait_for_download', { tab_id: tabId, timeout_ms: 30_000 });
});

document.getElementById('start-session')?.addEventListener('click', () => {
  const requestedId = sessionIdInput.value.trim();
  void run('browser.start_session', {
    ...(requestedId === '' ? {} : { session_id: requestedId }),
    ...(sessionNameInput.value.trim() === '' ? {} : { name: sessionNameInput.value.trim() }),
  }).then((response) => {
    if (response?.ok) sessionIdInput.value = response.result.session.session_id;
  });
});
document.getElementById('name-session')?.addEventListener('click', () => {
  if (sessionIdInput.value.trim() !== '') {
    void run('browser.name_session', { session_id: sessionIdInput.value.trim(), name: sessionNameInput.value });
  }
});
document.getElementById('end-session')?.addEventListener('click', () => {
  if (sessionIdInput.value.trim() !== '') {
    void run('browser.end_session', { session_id: sessionIdInput.value.trim(), close_tabs: false });
  }
});
document.getElementById('claim-tab')?.addEventListener('click', () => {
  const tabId = getSelectedTabId();
  const sessionId = sessionIdInput.value.trim();
  if (tabId !== undefined && sessionId !== '') {
    void run('browser.claim_tab', { session_id: sessionId, tab_id: tabId, group: groupClaimedTab.checked }).then(() => listTabs());
  }
});
document.getElementById('release-tab')?.addEventListener('click', () => {
  const tabId = getSelectedTabId();
  const sessionId = sessionIdInput.value.trim();
  if (tabId !== undefined && sessionId !== '') {
    void run('browser.release_tab', { session_id: sessionId, tab_id: tabId }).then(() => listTabs());
  }
});

document.getElementById('attach-debugger')?.addEventListener('click', () => {
  const tabId = getSelectedTabId();
  if (tabId !== undefined) void run('browser.attach_debugger', { tab_id: tabId });
});
document.getElementById('detach-debugger')?.addEventListener('click', () => {
  const tabId = getSelectedTabId();
  if (tabId !== undefined) void run('browser.detach_debugger', { tab_id: tabId });
});
document.getElementById('send-cdp')?.addEventListener('click', () => {
  const tabId = getSelectedTabId();
  if (tabId === undefined) return;
  try {
    const params = JSON.parse(cdpParamsInput.value) as Record<string, unknown>;
    void run('browser.cdp', { tab_id: tabId, method: cdpMethodInput.value, params });
  } catch (error: unknown) {
    show({ error: `Invalid CDP params JSON: ${String(error)}` });
  }
});
document.getElementById('read-cdp-events')?.addEventListener('click', () => {
  const tabId = getSelectedTabId();
  if (tabId !== undefined) void run('browser.get_cdp_events', { tab_id: tabId, limit: 100 });
});

document.getElementById('connect-bridge')?.addEventListener('click', () => {
  void sendTransportControl({ kind: 'transport-control', action: 'connect' });
});
document.getElementById('disconnect-bridge')?.addEventListener('click', () => {
  void sendTransportControl({ kind: 'transport-control', action: 'disconnect' });
});
document.getElementById('reconnect-bridge')?.addEventListener('click', () => {
  void sendTransportControl({ kind: 'transport-control', action: 'reconnect' });
});

chrome.runtime.onMessage.addListener((message: unknown) => {
  if (typeof message !== 'object' || message === null || !('kind' in message) || message.kind !== 'transport-event') return;
  const eventMessage = message as TransportEventMessage;
  if (eventMessage.event.category === 'state') {
    connectionStatus.textContent = eventMessage.event.state ?? eventMessage.event.message;
  }
  if (eventMessage.event.category === 'request') appendLog(requestLog, eventMessage.event);
  if (eventMessage.event.category === 'response') appendLog(responseLog, eventMessage.event);
  if (eventMessage.event.category === 'error') appendLog(connectionLog, eventMessage.event);
});

void listTabs();
void sendTransportControl({ kind: 'transport-control', action: 'get-state' });
