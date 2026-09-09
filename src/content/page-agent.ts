import { ToolFailure, toToolError } from '../core/protocol/errors';
import { parsePageAgentRequest } from '../core/protocol/schemas';
import {
  PROTOCOL_VERSION,
  type PageAgentRequest,
  type PageAgentResponse,
  type PageAgentState,
} from '../core/protocol/tool-contract';
import { registerRuntimeMessageHandler } from '../transport/runtime-message-transport';
import { ActionExecutor } from './action-executor';
import { ElementRegistry } from './element-registry';
import { InteractiveExtractor } from './interactive-extractor';
import { PageRevisionTracker } from './page-revision-tracker';
import { AgentCursor } from './agent-cursor';

const INSTALLATION_KEY = '__browserControlRuntimePageAgentInstalled';

declare global {
  interface Window {
    __browserControlRuntimePageAgentInstalled?: boolean;
  }
}

function getPageState(registry: ElementRegistry, tracker: PageRevisionTracker): PageAgentState {
  return {
    url: window.location.href,
    title: document.title,
    document_ready_state: document.readyState,
    viewport: {
      width: window.innerWidth,
      height: window.innerHeight,
      device_pixel_ratio: window.devicePixelRatio,
      scroll_x: window.scrollX,
      scroll_y: window.scrollY,
    },
    page_revision: registry.pageRevision,
    revision_reason: tracker.reason,
  };
}

function isPageAgentRequest(message: unknown): message is PageAgentRequest {
  return typeof message === 'object' && message !== null && 'kind' in message && message.kind === 'page-agent-request';
}

if (!window[INSTALLATION_KEY]) {
  window[INSTALLATION_KEY] = true;
  const registry = new ElementRegistry();
  const extractor = new InteractiveExtractor(document, registry);
  const tracker = new PageRevisionTracker(document, window, registry);
  const cursor = new AgentCursor(document);
  const executor = new ActionExecutor(document, window, registry, () => tracker.synchronize(), cursor);

  registerRuntimeMessageHandler(async (message) => {
    if (!isPageAgentRequest(message)) {
      return undefined;
    }

    try {
      const request = parsePageAgentRequest(message);
      tracker.synchronize();
      switch (request.action) {
        case 'get-page-state':
          return success(request, { action: 'get-page-state', state: getPageState(registry, tracker) });
        case 'get-interactives':
          return success(request, {
            action: 'get-interactives',
            snapshot: {
              page_revision: registry.pageRevision,
              snapshot_id: registry.createSnapshotId(),
              elements: extractor.extract(),
            },
          });
        case 'click':
          return success(request, { action: 'click', result: executor.click(request.element_id) });
        case 'double-click':
          return success(request, { action: 'double-click', result: executor.doubleClick(request.element_id) });
        case 'type':
          return success(request, { action: 'type', result: executor.type(request.element_id, request.text) });
        case 'press':
          return success(request, { action: 'press', result: executor.press(request.element_id, request.key) });
        case 'set-checked':
          return success(request, { action: 'set-checked', result: executor.setChecked(request.element_id, request.checked) });
        case 'select-option':
          return success(request, { action: 'select-option', result: executor.selectOption(request.element_id, request.values) });
        case 'drag':
          return success(request, {
            action: 'drag',
            result: executor.drag(request.source_element_id, request.target_element_id),
          });
        case 'wait-for-element':
          return success(request, {
            action: 'wait-for-element',
            result: await executor.waitForElement(request.element_id, request.state, request.timeout_ms),
          });
        case 'prepare-file-input':
          return success(request, {
            action: 'prepare-file-input',
            result: executor.prepareFileInput(request.element_id),
          });
        case 'clear-file-input-marker':
          return success(request, {
            action: 'clear-file-input-marker',
            result: executor.clearFileInputMarker(request.marker),
          });
        case 'show-agent-cursor':
          cursor.show(request.x, request.y);
          return success(request, { action: 'show-agent-cursor', result: { shown: true } });
        case 'scroll':
          return success(request, { action: 'scroll', result: executor.scroll(request.delta_x, request.delta_y) });
      }
    } catch (error: unknown) {
      const toolError = error instanceof ToolFailure ? error.toolError : toToolError(error);
      return {
        kind: 'page-agent-response',
        protocol_version: PROTOCOL_VERSION,
        request_id: getRequestId(message),
        ok: false,
        error: toolError,
      } satisfies PageAgentResponse;
    }
  });
}

type SuccessPayload =
  | Pick<Extract<PageAgentResponse, { ok: true; action: 'get-page-state' }>, 'action' | 'state'>
  | Pick<Extract<PageAgentResponse, { ok: true; action: 'get-interactives' }>, 'action' | 'snapshot'>
  | Pick<Extract<PageAgentResponse, { ok: true; action: 'click' }>, 'action' | 'result'>
  | Pick<Extract<PageAgentResponse, { ok: true; action: 'double-click' }>, 'action' | 'result'>
  | Pick<Extract<PageAgentResponse, { ok: true; action: 'type' }>, 'action' | 'result'>
  | Pick<Extract<PageAgentResponse, { ok: true; action: 'press' }>, 'action' | 'result'>
  | Pick<Extract<PageAgentResponse, { ok: true; action: 'set-checked' }>, 'action' | 'result'>
  | Pick<Extract<PageAgentResponse, { ok: true; action: 'select-option' }>, 'action' | 'result'>
  | Pick<Extract<PageAgentResponse, { ok: true; action: 'drag' }>, 'action' | 'result'>
  | Pick<Extract<PageAgentResponse, { ok: true; action: 'wait-for-element' }>, 'action' | 'result'>
  | Pick<Extract<PageAgentResponse, { ok: true; action: 'prepare-file-input' }>, 'action' | 'result'>
  | Pick<Extract<PageAgentResponse, { ok: true; action: 'clear-file-input-marker' }>, 'action' | 'result'>
  | Pick<Extract<PageAgentResponse, { ok: true; action: 'show-agent-cursor' }>, 'action' | 'result'>
  | Pick<Extract<PageAgentResponse, { ok: true; action: 'scroll' }>, 'action' | 'result'>;

function success(request: PageAgentRequest, payload: SuccessPayload): PageAgentResponse {
  return {
    kind: 'page-agent-response',
    protocol_version: PROTOCOL_VERSION,
    request_id: request.request_id,
    ok: true,
    ...payload,
  };
}

function getRequestId(message: PageAgentRequest): string {
  return typeof message.request_id === 'string' ? message.request_id : 'unknown';
}
