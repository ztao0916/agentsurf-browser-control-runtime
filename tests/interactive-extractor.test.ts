// @vitest-environment jsdom

import { beforeEach, describe, expect, it } from 'vitest';
import { ToolFailure } from '../src/core/protocol/errors';
import { ElementRegistry } from '../src/content/element-registry';
import { InteractiveExtractor } from '../src/content/interactive-extractor';

function setVisible(element: Element): void {
  element.getBoundingClientRect = () =>
    ({ x: 10, y: 20, width: 100, height: 30, top: 20, right: 110, bottom: 50, left: 10, toJSON: () => ({}) });
}

function setup(html: string): { registry: ElementRegistry; elements: ReturnType<InteractiveExtractor['extract']> } {
  document.body.innerHTML = html;
  Array.from(document.body.querySelectorAll('*')).forEach(setVisible);
  const registry = new ElementRegistry();
  return { registry, elements: new InteractiveExtractor(document, registry).extract() };
}

beforeEach(() => {
  document.body.innerHTML = '';
});

describe('InteractiveExtractor', () => {
  it('recognizes buttons and links', () => {
    const { elements } = setup('<button>Save</button><a href="/docs">Documentation</a>');
    expect(elements.map(({ role, tag }) => ({ role, tag }))).toEqual([
      { role: 'button', tag: 'button' },
      { role: 'link', tag: 'a' },
    ]);
    expect(elements.map((element) => element.name)).toEqual(['Save', 'Documentation']);
  });

  it('recognizes input and textarea fields', () => {
    const { elements } = setup(
      '<label for="email">Email</label><input id="email" type="email" placeholder="name@example.com"><textarea aria-label="Notes"></textarea>',
    );
    expect(elements[0]).toMatchObject({ role: 'textbox', tag: 'input', name: 'Email', input_type: 'email' });
    expect(elements[1]).toMatchObject({ role: 'textbox', tag: 'textarea', name: 'Notes', input_type: null });
  });

  it('recognizes checkbox and radio state', () => {
    const { elements } = setup('<input type="checkbox" checked aria-label="Subscribe"><input type="radio" aria-label="Daily">');
    expect(elements[0]).toMatchObject({ role: 'checkbox', checked: true, value_state: 'filled' });
    expect(elements[1]).toMatchObject({ role: 'radio', checked: false, value_state: 'empty' });
  });

  it('recognizes disabled and invisible elements', () => {
    const { elements } = setup('<button disabled>Disabled</button><button id="hidden" style="display:none">Hidden</button>');
    expect(elements[0]).toMatchObject({ disabled: true, visible: true });
    expect(elements[1]).toMatchObject({ disabled: false, visible: false });
  });

  it('never exposes a password value', () => {
    const secret = 'correct-horse-battery-staple';
    const { elements } = setup(`<input type="password" value="${secret}" aria-label="Password">`);
    expect(elements[0]).toMatchObject({ input_type: 'password', value_state: 'redacted' });
    expect(JSON.stringify(elements[0])).not.toContain(secret);
  });

  it('maps an element_id back to its DOM element', () => {
    const { registry, elements } = setup('<button id="save">Save</button>');
    expect(registry.resolve(elements[0]?.element_id ?? '')).toBe(document.getElementById('save'));
  });

  it('invalidates an old element_id after the page revision changes', () => {
    const { registry, elements } = setup('<button>Save</button>');
    const oldId = elements[0]?.element_id ?? '';
    const oldRevision = registry.pageRevision;
    registry.advanceRevision();
    expect(registry.pageRevision).not.toBe(oldRevision);
    expectToolError(() => registry.resolve(oldId), 'stale_element');
  });

  it('returns stale_element after a registered element leaves the document', () => {
    const { registry, elements } = setup('<button id="remove-me">Remove</button>');
    const elementId = elements[0]?.element_id ?? '';
    document.getElementById('remove-me')?.remove();
    expectToolError(() => registry.resolve(elementId), 'stale_element');
  });

  it('returns element_not_found for an unknown element_id', () => {
    const { registry, elements } = setup('<button>Known</button>');
    const knownId = elements[0]?.element_id ?? '';
    const unknownId = knownId.replace(/[a-f0-9]{32}$/u, '00000000000000000000000000000000');
    expectToolError(() => registry.resolve(unknownId), 'element_not_found');
  });
});

function expectToolError(action: () => unknown, code: string): void {
  try {
    action();
    throw new Error('Expected action to throw.');
  } catch (error: unknown) {
    expect(error).toBeInstanceOf(ToolFailure);
    if (error instanceof ToolFailure) expect(error.toolError.code).toBe(code);
  }
}
