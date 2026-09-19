import { createToolError, ToolFailure } from '../core/protocol/errors';
import { parsePageAgentResponse } from '../core/protocol/schemas';
import {
  PROTOCOL_VERSION,
  DEFAULT_INTERACTIVE_LIMIT,
  type InteractiveFilterArgs,
  type KeyModifier,
  type PageAgentElementActionResult,
  type PageAgentInteractiveSnapshot,
  type PageAgentRequest,
  type PageAgentScrollResult,
  type PageAgentSelectTextResult,
  type PageAgentState,
  type PageContentResult,
} from '../core/protocol/tool-contract';
import { sendPageAgentRequest } from '../transport/runtime-message-transport';

export interface PageAgentClient {
  getState(tabId: number, frameId: number): Promise<PageAgentState>;
  getInteractives(tabId: number, frameId: number, filter: InteractiveFilterArgs): Promise<PageAgentInteractiveSnapshot>;
  getPageContent?(
    tabId: number,
    frameId: number,
    options: { include_html: boolean; include_images: boolean; include_frames: boolean; max_text_length: number },
  ): Promise<PageContentResult>;
  click(tabId: number, frameId: number, elementId: string, modifiers?: KeyModifier[]): Promise<PageAgentElementActionResult & { clicked: true }>;
  doubleClick(tabId: number, frameId: number, elementId: string, modifiers?: KeyModifier[]): Promise<PageAgentElementActionResult & { double_clicked: true }>;
  type(tabId: number, frameId: number, elementId: string, text: string): Promise<PageAgentElementActionResult & { typed: true }>;
  press(tabId: number, frameId: number, elementId: string, key: string, modifiers?: KeyModifier[]): Promise<PageAgentElementActionResult & { pressed: true }>;
  selectText?(
    tabId: number,
    frameId: number,
    elementId: string,
    text: string | undefined,
    selectionType: 'text' | 'cursor_before' | 'cursor_after',
  ): Promise<PageAgentSelectTextResult>;
  setChecked(tabId: number, frameId: number, elementId: string, checked: boolean): Promise<PageAgentElementActionResult & { checked: boolean }>;
  selectOption(tabId: number, frameId: number, elementId: string, values: string[]): Promise<PageAgentElementActionResult & { selected_values: string[] }>;
  drag(tabId: number, frameId: number, sourceElementId: string, targetElementId: string): Promise<PageAgentElementActionResult & { dragged: true }>;
  waitForElement(
    tabId: number,
    frameId: number,
    elementId: string,
    state: 'attached' | 'detached' | 'visible' | 'hidden',
    timeoutMs: number,
  ): Promise<PageAgentElementActionResult & { matched: true; state: 'attached' | 'detached' | 'visible' | 'hidden' }>;
  prepareFileInput(tabId: number, frameId: number, elementId: string): Promise<{ marker: string; page_revision: string }>;
  clearFileInputMarker(tabId: number, frameId: number, marker: string): Promise<void>;
  showAgentCursor(tabId: number, frameId: number, x: number, y: number): Promise<void>;
  scroll(tabId: number, frameId: number, deltaX: number, deltaY: number): Promise<PageAgentScrollResult>;
}

function createRequestBase(): Pick<PageAgentRequest, 'kind' | 'protocol_version' | 'request_id'> {
  return {
    kind: 'page-agent-request',
    protocol_version: PROTOCOL_VERSION,
    request_id: crypto.randomUUID(),
  };
}

export class ChromePageAgentClient implements PageAgentClient {
  public async getState(tabId: number, frameId: number): Promise<PageAgentState> {
    const response = await this.send(tabId, frameId, { ...createRequestBase(), action: 'get-page-state' });
    if (!response.ok) throw new ToolFailure(response.error);
    if (response.action !== 'get-page-state') throw this.unexpectedResponse();
    return response.state;
  }

  public async getInteractives(
    tabId: number,
    frameId: number,
    filter: InteractiveFilterArgs = {},
  ): Promise<PageAgentInteractiveSnapshot> {
    // Defaults are resolved here so the request always carries the full shape the Page Agent expects.
    const response = await this.send(tabId, frameId, {
      ...createRequestBase(),
      action: 'get-interactives',
      limit: filter.limit ?? DEFAULT_INTERACTIVE_LIMIT,
      visible_only: filter.visible_only ?? false,
      ...(filter.tag === undefined ? {} : { tag: filter.tag }),
      ...(filter.role === undefined ? {} : { role: filter.role }),
      ...(filter.name_contains === undefined ? {} : { name_contains: filter.name_contains }),
    });
    if (!response.ok) throw new ToolFailure(response.error);
    if (response.action !== 'get-interactives') throw this.unexpectedResponse();
    return response.snapshot;
  }

  public async getPageContent(
    tabId: number,
    frameId: number,
    options: { include_html: boolean; include_images: boolean; include_frames: boolean; max_text_length: number },
  ): Promise<PageContentResult> {
    const response = await this.send(tabId, frameId, { ...createRequestBase(), action: 'get-page-content', ...options });
    if (!response.ok) throw new ToolFailure(response.error);
    if (response.action !== 'get-page-content') throw this.unexpectedResponse();
    return response.result;
  }

  public async click(
    tabId: number,
    frameId: number,
    elementId: string,
    modifiers: KeyModifier[] = [],
  ): Promise<PageAgentElementActionResult & { clicked: true }> {
    const response = await this.send(tabId, frameId, {
      ...createRequestBase(),
      action: 'click',
      element_id: elementId,
      ...(modifiers.length === 0 ? {} : { modifiers }),
    });
    if (!response.ok) throw new ToolFailure(response.error);
    if (response.action !== 'click') throw this.unexpectedResponse();
    return response.result;
  }

  public async doubleClick(
    tabId: number,
    frameId: number,
    elementId: string,
    modifiers: KeyModifier[] = [],
  ): Promise<PageAgentElementActionResult & { double_clicked: true }> {
    const response = await this.send(tabId, frameId, {
      ...createRequestBase(),
      action: 'double-click',
      element_id: elementId,
      ...(modifiers.length === 0 ? {} : { modifiers }),
    });
    if (!response.ok) throw new ToolFailure(response.error);
    if (response.action !== 'double-click') throw this.unexpectedResponse();
    return response.result;
  }

  public async type(
    tabId: number,
    frameId: number,
    elementId: string,
    text: string,
  ): Promise<PageAgentElementActionResult & { typed: true }> {
    const response = await this.send(tabId, frameId, { ...createRequestBase(), action: 'type', element_id: elementId, text });
    if (!response.ok) throw new ToolFailure(response.error);
    if (response.action !== 'type') throw this.unexpectedResponse();
    return response.result;
  }

  public async press(
    tabId: number,
    frameId: number,
    elementId: string,
    key: string,
    modifiers: KeyModifier[] = [],
  ): Promise<PageAgentElementActionResult & { pressed: true }> {
    const response = await this.send(tabId, frameId, {
      ...createRequestBase(),
      action: 'press',
      element_id: elementId,
      key,
      modifiers,
    });
    if (!response.ok) throw new ToolFailure(response.error);
    if (response.action !== 'press') throw this.unexpectedResponse();
    return response.result;
  }

  public async selectText(
    tabId: number,
    frameId: number,
    elementId: string,
    text: string | undefined,
    selectionType: 'text' | 'cursor_before' | 'cursor_after',
  ): Promise<PageAgentSelectTextResult> {
    const response = await this.send(tabId, frameId, {
      ...createRequestBase(),
      action: 'select-text',
      element_id: elementId,
      ...(text === undefined ? {} : { text }),
      selection_type: selectionType,
    });
    if (!response.ok) throw new ToolFailure(response.error);
    if (response.action !== 'select-text') throw this.unexpectedResponse();
    return response.result;
  }

  public async setChecked(
    tabId: number,
    frameId: number,
    elementId: string,
    checked: boolean,
  ): Promise<PageAgentElementActionResult & { checked: boolean }> {
    const response = await this.send(tabId, frameId, { ...createRequestBase(), action: 'set-checked', element_id: elementId, checked });
    if (!response.ok) throw new ToolFailure(response.error);
    if (response.action !== 'set-checked') throw this.unexpectedResponse();
    return response.result;
  }

  public async selectOption(
    tabId: number,
    frameId: number,
    elementId: string,
    values: string[],
  ): Promise<PageAgentElementActionResult & { selected_values: string[] }> {
    const response = await this.send(tabId, frameId, { ...createRequestBase(), action: 'select-option', element_id: elementId, values });
    if (!response.ok) throw new ToolFailure(response.error);
    if (response.action !== 'select-option') throw this.unexpectedResponse();
    return response.result;
  }

  public async drag(
    tabId: number,
    frameId: number,
    sourceElementId: string,
    targetElementId: string,
  ): Promise<PageAgentElementActionResult & { dragged: true }> {
    const response = await this.send(tabId, frameId, {
      ...createRequestBase(),
      action: 'drag',
      source_element_id: sourceElementId,
      target_element_id: targetElementId,
    });
    if (!response.ok) throw new ToolFailure(response.error);
    if (response.action !== 'drag') throw this.unexpectedResponse();
    return response.result;
  }

  public async waitForElement(
    tabId: number,
    frameId: number,
    elementId: string,
    state: 'attached' | 'detached' | 'visible' | 'hidden',
    timeoutMs: number,
  ): Promise<PageAgentElementActionResult & { matched: true; state: 'attached' | 'detached' | 'visible' | 'hidden' }> {
    const response = await this.send(tabId, frameId, {
      ...createRequestBase(),
      action: 'wait-for-element',
      element_id: elementId,
      state,
      timeout_ms: timeoutMs,
    });
    if (!response.ok) throw new ToolFailure(response.error);
    if (response.action !== 'wait-for-element') throw this.unexpectedResponse();
    return response.result;
  }

  public async prepareFileInput(tabId: number, frameId: number, elementId: string): Promise<{ marker: string; page_revision: string }> {
    const response = await this.send(tabId, frameId, {
      ...createRequestBase(),
      action: 'prepare-file-input',
      element_id: elementId,
    });
    if (!response.ok) throw new ToolFailure(response.error);
    if (response.action !== 'prepare-file-input') throw this.unexpectedResponse();
    return response.result;
  }

  public async clearFileInputMarker(tabId: number, frameId: number, marker: string): Promise<void> {
    const response = await this.send(tabId, frameId, {
      ...createRequestBase(),
      action: 'clear-file-input-marker',
      marker,
    });
    if (!response.ok) throw new ToolFailure(response.error);
    if (response.action !== 'clear-file-input-marker') throw this.unexpectedResponse();
  }

  public async showAgentCursor(tabId: number, frameId: number, x: number, y: number): Promise<void> {
    const response = await this.send(tabId, frameId, { ...createRequestBase(), action: 'show-agent-cursor', x, y });
    if (!response.ok) throw new ToolFailure(response.error);
    if (response.action !== 'show-agent-cursor') throw this.unexpectedResponse();
  }

  public async scroll(tabId: number, frameId: number, deltaX: number, deltaY: number): Promise<PageAgentScrollResult> {
    const response = await this.send(tabId, frameId, { ...createRequestBase(), action: 'scroll', delta_x: deltaX, delta_y: deltaY });
    if (!response.ok) throw new ToolFailure(response.error);
    if (response.action !== 'scroll') throw this.unexpectedResponse();
    return response.result;
  }

  private async send(tabId: number, frameId: number, request: PageAgentRequest): Promise<ReturnType<typeof parsePageAgentResponse>> {
    let response: unknown;

    try {
      response = await sendPageAgentRequest(tabId, request, frameId);
    } catch (error: unknown) {
      if (isMissingFrame(error)) throw frameFailure(tabId, frameId, error);
      if (!isMissingPageAgent(error)) {
        throw new ToolFailure(createToolError('internal_error', 'Communication with the Page Agent was interrupted.', true, {
          cause: String(error),
        }));
      }
      await this.inject(tabId, frameId);
      try {
        response = await sendPageAgentRequest(tabId, request, frameId);
      } catch (retryError: unknown) {
        if (isMissingFrame(retryError)) throw frameFailure(tabId, frameId, retryError);
        throw new ToolFailure(createToolError('internal_error', 'Communication with the Page Agent was interrupted.', true, {
          cause: String(retryError),
        }));
      }
    }

    return parsePageAgentResponse(response, request.action);
  }

  private unexpectedResponse(): ToolFailure {
    return new ToolFailure(createToolError('internal_error', 'Unexpected Page Agent response.', true));
  }

  private async inject(tabId: number, frameId: number): Promise<void> {
    try {
      await chrome.scripting.executeScript({
        target: { tabId, frameIds: [frameId] },
        files: ['content/page-agent.js'],
      });
    } catch (error: unknown) {
      if (isMissingFrame(error)) throw frameFailure(tabId, frameId, error);
      throw new ToolFailure(
        createToolError('unsupported_page', `Page Agent cannot run in frame ${frameId} of tab ${tabId}.`, false, {
          tab_id: tabId,
          frame_id: frameId,
          cause: String(error),
        }),
      );
    }
  }
}

/** A frame that navigated into another process disappears, so the caller can simply re-read frames. */
function frameFailure(tabId: number, frameId: number, cause: unknown): ToolFailure {
  return new ToolFailure(createToolError(
    'frame_not_found',
    `Frame ${frameId} is no longer present in tab ${tabId}.`,
    true,
    { tab_id: tabId, frame_id: frameId, cause: String(cause) },
  ));
}

function isMissingFrame(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error);
  return message.includes('No frame with id') || message.includes('Frame with ID');
}

function isMissingPageAgent(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error);
  return message.includes('Receiving end does not exist') || message.includes('Could not establish connection');
}
