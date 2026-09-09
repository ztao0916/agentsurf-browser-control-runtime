// @vitest-environment jsdom

import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { ElementRegistry } from '../src/content/element-registry';
import {
  detectInitialRevisionReason,
  PageRevisionTracker,
} from '../src/content/page-revision-tracker';
import { ToolFailure } from '../src/core/protocol/errors';

let trackers: PageRevisionTracker[] = [];

beforeEach(() => {
  document.body.innerHTML = '';
  history.replaceState({}, '', '/');
  trackers = [];
});

afterEach(() => {
  trackers.forEach((tracker) => tracker.disconnect());
});

describe('PageRevisionTracker', () => {
  it('advances revision for same-document navigation', () => {
    const { registry, tracker } = setup();
    const button = document.createElement('button');
    document.body.append(button);
    tracker.synchronize();
    const elementId = registry.register(button);
    const revision = registry.pageRevision;
    history.pushState({}, '', '/next');
    tracker.synchronize();
    expect(registry.pageRevision).not.toBe(revision);
    expect(tracker.reason).toBe('navigation');
    expectToolError(() => registry.resolve(elementId), 'stale_element');
  });

  it('distinguishes refresh from navigation at document startup', () => {
    expect(detectInitialRevisionReason('reload')).toBe('refresh');
    expect(detectInitialRevisionReason('navigate')).toBe('navigation');
    expect(detectInitialRevisionReason('back_forward')).toBe('navigation');
  });

  it('invalidates ids from the previous document after refresh', () => {
    const firstRegistry = new ElementRegistry();
    const button = document.createElement('button');
    document.body.append(button);
    const oldElementId = firstRegistry.register(button);
    const refreshedRegistry = new ElementRegistry();
    expectToolError(() => refreshedRegistry.resolve(oldElementId), 'stale_element');
  });

  it('advances revision when an interactive element is added', () => {
    const { registry, tracker } = setup();
    const revision = registry.pageRevision;
    document.body.append(document.createElement('button'));
    tracker.synchronize();
    expect(registry.pageRevision).not.toBe(revision);
    expect(tracker.reason).toBe('important_dom');
  });

  it('does not advance revision for repeated ordinary DOM changes', () => {
    const { registry, tracker } = setup();
    const revision = registry.pageRevision;
    for (let index = 0; index < 100; index += 1) {
      const span = document.createElement('span');
      span.textContent = String(index);
      document.body.append(span);
      tracker.synchronize();
    }
    expect(registry.pageRevision).toBe(revision);
  });

  it('invalidates old element ids after an important DOM change', () => {
    const { registry, tracker } = setup();
    const input = document.createElement('input');
    document.body.append(input);
    tracker.synchronize();
    const elementId = registry.register(input);
    input.disabled = true;
    tracker.synchronize();
    expectToolError(() => registry.resolve(elementId), 'stale_element');
  });
});

function setup(): { registry: ElementRegistry; tracker: PageRevisionTracker } {
  const registry = new ElementRegistry();
  const tracker = new PageRevisionTracker(document, window, registry, 'navigation');
  trackers.push(tracker);
  return { registry, tracker };
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
