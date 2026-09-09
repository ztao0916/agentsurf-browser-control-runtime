// @vitest-environment jsdom

import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ActionExecutor } from '../src/content/action-executor';
import { ElementRegistry } from '../src/content/element-registry';
import { ToolFailure } from '../src/core/protocol/errors';

function setVisible(element: Element): void {
  element.getBoundingClientRect = () => ({
    x: 10,
    y: 20,
    width: 100,
    height: 30,
    top: 20,
    right: 110,
    bottom: 50,
    left: 10,
    toJSON: () => ({}),
  });
}

function setupElement(html: string): {
  element: HTMLElement;
  elementId: string;
  registry: ElementRegistry;
  executor: ActionExecutor;
} {
  document.body.innerHTML = html;
  const element = document.body.firstElementChild;
  if (!(element instanceof HTMLElement)) throw new Error('Test element was not created.');
  setVisible(element);
  const registry = new ElementRegistry();
  return {
    element,
    elementId: registry.register(element),
    registry,
    executor: new ActionExecutor(document, window, registry, () => undefined),
  };
}

beforeEach(() => {
  document.body.innerHTML = '';
  vi.restoreAllMocks();
});

describe('ActionExecutor click', () => {
  it('clicks a registered element', () => {
    const { element, elementId, executor } = setupElement('<button>Save</button>');
    const listener = vi.fn();
    element.addEventListener('click', listener);
    const result = executor.click(elementId);
    expect(listener).toHaveBeenCalledOnce();
    expect(result).toMatchObject({ clicked: true, needs_interactives_refresh: true });
  });

  it('updates the revision when a click changes the DOM', () => {
    const { element, elementId, registry } = setupElement('<button>Add content</button>');
    const observer = new MutationObserver(() => undefined);
    observer.observe(document.body, { childList: true, subtree: true });
    const flush = (): void => {
      if (observer.takeRecords().length > 0) registry.advanceRevision();
    };
    element.addEventListener('click', () => document.body.append(document.createElement('span')));
    const executor = new ActionExecutor(document, window, registry, flush);
    const result = executor.click(elementId);
    observer.disconnect();
    expect(result.page_revision_changed).toBe(true);
    expectToolError(() => registry.resolve(elementId), 'stale_element');
  });

  it('returns element_not_found for an unknown id', () => {
    const { executor } = setupElement('<button>Save</button>');
    expectToolError(() => executor.click('unknown'), 'element_not_found');
  });

  it('returns stale_element for an old revision', () => {
    const { elementId, executor, registry } = setupElement('<button>Save</button>');
    registry.advanceRevision();
    expectToolError(() => executor.click(elementId), 'stale_element');
  });

  it('rejects disabled elements', () => {
    const { elementId, executor } = setupElement('<button disabled>Save</button>');
    expectToolError(() => executor.click(elementId), 'element_disabled');
  });

  it('rejects invisible elements', () => {
    const { element, elementId, executor } = setupElement('<button>Save</button>');
    element.style.display = 'none';
    expectToolError(() => executor.click(elementId), 'element_not_visible');
  });
});

describe('ActionExecutor type', () => {
  it('types into input and fires input/change events', () => {
    const { element, elementId, executor } = setupElement('<input type="text">');
    const inputListener = vi.fn();
    const changeListener = vi.fn();
    element.addEventListener('input', inputListener);
    element.addEventListener('change', changeListener);
    executor.type(elementId, 'hello');
    expect((element as HTMLInputElement).value).toBe('hello');
    expect(inputListener).toHaveBeenCalledOnce();
    expect(changeListener).toHaveBeenCalledOnce();
  });

  it('types into textarea', () => {
    const { element, elementId, executor } = setupElement('<textarea></textarea>');
    executor.type(elementId, 'notes');
    expect((element as HTMLTextAreaElement).value).toBe('notes');
  });

  it('types into contenteditable', () => {
    const { element, elementId, executor } = setupElement('<div contenteditable="true"></div>');
    executor.type(elementId, 'editable text');
    expect(element.textContent).toBe('editable text');
  });

  it('rejects disabled fields', () => {
    const { elementId, executor } = setupElement('<input disabled>');
    expectToolError(() => executor.type(elementId, 'text'), 'element_disabled');
  });

  it('rejects elements that are not editable', () => {
    const { elementId, executor } = setupElement('<button>Not editable</button>');
    expectToolError(() => executor.type(elementId, 'text'), 'element_not_editable');
  });

  it('returns stale_element for an old revision', () => {
    const { elementId, executor, registry } = setupElement('<input>');
    registry.advanceRevision();
    expectToolError(() => executor.type(elementId, 'text'), 'stale_element');
  });

  it('does not include a password in the result', () => {
    const secret = 'never-return-this';
    const { element, elementId, executor } = setupElement('<input type="password">');
    const result = executor.type(elementId, secret);
    expect((element as HTMLInputElement).value).toBe(secret);
    expect(JSON.stringify(result)).not.toContain(secret);
  });
});

describe('ActionExecutor scroll', () => {
  it('scrolls down', () => {
    const { executor, getPosition } = setupScroll(0, 1_000, 100);
    const result = executor.scroll(0, 300);
    expect(result.scroll_y).toBe(300);
    expect(getPosition()).toBe(300);
  });

  it('scrolls up', () => {
    const { executor } = setupScroll(500, 1_000, 100);
    expect(executor.scroll(0, -200).scroll_y).toBe(300);
  });

  it('reports the top state', () => {
    const { executor } = setupScroll(10, 1_000, 100);
    expect(executor.scroll(0, -50).near_top).toBe(true);
  });

  it('reports the bottom state', () => {
    const { executor } = setupScroll(850, 1_000, 100);
    expect(executor.scroll(0, 100).near_bottom).toBe(true);
  });
});

function setupScroll(initialY: number, scrollHeight: number, viewportHeight: number): {
  executor: ActionExecutor;
  getPosition: () => number;
} {
  let x = 0;
  let y = initialY;
  const maxY = Math.max(0, scrollHeight - viewportHeight);
  Object.defineProperty(window, 'scrollX', { configurable: true, get: () => x });
  Object.defineProperty(window, 'scrollY', { configurable: true, get: () => y });
  Object.defineProperty(window, 'innerHeight', { configurable: true, value: viewportHeight });
  Object.defineProperty(document.documentElement, 'scrollHeight', { configurable: true, value: scrollHeight });
  function scrollBy(options?: ScrollToOptions): void;
  function scrollBy(deltaX: number, deltaY: number): void;
  function scrollBy(deltaXOrOptions: number | ScrollToOptions = 0, deltaY = 0): void {
    const deltaX = typeof deltaXOrOptions === 'number' ? deltaXOrOptions : (deltaXOrOptions.left ?? 0);
    const resolvedDeltaY = typeof deltaXOrOptions === 'number' ? deltaY : (deltaXOrOptions.top ?? 0);
    x += deltaX;
    y = Math.max(0, Math.min(maxY, y + resolvedDeltaY));
  }
  window.scrollBy = scrollBy;
  const registry = new ElementRegistry();
  return {
    executor: new ActionExecutor(document, window, registry, () => undefined),
    getPosition: () => y,
  };
}

function expectToolError(action: () => unknown, code: string): void {
  try {
    action();
    throw new Error('Expected action to throw.');
  } catch (error: unknown) {
    expect(error).toBeInstanceOf(ToolFailure);
    if (error instanceof ToolFailure) expect(error.toolError.code).toBe(code);
  }
}
