const ELEMENT_ID_PREFIX = 'el';
const SNAPSHOT_ID_PREFIX = 'snap';
const TOKEN_BYTES = 16;

export interface ParsedElementId {
  documentToken: string;
  revision: number;
}

/**
 * `crypto.randomUUID` is a SecureContext API, so a plain http page has no such function, and the
 * Page Agent runs inside the page. `getRandomValues` carries no such restriction and produces the
 * same 32 hex characters the id format expects.
 */
export function createRandomToken(): string {
  const bytes = new Uint8Array(TOKEN_BYTES);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join('');
}

export function createDocumentToken(): string {
  return createRandomToken();
}

export function createPageRevision(documentToken: string, revision: number): string {
  return `rev_${documentToken}_${revision}`;
}

export function createElementId(documentToken: string, revision: number): string {
  return `${ELEMENT_ID_PREFIX}_${documentToken}_${revision}_${createRandomToken()}`;
}

export function createSnapshotId(documentToken: string, revision: number): string {
  return `${SNAPSHOT_ID_PREFIX}_${documentToken}_${revision}_${createRandomToken()}`;
}

export function parseElementId(elementId: string): ParsedElementId | null {
  const match = /^el_([a-f0-9]{32})_(\d+)_([a-f0-9]{32})$/u.exec(elementId);
  if (match === null) {
    return null;
  }

  const documentToken = match[1];
  const revision = Number(match[2]);
  if (documentToken === undefined || !Number.isSafeInteger(revision)) {
    return null;
  }
  return { documentToken, revision };
}
