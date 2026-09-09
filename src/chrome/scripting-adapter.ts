import { createToolError, ToolFailure } from '../core/protocol/errors';
import { parsePageAgentResponse } from '../core/protocol/schemas';
import {
  PROTOCOL_VERSION,
  type PageAgentElementActionResult,
  type PageAgentInteractiveSnapshot,
  type PageAgentRequest,
  type PageAgentScrollResult,
  type PageAgentState,
} from '../core/protocol/tool-contract';
import { sendPageAgentRequest } from '../transport/runtime-message-transport';

export interface PageAgentClient {
  getState(tabId: number): Promise<PageAgentState>;
  getInteractives(tabId: number): Promise<PageAgentInteractiveSnapshot>;
  click(tabId: number, elementId: string): Promise<PageAgentElementActionResult & { clicked: true }>;
  doubleClick(tabId: number, elementId: string): Promise<PageAgentElementActionResult & { double_clicked: true }>;
  type(tabId: number, elementId: string, text: string): Promise<PageAgentElementActionResult & { typed: true }>;
  press(tabId: number, elementId: string, key: string): Promise<PageAgentElementActionResult & { pressed: true }>;
  setChecked(tabId: number, elementId: string, checked: boolean): Promise<PageAgentElementActionResult & { checked: boolean }>;
  selectOption(tabId: number, elementId: string, values: string[]): Promise<PageAgentElementActionResult & { selected_values: string[] }>;
  drag(tabId: number, sourceElementId: string, targetElementId: string): Promise<PageAgentElementActionResult & { dragged: true }>;
  waitForElement(
    tabId: number,
    elementId: string,
    state: 'attached' | 'detached' | 'visible' | 'hidden',
    timeoutMs: number,
  ): Promise<PageAgentElementActionResult & { matched: true; state: 'attached' | 'detached' | 'visible' | 'hidden' }>;
  prepareFileInput(tabId: number, elementId: string): Promise<{ marker: string; page_revision: string }>;
  clearFileInputMarker(tabId: number, marker: string): Promise<void>;
  showAgentCursor(tabId: number, x: number, y: number): Promise<void>;
  scroll(tabId: number, deltaX: number, deltaY: number): Promise<PageAgentScrollResult>;
}

function createRequestBase(): Pick<PageAgentRequest, 'kind' | 'protocol_version' | 'request_id'> {
  return {
    kind: 'page-agent-request',
    protocol_version: PROTOCOL_VERSION,
    request_id: crypto.randomUUID(),
  };
}

export class ChromePageAgentClient implements PageAgentClient {
  public async getState(tabId: number): Promise<PageAgentState> {
    const response = await this.send(tabId, { ...createRequestBase(), action: 'get-page-state' });
    if (!response.ok) {
      throw new ToolFailure(response.error);
    }
    if (response.action !== 'get-page-state') {
      throw new ToolFailure(createToolError('internal_error', 'Unexpected Page Agent response.', true));
    }
    return response.state;
  }

  public async getInteractives(tabId: number): Promise<PageAgentInteractiveSnapshot> {
    const response = await this.send(tabId, { ...createRequestBase(), action: 'get-interactives' });
    if (!response.ok) {
      throw new ToolFailure(response.error);
    }
    if (response.action !== 'get-interactives') {
      throw new ToolFailure(createToolError('internal_error', 'Unexpected Page Agent response.', true));
    }
    return response.snapshot;
  }

  public async click(tabId: number, elementId: string): Promise<PageAgentElementActionResult & { clicked: true }> {
    const response = await this.send(tabId, { ...createRequestBase(), action: 'click', element_id: elementId });
    if (!response.ok) throw new ToolFailure(response.error);
    if (response.action !== 'click') throw this.unexpectedResponse();
    return response.result;
  }

  public async doubleClick(tabId: number, elementId: string): Promise<PageAgentElementActionResult & { double_clicked: true }> {
    const response = await this.send(tabId, { ...createRequestBase(), action: 'double-click', element_id: elementId });
    if (!response.ok) throw new ToolFailure(response.error);
    if (response.action !== 'double-click') throw this.unexpectedResponse();
    return response.result;
  }

  public async type(
    tabId: number,
    elementId: string,
    text: string,
  ): Promise<PageAgentElementActionResult & { typed: true }> {
    const response = await this.send(tabId, { ...createRequestBase(), action: 'type', element_id: elementId, text });
    if (!response.ok) throw new ToolFailure(response.error);
    if (response.action !== 'type') throw this.unexpectedResponse();
    return response.result;
  }

  public async press(tabId: number, elementId: string, key: string): Promise<PageAgentElementActionResult & { pressed: true }> {
    const response = await this.send(tabId, { ...createRequestBase(), action: 'press', element_id: elementId, key });
    if (!response.ok) throw new ToolFailure(response.error);
    if (response.action !== 'press') throw this.unexpectedResponse();
    return response.result;
  }

  public async setChecked(
    tabId: number,
    elementId: string,
    checked: boolean,
  ): Promise<PageAgentElementActionResult & { checked: boolean }> {
    const response = await this.send(tabId, { ...createRequestBase(), action: 'set-checked', element_id: elementId, checked });
    if (!response.ok) throw new ToolFailure(response.error);
    if (response.action !== 'set-checked') throw this.unexpectedResponse();
    return response.result;
  }

  public async selectOption(
    tabId: number,
    elementId: string,
    values: string[],
  ): Promise<PageAgentElementActionResult & { selected_values: string[] }> {
    const response = await this.send(tabId, { ...createRequestBase(), action: 'select-option', element_id: elementId, values });
    if (!response.ok) throw new ToolFailure(response.error);
    if (response.action !== 'select-option') throw this.unexpectedResponse();
    return response.result;
  }

  public async drag(
    tabId: number,
    sourceElementId: string,
    targetElementId: string,
  ): Promise<PageAgentElementActionResult & { dragged: true }> {
    const response = await this.send(tabId, {
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
    elementId: string,
    state: 'attached' | 'detached' | 'visible' | 'hidden',
    timeoutMs: number,
  ): Promise<PageAgentElementActionResult & { matched: true; state: 'attached' | 'detached' | 'visible' | 'hidden' }> {
    const response = await this.send(tabId, {
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

  public async prepareFileInput(tabId: number, elementId: string): Promise<{ marker: string; page_revision: string }> {
    const response = await this.send(tabId, {
      ...createRequestBase(),
      action: 'prepare-file-input',
      element_id: elementId,
    });
    if (!response.ok) throw new ToolFailure(response.error);
    if (response.action !== 'prepare-file-input') throw this.unexpectedResponse();
    return response.result;
  }

  public async clearFileInputMarker(tabId: number, marker: string): Promise<void> {
    const response = await this.send(tabId, {
      ...createRequestBase(),
      action: 'clear-file-input-marker',
      marker,
    });
    if (!response.ok) throw new ToolFailure(response.error);
    if (response.action !== 'clear-file-input-marker') throw this.unexpectedResponse();
  }

  public async showAgentCursor(tabId: number, x: number, y: number): Promise<void> {
    const response = await this.send(tabId, { ...createRequestBase(), action: 'show-agent-cursor', x, y });
    if (!response.ok) throw new ToolFailure(response.error);
    if (response.action !== 'show-agent-cursor') throw this.unexpectedResponse();
  }

  public async scroll(tabId: number, deltaX: number, deltaY: number): Promise<PageAgentScrollResult> {
    const response = await this.send(tabId, { ...createRequestBase(), action: 'scroll', delta_x: deltaX, delta_y: deltaY });
    if (!response.ok) throw new ToolFailure(response.error);
    if (response.action !== 'scroll') throw this.unexpectedResponse();
    return response.result;
  }

  private async send(tabId: number, request: PageAgentRequest): Promise<ReturnType<typeof parsePageAgentResponse>> {
    let response: unknown;

    try {
      response = await sendPageAgentRequest(tabId, request);
    } catch (error: unknown) {
      if (!isMissingPageAgent(error)) {
        throw new ToolFailure(
          createToolError('internal_error', 'Communication with the Page Agent was interrupted.', true, {
            cause: String(error),
          }),
        );
      }
      await this.inject(tabId);
      response = await sendPageAgentRequest(tabId, request);
    }

    return parsePageAgentResponse(response, request.action);
  }

  private unexpectedResponse(): ToolFailure {
    return new ToolFailure(createToolError('internal_error', 'Unexpected Page Agent response.', true));
  }

  private async inject(tabId: number): Promise<void> {
    try {
      await chrome.scripting.executeScript({
        target: { tabId },
        files: ['content/page-agent.js'],
      });
    } catch (error: unknown) {
      throw new ToolFailure(
        createToolError('unsupported_page', `Page Agent cannot run in tab ${tabId}.`, false, { cause: String(error) }),
      );
    }
  }
}

function isMissingPageAgent(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error);
  return message.includes('Receiving end does not exist') || message.includes('Could not establish connection');
}
