import type { PageRevisionReason } from '../core/protocol/tool-contract';
import type { ElementRegistry } from './element-registry';
import { INTERACTIVE_SELECTOR, isInteractiveCandidate } from './interactive-extractor';

type BrowserWindow = Window & typeof globalThis;

const LARGE_STRUCTURE_CHANGE = 20;
const SEMANTIC_ATTRIBUTES = new Set([
  'aria-disabled',
  'aria-hidden',
  'aria-label',
  'aria-labelledby',
  'contenteditable',
  'disabled',
  'hidden',
  'href',
  'readonly',
  'role',
  'tabindex',
  'type',
]);

const OBSERVED_ATTRIBUTES = [...SEMANTIC_ATTRIBUTES, 'class', 'style'];

export class PageRevisionTracker {
  private currentUrl: string;
  private readonly observer: MutationObserver;
  private revisionReason: PageRevisionReason;

  public constructor(
    pageDocument: Document,
    private readonly pageWindow: BrowserWindow,
    private readonly registry: ElementRegistry,
    initialReason = detectInitialRevisionReason(getNavigationType(pageWindow.performance)),
  ) {
    this.currentUrl = pageWindow.location.href;
    this.revisionReason = initialReason;
    this.observer = new pageWindow.MutationObserver((records) => this.process(records));
    this.observer.observe(pageDocument.documentElement, {
      subtree: true,
      childList: true,
      attributes: true,
      attributeFilter: OBSERVED_ATTRIBUTES,
    });
  }

  public get reason(): PageRevisionReason {
    return this.revisionReason;
  }

  public synchronize(): void {
    if (this.pageWindow.location.href !== this.currentUrl) {
      this.currentUrl = this.pageWindow.location.href;
      this.observer.takeRecords();
      this.advance('navigation');
      return;
    }
    this.process(this.observer.takeRecords());
  }

  public disconnect(): void {
    this.observer.disconnect();
  }

  private process(records: MutationRecord[]): void {
    if (records.some((record) => this.isImportant(record))) {
      this.advance('important_dom');
    }
  }

  private isImportant(record: MutationRecord): boolean {
    if (record.type === 'attributes') {
      if (!(record.target instanceof this.pageWindow.Element)) return false;
      const attributeName = record.attributeName ?? '';
      if (attributeName === 'class' || attributeName === 'style') {
        return this.registry.has(record.target);
      }
      return SEMANTIC_ATTRIBUTES.has(attributeName) &&
        (this.registry.has(record.target) || isInteractiveCandidate(record.target));
    }

    const changedNodes = [...Array.from(record.addedNodes), ...Array.from(record.removedNodes)];
    if (changedNodes.some((node) => this.registry.containsRegisteredElement(node))) return true;
    if (changedNodes.some(containsInteractiveCandidate)) return true;
    return changedNodes.reduce((count, node) => count + countElements(node), 0) >= LARGE_STRUCTURE_CHANGE;
  }

  private advance(reason: PageRevisionReason): void {
    this.registry.advanceRevision();
    this.revisionReason = reason;
  }
}

export function detectInitialRevisionReason(
  navigationType: PerformanceNavigationTiming['type'] | undefined,
): PageRevisionReason {
  return navigationType === 'reload' ? 'refresh' : 'navigation';
}

function getNavigationType(performance: Performance): PerformanceNavigationTiming['type'] | undefined {
  const entry = performance.getEntriesByType('navigation')[0];
  if (entry === undefined || !('type' in entry)) return undefined;
  const type = entry.type;
  return type === 'navigate' || type === 'reload' || type === 'back_forward' ? type : undefined;
}

function containsInteractiveCandidate(node: Node): boolean {
  if (!(node instanceof Element)) return false;
  return isInteractiveCandidate(node) || node.querySelector(INTERACTIVE_SELECTOR) !== null;
}

function countElements(node: Node): number {
  if (!(node instanceof Element)) return 0;
  return 1 + node.querySelectorAll('*').length;
}
