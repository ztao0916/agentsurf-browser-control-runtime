import type { InteractiveElement, ValueState } from '../core/protocol/tool-contract';
import type { ElementRegistry } from './element-registry';
import { isElementDisabled, isElementVisible } from './element-state';

export const INTERACTIVE_SELECTOR = [
  'button',
  'a[href]',
  'input:not([type="hidden"])',
  'textarea',
  'select',
  'option',
  '[contenteditable]:not([contenteditable="false"])',
  '[role="button"]',
  '[role="link"]',
  '[role="checkbox"]',
  '[role="radio"]',
  '[role="textbox"]',
  '[role="combobox"]',
  '[role="listbox"]',
  '[role="option"]',
  '[role="switch"]',
  '[role="tab"]',
  '[role="menuitem"]',
  '[role="slider"]',
  '[role="spinbutton"]',
  'summary',
  '[tabindex]:not([tabindex="-1"])',
].join(',');

const MAX_TEXT_LENGTH = 500;

export class InteractiveExtractor {
  public constructor(
    private readonly pageDocument: Document,
    private readonly registry: ElementRegistry,
  ) {}

  public extract(): InteractiveElement[] {
    return Array.from(this.pageDocument.querySelectorAll(INTERACTIVE_SELECTOR), (element) =>
      this.describe(element as HTMLElement),
    );
  }

  private describe(element: HTMLElement): InteractiveElement {
    const input = element instanceof HTMLInputElement ? element : null;
    const option = element instanceof HTMLOptionElement ? element : null;
    const rect = element.getBoundingClientRect();

    return {
      element_id: this.registry.register(element),
      role: getRole(element),
      tag: element.tagName.toLowerCase(),
      name: getAccessibleName(element),
      text: normalizeText(element.textContent ?? ''),
      input_type: input?.type ?? null,
      placeholder: getPlaceholder(element),
      value_state: getValueState(element),
      checked: getChecked(element, input),
      selected: getSelected(element, option),
      disabled: isElementDisabled(element),
      visible: isElementVisible(element, rect),
      bounds: {
        x: rect.x,
        y: rect.y,
        width: rect.width,
        height: rect.height,
      },
    };
  }
}

export function isInteractiveCandidate(element: Element): boolean {
  return element.matches(INTERACTIVE_SELECTOR);
}

function getRole(element: HTMLElement): string {
  const explicitRole = element.getAttribute('role')?.trim();
  if (explicitRole) {
    return explicitRole;
  }
  if (element instanceof HTMLInputElement) {
    const inputRoles: Record<string, string> = {
      button: 'button',
      checkbox: 'checkbox',
      radio: 'radio',
      range: 'slider',
      reset: 'button',
      submit: 'button',
    };
    return inputRoles[element.type] ?? 'textbox';
  }
  const roles: Record<string, string> = {
    A: 'link',
    BUTTON: 'button',
    OPTION: 'option',
    SELECT: 'combobox',
    SUMMARY: 'button',
    TEXTAREA: 'textbox',
  };
  if (element.hasAttribute('contenteditable') && element.getAttribute('contenteditable') !== 'false') {
    return 'textbox';
  }
  return roles[element.tagName] ?? 'interactive';
}

function getAccessibleName(element: HTMLElement): string {
  const ariaLabel = element.getAttribute('aria-label');
  if (ariaLabel?.trim()) {
    return normalizeText(ariaLabel);
  }

  const labelledBy = element.getAttribute('aria-labelledby');
  if (labelledBy) {
    const label = labelledBy
      .split(/\s+/u)
      .map((id) => element.ownerDocument.getElementById(id)?.textContent ?? '')
      .join(' ');
    if (normalizeText(label)) {
      return normalizeText(label);
    }
  }

  if (element instanceof HTMLInputElement || element instanceof HTMLTextAreaElement || element instanceof HTMLSelectElement) {
    const labelText = Array.from(element.labels ?? [], (label) => label.textContent ?? '').join(' ');
    if (normalizeText(labelText)) {
      return normalizeText(labelText);
    }
  }

  const alternative =
    (element instanceof HTMLInputElement ? element.alt || getButtonInputValue(element) : '') ||
    element.getAttribute('title') ||
    getPlaceholder(element) ||
    element.textContent ||
    '';
  return normalizeText(alternative);
}

function getPlaceholder(element: HTMLElement): string | null {
  if (element instanceof HTMLInputElement || element instanceof HTMLTextAreaElement) {
    return element.placeholder || null;
  }
  return null;
}

function getValueState(element: HTMLElement): ValueState {
  if (element instanceof HTMLInputElement) {
    if (element.type === 'password') {
      return 'redacted';
    }
    if (element.type === 'checkbox' || element.type === 'radio') {
      return element.checked ? 'filled' : 'empty';
    }
    return element.value.length === 0 ? 'empty' : 'filled';
  }
  if (element instanceof HTMLTextAreaElement || element instanceof HTMLSelectElement) {
    return element.value.length === 0 ? 'empty' : 'filled';
  }
  if (element.hasAttribute('contenteditable') && element.getAttribute('contenteditable') !== 'false') {
    return normalizeText(element.textContent ?? '').length === 0 ? 'empty' : 'filled';
  }
  return 'not_applicable';
}

function getChecked(element: HTMLElement, input: HTMLInputElement | null): boolean | null {
  if (input !== null && (input.type === 'checkbox' || input.type === 'radio')) {
    return input.checked;
  }
  const role = element.getAttribute('role');
  if (role === 'checkbox' || role === 'radio' || role === 'switch') {
    return element.getAttribute('aria-checked') === 'true';
  }
  return null;
}

function getSelected(element: HTMLElement, option: HTMLOptionElement | null): boolean | null {
  if (option !== null) {
    return option.selected;
  }
  return element.getAttribute('role') === 'option' ? element.getAttribute('aria-selected') === 'true' : null;
}

function getButtonInputValue(input: HTMLInputElement): string {
  return input.type === 'button' || input.type === 'submit' || input.type === 'reset' ? input.value : '';
}

function normalizeText(value: string): string {
  return value.replace(/\s+/gu, ' ').trim().slice(0, MAX_TEXT_LENGTH);
}
