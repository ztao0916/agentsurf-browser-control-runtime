import { createToolError, ToolFailure } from '../core/protocol/errors';
import {
  createDocumentToken,
  createElementId,
  createPageRevision,
  createSnapshotId,
  parseElementId,
} from '../core/ids/element-id';

export class ElementRegistry {
  private readonly documentToken = createDocumentToken();
  private revision = 0;
  private readonly elements = new Map<string, Element>();
  private elementIds = new WeakMap<Element, string>();

  public get pageRevision(): string {
    return createPageRevision(this.documentToken, this.revision);
  }

  public createSnapshotId(): string {
    return createSnapshotId(this.documentToken, this.revision);
  }

  public register(element: Element): string {
    const existingId = this.elementIds.get(element);
    if (existingId !== undefined) {
      return existingId;
    }

    const elementId = createElementId(this.documentToken, this.revision);
    this.elements.set(elementId, element);
    this.elementIds.set(element, elementId);
    return elementId;
  }

  public resolve(elementId: string): Element {
    const parsed = parseElementId(elementId);
    if (parsed === null) {
      throw new ToolFailure(
        createToolError('element_not_found', 'The element_id is not known to this page.', false, { element_id: elementId }),
      );
    }

    if (parsed.documentToken !== this.documentToken || parsed.revision !== this.revision) {
      throw new ToolFailure(
        createToolError('stale_element', 'The element_id belongs to an older page revision.', true, {
          element_id: elementId,
          page_revision: this.pageRevision,
        }),
      );
    }

    const element = this.elements.get(elementId);
    if (element === undefined) {
      throw new ToolFailure(
        createToolError('element_not_found', 'The element_id was not found in the current page revision.', false, {
          element_id: elementId,
        }),
      );
    }
    if (!element.isConnected) {
      this.elements.delete(elementId);
      throw new ToolFailure(
        createToolError('stale_element', 'The element is no longer attached to the page.', true, { element_id: elementId }),
      );
    }
    return element;
  }

  public has(element: Element): boolean {
    return this.elementIds.has(element);
  }

  public containsRegisteredElement(node: Node): boolean {
    for (const element of this.elements.values()) {
      if (element === node || (node instanceof Element && node.contains(element))) {
        return true;
      }
    }
    return false;
  }

  public advanceRevision(): void {
    this.revision += 1;
    this.elements.clear();
    this.elementIds = new WeakMap<Element, string>();
  }
}
