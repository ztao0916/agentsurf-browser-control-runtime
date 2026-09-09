const ELEMENT_ID_PREFIX = 'el';
const SNAPSHOT_ID_PREFIX = 'snap';

export interface ParsedElementId {
  documentToken: string;
  revision: number;
}

function randomToken(): string {
  return crypto.randomUUID().replaceAll('-', '');
}

export function createDocumentToken(): string {
  return randomToken();
}

export function createPageRevision(documentToken: string, revision: number): string {
  return `rev_${documentToken}_${revision}`;
}

export function createElementId(documentToken: string, revision: number): string {
  return `${ELEMENT_ID_PREFIX}_${documentToken}_${revision}_${randomToken()}`;
}

export function createSnapshotId(documentToken: string, revision: number): string {
  return `${SNAPSHOT_ID_PREFIX}_${documentToken}_${revision}_${randomToken()}`;
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
