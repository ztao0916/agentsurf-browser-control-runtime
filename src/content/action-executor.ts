import { createToolError, ToolFailure } from '../core/protocol/errors';
import type {
  PageAgentElementActionResult,
  PageAgentScrollResult,
  WaitForElementArgs,
} from '../core/protocol/tool-contract';
import type { ElementRegistry } from './element-registry';
import { isElementDisabled, isElementVisible } from './element-state';
import type { AgentCursor } from './agent-cursor';

type BrowserWindow = Window & typeof globalThis;

const TEXT_INPUT_TYPES = new Set(['email', 'number', 'password', 'search', 'tel', 'text', 'url']);
const SCROLL_EDGE_THRESHOLD = 2;
const FILE_INPUT_MARKER_ATTRIBUTE = 'data-browser-control-file-input';

export class ActionExecutor {
  public constructor(
    private readonly pageDocument: Document,
    private readonly pageWindow: BrowserWindow,
    private readonly registry: ElementRegistry,
    private readonly flushMutations: () => void,
    private readonly cursor?: AgentCursor,
  ) {}

  public click(elementId: string): PageAgentElementActionResult & { clicked: true } {
    this.flushMutations();
    const element = this.requireHtmlElement(elementId);
    this.requireVisible(element);
    this.requireEnabled(element);
    this.cursor?.showForElement(element);
    if (typeof element.click !== 'function') {
      throw new ToolFailure(createToolError('element_not_clickable', 'The element cannot be clicked.', false));
    }

    const previousRevision = this.registry.pageRevision;
    element.click();
    this.flushMutations();
    return {
      clicked: true,
      page_revision: this.registry.pageRevision,
      page_revision_changed: previousRevision !== this.registry.pageRevision,
      needs_interactives_refresh: true,
    };
  }

  public type(elementId: string, text: string): PageAgentElementActionResult & { typed: true } {
    this.flushMutations();
    const element = this.requireHtmlElement(elementId);
    this.requireVisible(element);
    this.requireEnabled(element);
    this.cursor?.showForElement(element);
    if (!isEditable(element)) {
      throw new ToolFailure(createToolError('element_not_editable', 'The element does not accept text input.', false));
    }

    const previousRevision = this.registry.pageRevision;
    element.focus();
    setEditableValue(element, text, this.pageWindow);
    element.dispatchEvent(new this.pageWindow.Event('input', { bubbles: true, composed: true }));
    element.dispatchEvent(new this.pageWindow.Event('change', { bubbles: true }));
    this.flushMutations();
    return {
      typed: true,
      page_revision: this.registry.pageRevision,
      page_revision_changed: previousRevision !== this.registry.pageRevision,
      needs_interactives_refresh: true,
    };
  }

  public doubleClick(elementId: string): PageAgentElementActionResult & { double_clicked: true } {
    this.flushMutations();
    const element = this.requireHtmlElement(elementId);
    this.requireVisible(element);
    this.requireEnabled(element);
    this.cursor?.showForElement(element);
    const previousRevision = this.registry.pageRevision;
    element.click();
    element.click();
    element.dispatchEvent(new this.pageWindow.MouseEvent('dblclick', { bubbles: true, cancelable: true, composed: true }));
    this.flushMutations();
    return { double_clicked: true, ...this.actionState(previousRevision) };
  }

  public press(elementId: string, key: string): PageAgentElementActionResult & { pressed: true } {
    this.flushMutations();
    const element = this.requireHtmlElement(elementId);
    this.requireVisible(element);
    this.requireEnabled(element);
    this.cursor?.showForElement(element);
    const previousRevision = this.registry.pageRevision;
    element.focus();
    const init: KeyboardEventInit = { key, bubbles: true, cancelable: true, composed: true };
    const accepted = element.dispatchEvent(new this.pageWindow.KeyboardEvent('keydown', init));
    element.dispatchEvent(new this.pageWindow.KeyboardEvent('keypress', init));
    element.dispatchEvent(new this.pageWindow.KeyboardEvent('keyup', init));
    if (accepted && (key === 'Enter' || key === ' ') && isClickableByKeyboard(element)) element.click();
    this.flushMutations();
    return { pressed: true, ...this.actionState(previousRevision) };
  }

  public setChecked(elementId: string, checked: boolean): PageAgentElementActionResult & { checked: boolean } {
    this.flushMutations();
    const element = this.requireHtmlElement(elementId);
    this.requireVisible(element);
    this.requireEnabled(element);
    this.cursor?.showForElement(element);
    if (!(element instanceof this.pageWindow.HTMLInputElement) ||
      (element.type !== 'checkbox' && element.type !== 'radio')) {
      throw new ToolFailure(createToolError('element_not_editable', 'The element is not a checkbox or radio input.', false));
    }
    const previousRevision = this.registry.pageRevision;
    if (element.checked !== checked) {
      element.checked = checked;
      element.dispatchEvent(new this.pageWindow.Event('input', { bubbles: true, composed: true }));
      element.dispatchEvent(new this.pageWindow.Event('change', { bubbles: true }));
    }
    this.flushMutations();
    return { checked: element.checked, ...this.actionState(previousRevision) };
  }

  public selectOption(elementId: string, values: string[]): PageAgentElementActionResult & { selected_values: string[] } {
    this.flushMutations();
    const element = this.requireHtmlElement(elementId);
    this.requireVisible(element);
    this.requireEnabled(element);
    this.cursor?.showForElement(element);
    if (!(element instanceof this.pageWindow.HTMLSelectElement)) {
      throw new ToolFailure(createToolError('element_not_editable', 'The element is not a select control.', false));
    }
    const previousRevision = this.registry.pageRevision;
    const requested = new Set(values);
    for (const option of Array.from(element.options)) option.selected = requested.has(option.value);
    const selectedValues = Array.from(element.selectedOptions, (option) => option.value);
    if (selectedValues.length === 0) {
      throw new ToolFailure(createToolError('element_not_found', 'None of the requested option values exist.', false));
    }
    element.dispatchEvent(new this.pageWindow.Event('input', { bubbles: true, composed: true }));
    element.dispatchEvent(new this.pageWindow.Event('change', { bubbles: true }));
    this.flushMutations();
    return { selected_values: selectedValues, ...this.actionState(previousRevision) };
  }

  public drag(sourceElementId: string, targetElementId: string): PageAgentElementActionResult & { dragged: true } {
    this.flushMutations();
    const source = this.requireHtmlElement(sourceElementId);
    const target = this.requireHtmlElement(targetElementId);
    this.requireVisible(source);
    this.requireVisible(target);
    this.requireEnabled(source);
    this.requireEnabled(target);
    this.cursor?.showForElement(source);
    const previousRevision = this.registry.pageRevision;
    const transfer = typeof this.pageWindow.DataTransfer === 'function' ? new this.pageWindow.DataTransfer() : undefined;
    dispatchDragEvent(this.pageWindow, source, 'dragstart', transfer);
    dispatchDragEvent(this.pageWindow, target, 'dragenter', transfer);
    dispatchDragEvent(this.pageWindow, target, 'dragover', transfer);
    dispatchDragEvent(this.pageWindow, target, 'drop', transfer);
    dispatchDragEvent(this.pageWindow, source, 'dragend', transfer);
    this.cursor?.showForElement(target);
    this.flushMutations();
    return { dragged: true, ...this.actionState(previousRevision) };
  }

  public async waitForElement(
    elementId: string,
    state: WaitForElementArgs['state'],
    timeoutMs: number,
  ): Promise<PageAgentElementActionResult & { matched: true; state: WaitForElementArgs['state'] }> {
    const previousRevision = this.registry.pageRevision;
    const deadline = Date.now() + timeoutMs;
    while (Date.now() <= deadline) {
      this.flushMutations();
      const match = this.matchesState(elementId, state);
      if (match) return { matched: true, state, ...this.actionState(previousRevision) };
      await new Promise<void>((resolve) => this.pageWindow.setTimeout(resolve, 100));
    }
    throw new ToolFailure(createToolError(
      'request_timeout',
      `Timed out waiting for element to become ${state}.`,
      true,
      { element_id: elementId, state, timeout_ms: timeoutMs },
    ));
  }

  public scroll(deltaX: number, deltaY: number): PageAgentScrollResult {
    this.flushMutations();
    const previousRevision = this.registry.pageRevision;
    const previousX = this.pageWindow.scrollX;
    const previousY = this.pageWindow.scrollY;
    this.pageWindow.scrollBy(deltaX, deltaY);
    this.flushMutations();

    const scrollX = this.pageWindow.scrollX;
    const scrollY = this.pageWindow.scrollY;
    const root = this.pageDocument.documentElement;
    const body = this.pageDocument.body;
    const maxScrollY = Math.max(root.scrollHeight, body?.scrollHeight ?? 0) - this.pageWindow.innerHeight;
    const revisionChanged = previousRevision !== this.registry.pageRevision;
    return {
      page_revision: this.registry.pageRevision,
      page_revision_changed: revisionChanged,
      needs_interactives_refresh: revisionChanged || scrollX !== previousX || scrollY !== previousY,
      scroll_x: scrollX,
      scroll_y: scrollY,
      near_top: scrollY <= SCROLL_EDGE_THRESHOLD,
      near_bottom: scrollY >= Math.max(0, maxScrollY) - SCROLL_EDGE_THRESHOLD,
    };
  }

  public prepareFileInput(elementId: string): { marker: string; page_revision: string } {
    this.flushMutations();
    const element = this.requireHtmlElement(elementId);
    this.requireEnabled(element);
    if (!(element instanceof this.pageWindow.HTMLInputElement) || element.type !== 'file') {
      throw new ToolFailure(createToolError('element_not_editable', 'The element is not a file input.', false));
    }
    this.cursor?.showForElement(element);
    const marker = this.pageWindow.crypto.randomUUID();
    element.setAttribute(FILE_INPUT_MARKER_ATTRIBUTE, marker);
    return { marker, page_revision: this.registry.pageRevision };
  }

  public clearFileInputMarker(marker: string): { cleared: true } {
    const inputs = this.pageDocument.querySelectorAll<HTMLInputElement>(`input[type="file"][${FILE_INPUT_MARKER_ATTRIBUTE}]`);
    for (const input of Array.from(inputs)) {
      if (input.getAttribute(FILE_INPUT_MARKER_ATTRIBUTE) === marker) {
        input.removeAttribute(FILE_INPUT_MARKER_ATTRIBUTE);
      }
    }
    return { cleared: true };
  }

  private requireHtmlElement(elementId: string): HTMLElement {
    const element = this.registry.resolve(elementId);
    if (!(element instanceof this.pageWindow.HTMLElement)) {
      throw new ToolFailure(createToolError('element_not_clickable', 'The element is not an HTML element.', false));
    }
    return element;
  }

  private requireVisible(element: HTMLElement): void {
    if (!isElementVisible(element)) {
      throw new ToolFailure(createToolError('element_not_visible', 'The element is not visible.', true));
    }
  }

  private requireEnabled(element: HTMLElement): void {
    if (isElementDisabled(element)) {
      throw new ToolFailure(createToolError('element_disabled', 'The element is disabled.', false));
    }
  }

  private matchesState(elementId: string, state: WaitForElementArgs['state']): boolean {
    try {
      const element = this.registry.resolve(elementId);
      if (!(element instanceof this.pageWindow.HTMLElement)) return state === 'detached' || state === 'hidden';
      if (state === 'attached') return true;
      if (state === 'detached') return false;
      const visible = isElementVisible(element);
      return state === 'visible' ? visible : !visible;
    } catch (error: unknown) {
      if (error instanceof ToolFailure && error.toolError.code === 'stale_element') {
        return state === 'detached' || state === 'hidden';
      }
      throw error;
    }
  }

  private actionState(previousRevision: string): PageAgentElementActionResult {
    const changed = previousRevision !== this.registry.pageRevision;
    return {
      page_revision: this.registry.pageRevision,
      page_revision_changed: changed,
      needs_interactives_refresh: true,
    };
  }
}

function isEditable(element: HTMLElement): boolean {
  if (element instanceof HTMLInputElement) {
    return TEXT_INPUT_TYPES.has(element.type) && !element.readOnly;
  }
  if (element instanceof HTMLTextAreaElement) {
    return !element.readOnly;
  }
  return element.hasAttribute('contenteditable') && element.getAttribute('contenteditable') !== 'false';
}

function setEditableValue(element: HTMLElement, text: string, pageWindow: BrowserWindow): void {
  if (element instanceof pageWindow.HTMLInputElement) {
    element.value = text;
    return;
  }
  if (element instanceof pageWindow.HTMLTextAreaElement) {
    element.value = text;
    return;
  }
  element.textContent = text;
}

function isClickableByKeyboard(element: HTMLElement): boolean {
  return element instanceof HTMLButtonElement || element instanceof HTMLAnchorElement ||
    element.getAttribute('role') === 'button' || element.getAttribute('role') === 'link';
}

function dispatchDragEvent(
  pageWindow: BrowserWindow,
  element: HTMLElement,
  type: string,
  dataTransfer: DataTransfer | undefined,
): void {
  if (typeof pageWindow.DragEvent === 'function') {
    element.dispatchEvent(new pageWindow.DragEvent(type, {
      bubbles: true,
      cancelable: true,
      composed: true,
      dataTransfer: dataTransfer ?? null,
    }));
    return;
  }
  element.dispatchEvent(new pageWindow.Event(type, { bubbles: true, cancelable: true, composed: true }));
}
