import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  createDocumentToken,
  createElementId,
  createSnapshotId,
  parseElementId,
} from '../src/core/ids/element-id';

/**
 * A plain http page is not a secure context, so `crypto.randomUUID` does not exist there. The Page
 * Agent runs inside the page, so every token it mints has to work without that API. jsdom and Node
 * both always provide it, which is why the missing API has to be simulated here.
 */
let randomUuidDescriptor: PropertyDescriptor | undefined;

beforeEach(() => {
  randomUuidDescriptor = Object.getOwnPropertyDescriptor(globalThis.crypto, 'randomUUID');
  Object.defineProperty(globalThis.crypto, 'randomUUID', {
    configurable: true,
    writable: true,
    value: () => {
      throw new TypeError('crypto.randomUUID is not a function');
    },
  });
});

afterEach(() => {
  if (randomUuidDescriptor === undefined) {
    delete (globalThis.crypto as unknown as Record<string, unknown>)['randomUUID'];
    return;
  }
  Object.defineProperty(globalThis.crypto, 'randomUUID', randomUuidDescriptor);
});

describe('id tokens on a non-secure context', () => {
  it('mints a 32 character hex document token without crypto.randomUUID', () => {
    expect(createDocumentToken()).toMatch(/^[a-f0-9]{32}$/u);
  });

  it('mints element and snapshot ids that parseElementId still accepts', () => {
    const documentToken = createDocumentToken();
    const elementId = createElementId(documentToken, 3);

    expect(elementId).toMatch(/^el_[a-f0-9]{32}_3_[a-f0-9]{32}$/u);
    expect(parseElementId(elementId)).toEqual({ documentToken, revision: 3 });
    expect(createSnapshotId(documentToken, 3)).toMatch(/^snap_[a-f0-9]{32}_3_[a-f0-9]{32}$/u);
  });

  it('does not repeat a token', () => {
    expect(createDocumentToken()).not.toBe(createDocumentToken());
  });
});
