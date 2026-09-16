import { createToolError, ToolFailure } from '../core/protocol/errors';
import type {
  KeyModifier,
  PageAgentElementActionResult,
  PageAgentScrollResult,
  PageAgentSelectTextResult,
  WaitForElementArgs,
} from '../core/protocol/tool-contract';
import type { ElementRegistry } from './element-registry';
import { describeKey, type KeyDescriptor } from '../core/key-descriptors';
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

  public click(elementId: string, modifiers: KeyModifier[] = []): PageAgentElementActionResult & { clicked: true } {
    this.flushMutations();
    const element = this.requireHtmlElement(elementId);
    this.requireVisible(element);
    this.requireEnabled(element);
    this.cursor?.showForElement(element);
    if (typeof element.click !== 'function') {
      throw new ToolFailure(createToolError('element_not_clickable', 'The element cannot be clicked.', false));
    }

    const previousRevision = this.registry.pageRevision;
    if (modifiers.length === 0) {
      element.click();
    } else {
      dispatchClick(this.pageWindow, element, modifiers, 1);
    }
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

  public doubleClick(elementId: string, modifiers: KeyModifier[] = []): PageAgentElementActionResult & { double_clicked: true } {
    this.flushMutations();
    const element = this.requireHtmlElement(elementId);
    this.requireVisible(element);
    this.requireEnabled(element);
    this.cursor?.showForElement(element);
    const previousRevision = this.registry.pageRevision;
    if (modifiers.length === 0) {
      element.click();
      element.click();
    } else {
      dispatchClick(this.pageWindow, element, modifiers, 2);
    }
    element.dispatchEvent(new this.pageWindow.MouseEvent('dblclick', {
      bubbles: true,
      cancelable: true,
      composed: true,
      ...mouseModifierInit(modifiers),
    }));
    this.flushMutations();
    return { double_clicked: true, ...this.actionState(previousRevision) };
  }

  public press(elementId: string, key: string, modifiers: KeyModifier[] = []): PageAgentElementActionResult & { pressed: true } {
    this.flushMutations();
    const element = this.requireHtmlElement(elementId);
    this.requireVisible(element);
    this.requireEnabled(element);
    this.cursor?.showForElement(element);
    const previousRevision = this.registry.pageRevision;
    element.focus();
    const descriptor = describeKey(key);
    const init: KeyboardEventInit = {
      key: descriptor.key,
      ...(descriptor.code === '' ? {} : { code: descriptor.code }),
      bubbles: true,
      cancelable: true,
      composed: true,
      ...keyboardModifierInit(modifiers),
    };
    const accepted = element.dispatchEvent(new this.pageWindow.KeyboardEvent('keydown', init));
    element.dispatchEvent(new this.pageWindow.KeyboardEvent('keypress', init));
    element.dispatchEvent(new this.pageWindow.KeyboardEvent('keyup', init));
    if (accepted) this.applyDefaultKeyAction(element, descriptor);
    this.flushMutations();
    return { pressed: true, ...this.actionState(previousRevision) };
  }

  /**
   * Synthetic KeyboardEvents are untrusted, so the browser never runs a key's default action for
   * them. Reproduce the two cases that matter when driving a page.
   */
  private applyDefaultKeyAction(element: HTMLElement, descriptor: KeyDescriptor): void {
    if ((descriptor.key === 'Enter' || descriptor.key === ' ') && isClickableByKeyboard(element)) {
      element.click();
      return;
    }
    // Enter submits the form a field belongs to, except in a textarea where it inserts a newline.
    if (descriptor.key !== 'Enter' || element instanceof this.pageWindow.HTMLTextAreaElement) return;
    const form = element.closest('form');
    if (form === null) return;
    // Pass the default submit button so its name and value are included, matching implicit submission.
    const submitter = form.querySelector('button[type=submit], input[type=submit], button:not([type])');
    form.requestSubmit(submitter instanceof this.pageWindow.HTMLElement ? submitter : undefined);
  }

  public selectText(
    elementId: string,
    text: string | undefined,
    selectionType: 'text' | 'cursor_before' | 'cursor_after',
  ): PageAgentSelectTextResult {
    this.flushMutations();
    const element = this.requireHtmlElement(elementId);
    this.requireVisible(element);
    this.requireEnabled(element);
    this.cursor?.showForElement(element);
    if (!isEditable(element)) {
      throw new ToolFailure(createToolError('element_not_editable', 'The element does not support text selection.', false));
    }

    const previousRevision = this.registry.pageRevision;
    element.focus();
    if (element instanceof this.pageWindow.HTMLInputElement || element instanceof this.pageWindow.HTMLTextAreaElement) {
      const value = element.value;
      if (selectionType === 'cursor_before') {
        element.setSelectionRange(0, 0);
      } else if (selectionType === 'cursor_after') {
        element.setSelectionRange(value.length, value.length);
      } else {
        const selectedText = text ?? value;
        const start = value.indexOf(selectedText);
        if (start < 0) {
          throw new ToolFailure(createToolError('element_not_found', 'The requested text was not found in the editable element.', false));
        }
        element.setSelectionRange(start, start + selectedText.length);
      }
    } else {
      const selection = this.pageWindow.getSelection();
      if (selection === null) throw new ToolFailure(createToolError('element_not_editable', 'The page does not expose a text selection.', false));
      const range = this.pageDocument.createRange();
      if (selectionType === 'cursor_before' || selectionType === 'cursor_after') {
        range.selectNodeContents(element);
        range.collapse(selectionType === 'cursor_before');
      } else {
        const node = findTextNode(element, text ?? '');
        if (node === null) throw new ToolFailure(createToolError('element_not_found', 'The requested text was not found in the editable element.', false));
        const selectedText = text ?? node.nodeValue ?? '';
        const offset = text === undefined ? 0 : node.nodeValue?.indexOf(text) ?? -1;
        if (offset < 0) throw new ToolFailure(createToolError('element_not_found', 'The requested text was not found in the editable element.', false));
        range.setStart(node, offset);
        range.setEnd(node, offset + selectedText.length);
      }
      selection.removeAllRanges();
      selection.addRange(range);
    }
    this.flushMutations();
    return { selected: true, selection_type: selectionType, ...this.actionState(previousRevision) };
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

function dispatchClick(pageWindow: BrowserWindow, element: HTMLElement, modifiers: KeyModifier[], clickCount: number): void {
  const init = { bubbles: true, cancelable: true, composed: true, ...mouseModifierInit(modifiers) };
  for (let index = 1; index <= clickCount; index += 1) {
    element.dispatchEvent(new pageWindow.MouseEvent('mousedown', { ...init, detail: index }));
    element.dispatchEvent(new pageWindow.MouseEvent('mouseup', { ...init, detail: index }));
    element.dispatchEvent(new pageWindow.MouseEvent('click', { ...init, detail: index }));
  }
}

function mouseModifierInit(modifiers: KeyModifier[]): Pick<MouseEventInit, 'altKey' | 'ctrlKey' | 'metaKey' | 'shiftKey'> {
  return {
    altKey: modifiers.includes('Alt'),
    ctrlKey: modifiers.includes('Control'),
    metaKey: modifiers.includes('Meta'),
    shiftKey: modifiers.includes('Shift'),
  };
}

function keyboardModifierInit(modifiers: KeyModifier[]): Pick<KeyboardEventInit, 'altKey' | 'ctrlKey' | 'metaKey' | 'shiftKey'> {
  return mouseModifierInit(modifiers);
}

function findTextNode(root: Node, text: string): Text | null {
  const walker = root.ownerDocument?.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  if (walker === undefined || walker === null) return null;
  let node = walker.nextNode();
  while (node !== null) {
    if (text === '' || node.nodeValue?.includes(text)) return node as Text;
    node = walker.nextNode();
  }
  return null;
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
