import { ChromePageAgentClient } from '../chrome/scripting-adapter';
import { ChromeTabsAdapter } from '../chrome/tabs-adapter';
import { ChromeScreenshotAdapter } from '../chrome/screenshot-adapter';
import { ChromeBrowserSessionCoordinator } from '../chrome/browser-session-coordinator';
import { ChromeDebuggerAdapter } from '../chrome/debugger-adapter';
import { ChromeDownloadAdapter } from '../chrome/download-adapter';
import { ChromeFrameAdapter } from '../chrome/frames-adapter';
import { BrowserToolRuntime } from '../core/browser-tool-runtime';
import { parseToolRequest } from '../core/protocol/schemas';
import { ToolFailure, toToolError } from '../core/protocol/errors';
import { registerRuntimeMessageHandler } from '../transport/runtime-message-transport';
import {
  isTransportControlRequest,
  type TransportConnectionSnapshot,
  type TransportControlRequest,
  type TransportControlResponse,
} from '../transport/transport-control';
import { NativeMessagingTransport, type NativeTransportEvent } from '../transport/native-messaging-transport';
import { RemoteGatewayTransport } from '../transport/remote-gateway-transport';
import { RemoteExecutionRuntime, type RemoteTaskRecord } from '../core/remote-execution';
import type { ToolRequest } from '../core/protocol/tool-contract';

const sessions = new ChromeBrowserSessionCoordinator();
const debuggerAdapter = new ChromeDebuggerAdapter();
const runtime = new BrowserToolRuntime(
  new ChromeTabsAdapter(),
  new ChromePageAgentClient(),
  new ChromeScreenshotAdapter(debuggerAdapter),
  sessions,
  debuggerAdapter,
  new ChromeDownloadAdapter(),
  new ChromeFrameAdapter(),
);
const remoteRuntime = new RemoteExecutionRuntime(sessions, {
  load: async () => {
    const saved = await chrome.storage.local.get('agentSurfRemoteOperations');
    return (saved.agentSurfRemoteOperations ?? []) as RemoteTaskRecord[];
  },
  save: async (tasks) => { await chrome.storage.local.set({ agentSurfRemoteOperations: tasks }); },
}, (request) => runtime.handle(request));

const handleTool = (request: ToolRequest) => request.remote || request.tool === 'browser.end_session' || request.tool === 'browser.get_operation'
  ? remoteRuntime.handle(request) : runtime.handle(request);

let currentMode: 'local' | 'remote' = 'local';
let gatewayUrl = '';
let gatewayToken = '';
let deviceId = '';
let deviceName = '';

function defaultDeviceName(id: string): string {
  const ua = typeof navigator !== 'undefined' ? navigator.userAgent : '';
  const browser = ua.includes('Edg/') ? 'Edge' : 'Chrome';
  return `${browser}-${id.slice(0, 4)}`;
}

const nativeTransport = new NativeMessagingTransport(
  handleTool,
  (event) => publishTransportEvent(event),
);

const remoteTransport = new RemoteGatewayTransport(
  handleTool,
  (event) => publishTransportEvent(event),
);

function getActiveSnapshot(): TransportConnectionSnapshot {
  const local = nativeTransport.getSnapshot();
  const remote = remoteTransport.getSnapshot();
  const active = currentMode === 'remote' ? remote : local;
  return {
    ...active,
    mode: currentMode,
    local_state: local.state,
    remote_state: remote.state,
    remote_error: remote.error,
    ...(deviceId ? { device_id: deviceId } : {}),
    ...(deviceName ? { device_name: deviceName } : {}),
  };
}

chrome.storage.local.get([
  'agentSurfMode',
  'agentSurfGatewayUrl',
  'agentSurfGatewayToken',
  'agentSurfDeviceId',
  'agentSurfDeviceName',
]).then(async (stored) => {
  if (stored['agentSurfMode'] === 'remote') {
    currentMode = 'remote';
  }
  if (typeof stored['agentSurfGatewayUrl'] === 'string') {
    gatewayUrl = stored['agentSurfGatewayUrl'];
  }
  if (typeof stored['agentSurfGatewayToken'] === 'string') {
    gatewayToken = stored['agentSurfGatewayToken'];
  }
  const updates: Record<string, string> = {};
  if (typeof stored['agentSurfDeviceId'] === 'string' && stored['agentSurfDeviceId'].length > 0) {
    deviceId = stored['agentSurfDeviceId'];
  } else {
    deviceId = crypto.randomUUID();
    updates['agentSurfDeviceId'] = deviceId;
  }
  if (typeof stored['agentSurfDeviceName'] === 'string' && stored['agentSurfDeviceName'].trim().length > 0) {
    deviceName = stored['agentSurfDeviceName'].trim();
  } else {
    deviceName = defaultDeviceName(deviceId);
    updates['agentSurfDeviceName'] = deviceName;
  }
  if (Object.keys(updates).length > 0) {
    await chrome.storage.local.set(updates).catch(() => undefined);
  }

  remoteTransport.updateDeviceInfo(deviceId, deviceName);
  remoteTransport.updateCredentials(gatewayUrl, gatewayToken);

  if (currentMode === 'remote') {
    try {
      const win = typeof chrome !== 'undefined' && chrome.windows?.getLastFocused
        ? await chrome.windows.getLastFocused()
        : undefined;
      if (win?.focused) {
        remoteTransport.markActive();
      }
    } catch {
      // Ignore if windows API is unavailable
    }
    remoteTransport.connect();
  } else {
    nativeTransport.connect();
  }
  clearExtensionBadge();
}).catch(() => {
  nativeTransport.connect();
  clearExtensionBadge();
});

if (typeof chrome !== 'undefined') {
  chrome.windows?.onFocusChanged?.addListener((windowId) => {
    if (windowId !== chrome.windows.WINDOW_ID_NONE && currentMode === 'remote' && !remoteTransport.isBusy()) {
      remoteTransport.markActive();
    }
  });
  chrome.tabs?.onActivated?.addListener(() => {
    if (currentMode === 'remote' && !remoteTransport.isBusy()) {
      remoteTransport.markActive();
    }
  });
}

registerRuntimeMessageHandler(async (message) => {
  if (isTransportControlRequest(message)) {
    return await handleTransportControl(message);
  }
  if (typeof message !== 'object' || message === null || !('kind' in message) || message.kind !== 'tool-request') {
    return undefined;
  }

  const requestId = 'request_id' in message && typeof message.request_id === 'string' ? message.request_id : 'unknown';
  try {
    return await handleTool(parseToolRequest(message));
  } catch (error: unknown) {
    const toolError = error instanceof ToolFailure ? error.toolError : toToolError(error);
    return {
      kind: 'tool-response',
      protocol_version: '1',
      request_id: requestId,
      ok: false,
      error: toolError,
    };
  }
});

async function handleTransportControl(message: TransportControlRequest): Promise<TransportControlResponse> {
  try {
    switch (message.action) {
      case 'connect':
        if (currentMode === 'remote') remoteTransport.connect();
        else nativeTransport.connect();
        break;
      case 'disconnect':
        if (currentMode === 'remote') remoteTransport.disconnect();
        else nativeTransport.disconnect();
        break;
      case 'reconnect':
        if (currentMode === 'remote') remoteTransport.reconnect();
        else nativeTransport.reconnect();
        break;
      case 'set-mode': {
        const targetMode = message.mode;
        if (message.gatewayUrl !== undefined) gatewayUrl = message.gatewayUrl;
        if (message.gatewayToken !== undefined) gatewayToken = message.gatewayToken;
        if (message.deviceName !== undefined) {
          deviceName = message.deviceName.trim() || defaultDeviceName(deviceId || crypto.randomUUID());
        }

        if (targetMode !== currentMode) {
          if (currentMode === 'remote') remoteTransport.disconnect();
          else nativeTransport.disconnect();
          currentMode = targetMode;
        }

        if (deviceId) {
          remoteTransport.updateDeviceInfo(deviceId, deviceName);
        }
        remoteTransport.updateCredentials(gatewayUrl, gatewayToken);

        await chrome.storage.local.set({
          agentSurfMode: currentMode,
          agentSurfGatewayUrl: gatewayUrl,
          agentSurfGatewayToken: gatewayToken,
          ...(deviceName ? { agentSurfDeviceName: deviceName } : {}),
        });

        if (currentMode === 'remote') {
          remoteTransport.markActive(false);
          remoteTransport.connect();
        } else {
          nativeTransport.connect();
        }
        break;
      }
      case 'set-device': {
        if (message.deviceName !== undefined) {
          deviceName = message.deviceName.trim() || defaultDeviceName(deviceId || crypto.randomUUID());
          await chrome.storage.local.set({ agentSurfDeviceName: deviceName });
        }
        if (deviceId) {
          remoteTransport.updateDeviceInfo(deviceId, deviceName);
        }
        if (message.pinActive !== undefined) {
          remoteTransport.markActive(message.pinActive);
        }
        break;
      }
      case 'get-config':
      case 'get-state':
        break;
    }

    return {
      ok: true,
      state: getActiveSnapshot(),
      config: {
        mode: currentMode,
        gatewayUrl,
        gatewayToken,
        ...(deviceName ? { deviceName } : {}),
      },
    };
  } catch (error: unknown) {
    return { ok: false, error: toToolError(error) };
  }
}

function clearExtensionBadge(): void {
  try {
    if (typeof chrome !== 'undefined' && chrome.action?.setBadgeText) {
      void chrome.action.setBadgeText({ text: '' });
    }
  } catch {
    // Ignore in non-extension environments (e.g. test)
  }
}

function publishTransportEvent(event: NativeTransportEvent): void {
  void chrome.runtime.sendMessage({ kind: 'transport-event', event }).catch(() => undefined);
}
