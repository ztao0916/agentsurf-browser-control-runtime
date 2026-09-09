import { ChromePageAgentClient } from '../chrome/scripting-adapter';
import { ChromeTabsAdapter } from '../chrome/tabs-adapter';
import { ChromeScreenshotAdapter } from '../chrome/screenshot-adapter';
import { ChromeBrowserSessionCoordinator } from '../chrome/browser-session-coordinator';
import { ChromeDebuggerAdapter } from '../chrome/debugger-adapter';
import { ChromeDownloadAdapter } from '../chrome/download-adapter';
import { BrowserToolRuntime } from '../core/browser-tool-runtime';
import { parseToolRequest } from '../core/protocol/schemas';
import { ToolFailure, toToolError } from '../core/protocol/errors';
import { registerRuntimeMessageHandler } from '../transport/runtime-message-transport';
import {
  isTransportControlRequest,
  type TransportControlRequest,
  type TransportControlResponse,
} from '../transport/transport-control';
import { NativeMessagingTransport, type NativeTransportEvent } from '../transport/native-messaging-transport';

const sessions = new ChromeBrowserSessionCoordinator();
const debuggerAdapter = new ChromeDebuggerAdapter();
const runtime = new BrowserToolRuntime(
  new ChromeTabsAdapter(),
  new ChromePageAgentClient(),
  new ChromeScreenshotAdapter(debuggerAdapter),
  sessions,
  debuggerAdapter,
  new ChromeDownloadAdapter(),
);
const externalTransport = new NativeMessagingTransport(
  (request) => runtime.handle(request),
  (event) => publishTransportEvent(event),
);

externalTransport.connect();

registerRuntimeMessageHandler(async (message) => {
  if (isTransportControlRequest(message)) {
    return handleTransportControl(message);
  }
  if (typeof message !== 'object' || message === null || !('kind' in message) || message.kind !== 'tool-request') {
    return undefined;
  }

  const requestId = 'request_id' in message && typeof message.request_id === 'string' ? message.request_id : 'unknown';
  try {
    return await runtime.handle(parseToolRequest(message));
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

function handleTransportControl(message: TransportControlRequest): TransportControlResponse {
  try {
    switch (message.action) {
      case 'connect':
        externalTransport.connect();
        break;
      case 'disconnect':
        externalTransport.disconnect();
        break;
      case 'reconnect':
        externalTransport.reconnect();
        break;
      case 'get-state':
        break;
    }
    return { ok: true, state: externalTransport.getSnapshot() };
  } catch (error: unknown) {
    return { ok: false, error: toToolError(error) };
  }
}

function publishTransportEvent(event: NativeTransportEvent): void {
  void chrome.runtime.sendMessage({ kind: 'transport-event', event }).catch(() => undefined);
}
