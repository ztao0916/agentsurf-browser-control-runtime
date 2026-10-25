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
  };
}

chrome.storage.local.get(['agentSurfMode', 'agentSurfGatewayUrl', 'agentSurfGatewayToken']).then((stored) => {
  if (stored['agentSurfMode'] === 'remote') {
    currentMode = 'remote';
  }
  if (typeof stored['agentSurfGatewayUrl'] === 'string') {
    gatewayUrl = stored['agentSurfGatewayUrl'];
  }
  if (typeof stored['agentSurfGatewayToken'] === 'string') {
    gatewayToken = stored['agentSurfGatewayToken'];
  }

  remoteTransport.updateCredentials(gatewayUrl, gatewayToken);

  if (currentMode === 'remote') {
    remoteTransport.connect();
  } else {
    nativeTransport.connect();
  }
  clearExtensionBadge();
}).catch(() => {
  nativeTransport.connect();
  clearExtensionBadge();
});

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

        if (targetMode !== currentMode) {
          if (currentMode === 'remote') remoteTransport.disconnect();
          else nativeTransport.disconnect();
          currentMode = targetMode;
        }

        remoteTransport.updateCredentials(gatewayUrl, gatewayToken);

        await chrome.storage.local.set({
          agentSurfMode: currentMode,
          agentSurfGatewayUrl: gatewayUrl,
          agentSurfGatewayToken: gatewayToken,
        });

        if (currentMode === 'remote') {
          remoteTransport.connect();
        } else {
          nativeTransport.connect();
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
