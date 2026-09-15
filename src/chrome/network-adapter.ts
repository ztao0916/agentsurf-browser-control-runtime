import type { NetworkRequestInfo } from '../core/protocol/tool-contract';

export interface NetworkRequestQuery {
  after_sequence: number;
  limit: number;
  type?: string;
  failed_only?: boolean;
}

export interface NetworkRequestPage {
  cursor: number;
  requests: NetworkRequestInfo[];
  has_more: boolean;
  truncated: boolean;
}

export interface NetworkAdapter {
  list(tabId: number, query: NetworkRequestQuery): NetworkRequestPage;
}

const MAX_REQUESTS_PER_TAB = 1_000;

/**
 * Observational `chrome.webRequest` listener. Requests are recorded continuously for every tab, so
 * unlike the debugger adapter there is no attach step and no "Chrome is being debugged" banner.
 * The buffer is in-memory, so it only covers requests seen since the service worker started.
 */
export class ChromeNetworkAdapter implements NetworkAdapter {
  private readonly entries = new Map<number, NetworkRequestInfo[]>();
  private readonly pending = new Map<string, NetworkRequestInfo>();
  private sequence = 0;

  public constructor() {
    chrome.webRequest.onBeforeRequest.addListener(
      (details) => this.onBeforeRequest(details),
      { urls: ['<all_urls>'] },
    );
    chrome.webRequest.onCompleted.addListener(
      (details) => this.onCompleted(details),
      { urls: ['<all_urls>'] },
    );
    chrome.webRequest.onErrorOccurred.addListener(
      (details) => this.onErrorOccurred(details),
      { urls: ['<all_urls>'] },
    );
    chrome.tabs.onRemoved.addListener((tabId) => this.entries.delete(tabId));
  }

  public list(tabId: number, query: NetworkRequestQuery): NetworkRequestPage {
    const all = this.entries.get(tabId) ?? [];
    const earliest = all[0]?.sequence ?? this.sequence + 1;
    const filtered = all.filter((entry) =>
      entry.sequence > query.after_sequence &&
      (query.type === undefined || entry.type === query.type) &&
      (query.failed_only !== true || isFailure(entry)));
    const requests = filtered.slice(0, query.limit);
    return {
      cursor: requests.at(-1)?.sequence ?? query.after_sequence,
      requests,
      has_more: filtered.length > requests.length,
      truncated: query.after_sequence > 0 && query.after_sequence < earliest - 1,
    };
  }

  private onBeforeRequest(details: chrome.webRequest.WebRequestBodyDetails): void {
    if (details.tabId < 0) return;
    const entry: NetworkRequestInfo = {
      sequence: ++this.sequence,
      tab_id: details.tabId,
      request_id: details.requestId,
      url: details.url,
      method: details.method,
      type: details.type,
      status_code: null,
      status_line: null,
      from_cache: null,
      error: null,
      started_at: details.timeStamp,
      duration_ms: null,
    };
    const entries = this.entries.get(details.tabId) ?? [];
    entries.push(entry);
    if (entries.length > MAX_REQUESTS_PER_TAB) {
      const evicted = entries.splice(0, entries.length - MAX_REQUESTS_PER_TAB);
      for (const item of evicted) this.pending.delete(item.request_id);
    }
    this.entries.set(details.tabId, entries);
    this.pending.set(details.requestId, entry);
  }

  private onCompleted(details: chrome.webRequest.WebResponseCacheDetails): void {
    const entry = this.pending.get(details.requestId);
    if (entry === undefined) return;
    this.pending.delete(details.requestId);
    entry.status_code = details.statusCode;
    entry.status_line = details.statusLine;
    entry.from_cache = details.fromCache;
    entry.duration_ms = Math.round(details.timeStamp - entry.started_at);
  }

  private onErrorOccurred(details: chrome.webRequest.WebResponseErrorDetails): void {
    const entry = this.pending.get(details.requestId);
    if (entry === undefined) return;
    this.pending.delete(details.requestId);
    entry.error = details.error;
    entry.from_cache = details.fromCache;
    entry.duration_ms = Math.round(details.timeStamp - entry.started_at);
  }
}

function isFailure(entry: NetworkRequestInfo): boolean {
  return entry.error !== null || (entry.status_code !== null && entry.status_code >= 400);
}
