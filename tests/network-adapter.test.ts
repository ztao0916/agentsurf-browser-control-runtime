import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ChromeNetworkAdapter } from '../src/chrome/network-adapter';

interface Listeners {
  beforeRequest: (details: chrome.webRequest.WebRequestBodyDetails) => void;
  completed: (details: chrome.webRequest.WebResponseCacheDetails) => void;
  errorOccurred: (details: chrome.webRequest.WebResponseErrorDetails) => void;
  tabRemoved: (tabId: number) => void;
}

beforeEach(() => {
  vi.unstubAllGlobals();
});

describe('ChromeNetworkAdapter', () => {
  it('pairs a request with its completion and computes the duration', () => {
    const listeners = stubChrome();
    const adapter = new ChromeNetworkAdapter();

    listeners.beforeRequest(beforeRequest({ requestId: 'r1', url: 'https://example.com/api', method: 'POST', type: 'xmlhttprequest', timeStamp: 1_000 }));
    expect(adapter.list(1, { after_sequence: 0, limit: 10 }).requests[0]).toMatchObject({
      url: 'https://example.com/api',
      method: 'POST',
      type: 'xmlhttprequest',
      status_code: null,
      duration_ms: null,
    });

    listeners.completed(completed({ requestId: 'r1', statusCode: 201, statusLine: 'HTTP/1.1 201 Created', fromCache: false, timeStamp: 1_250 }));
    expect(adapter.list(1, { after_sequence: 0, limit: 10 }).requests[0]).toMatchObject({
      status_code: 201,
      status_line: 'HTTP/1.1 201 Created',
      from_cache: false,
      duration_ms: 250,
    });
  });

  it('records failures raised as transport errors', () => {
    const listeners = stubChrome();
    const adapter = new ChromeNetworkAdapter();

    listeners.beforeRequest(beforeRequest({ requestId: 'r1', timeStamp: 1_000 }));
    listeners.errorOccurred(errorOccurred({ requestId: 'r1', error: 'net::ERR_CONNECTION_REFUSED', fromCache: false, timeStamp: 1_100 }));

    const [request] = adapter.list(1, { after_sequence: 0, limit: 10 }).requests;
    expect(request).toMatchObject({ error: 'net::ERR_CONNECTION_REFUSED', duration_ms: 100, status_code: null });
  });

  it('ignores requests that are not associated with a tab', () => {
    const listeners = stubChrome();
    const adapter = new ChromeNetworkAdapter();
    listeners.beforeRequest(beforeRequest({ requestId: 'r1', tabId: -1 }));
    expect(adapter.list(1, { after_sequence: 0, limit: 10 }).requests).toHaveLength(0);
  });

  it('separates requests by tab', () => {
    const listeners = stubChrome();
    const adapter = new ChromeNetworkAdapter();
    listeners.beforeRequest(beforeRequest({ requestId: 'r1', tabId: 1, url: 'https://a.test/' }));
    listeners.beforeRequest(beforeRequest({ requestId: 'r2', tabId: 2, url: 'https://b.test/' }));

    expect(adapter.list(1, { after_sequence: 0, limit: 10 }).requests.map((r) => r.url)).toEqual(['https://a.test/']);
    expect(adapter.list(2, { after_sequence: 0, limit: 10 }).requests.map((r) => r.url)).toEqual(['https://b.test/']);
  });

  it('drops buffered requests when the tab closes', () => {
    const listeners = stubChrome();
    const adapter = new ChromeNetworkAdapter();
    listeners.beforeRequest(beforeRequest({ requestId: 'r1', tabId: 7 }));
    listeners.tabRemoved(7);
    expect(adapter.list(7, { after_sequence: 0, limit: 10 }).requests).toHaveLength(0);
  });

  it('filters by resource type and by failure', () => {
    const listeners = stubChrome();
    const adapter = new ChromeNetworkAdapter();
    listeners.beforeRequest(beforeRequest({ requestId: 'r1', url: 'https://a.test/app.js', type: 'script' }));
    listeners.beforeRequest(beforeRequest({ requestId: 'r2', url: 'https://a.test/api', type: 'xmlhttprequest' }));
    listeners.beforeRequest(beforeRequest({ requestId: 'r3', url: 'https://a.test/missing', type: 'xmlhttprequest' }));
    listeners.completed(completed({ requestId: 'r1', statusCode: 200 }));
    listeners.completed(completed({ requestId: 'r2', statusCode: 500 }));
    listeners.errorOccurred(errorOccurred({ requestId: 'r3', error: 'net::ERR_FAILED' }));

    expect(adapter.list(1, { after_sequence: 0, limit: 10, type: 'script' }).requests.map((r) => r.url))
      .toEqual(['https://a.test/app.js']);
    expect(adapter.list(1, { after_sequence: 0, limit: 10, failed_only: true }).requests.map((r) => r.url))
      .toEqual(['https://a.test/api', 'https://a.test/missing']);
  });

  it('paginates by sequence', () => {
    const listeners = stubChrome();
    const adapter = new ChromeNetworkAdapter();
    for (let index = 0; index < 5; index += 1) {
      listeners.beforeRequest(beforeRequest({ requestId: `r${index}`, url: `https://a.test/${index}` }));
    }

    const first = adapter.list(1, { after_sequence: 0, limit: 2 });
    expect(first.requests.map((r) => r.url)).toEqual(['https://a.test/0', 'https://a.test/1']);
    expect(first.cursor).toBe(2);
    expect(first.has_more).toBe(true);
    expect(first.truncated).toBe(false);

    const second = adapter.list(1, { after_sequence: first.cursor, limit: 2 });
    expect(second.requests.map((r) => r.url)).toEqual(['https://a.test/2', 'https://a.test/3']);

    const last = adapter.list(1, { after_sequence: second.cursor, limit: 2 });
    expect(last.requests.map((r) => r.url)).toEqual(['https://a.test/4']);
    expect(last.has_more).toBe(false);
  });

  it('reports truncation when the cursor predates evicted entries', () => {
    const listeners = stubChrome();
    const adapter = new ChromeNetworkAdapter();
    for (let index = 0; index < 1_010; index += 1) {
      listeners.beforeRequest(beforeRequest({ requestId: `r${index}` }));
    }

    // The buffer keeps the newest 1000 entries, so sequences 1..10 are gone and the oldest kept is 11.
    expect(adapter.list(1, { after_sequence: 0, limit: 1 }).requests[0]?.sequence).toBe(11);
    expect(adapter.list(1, { after_sequence: 0, limit: 1 }).truncated).toBe(false);
    expect(adapter.list(1, { after_sequence: 5, limit: 1 }).truncated).toBe(true);
  });

  it('ignores completions for requests it never saw', () => {
    const listeners = stubChrome();
    const adapter = new ChromeNetworkAdapter();
    listeners.completed(completed({ requestId: 'unknown' }));
    listeners.errorOccurred(errorOccurred({ requestId: 'unknown' }));
    expect(adapter.list(1, { after_sequence: 0, limit: 10 }).requests).toHaveLength(0);
  });
});

function stubChrome(): Listeners {
  const listeners: Partial<Listeners> = {};
  vi.stubGlobal('chrome', {
    webRequest: {
      onBeforeRequest: { addListener: (callback: Listeners['beforeRequest']) => { listeners.beforeRequest = callback; } },
      onCompleted: { addListener: (callback: Listeners['completed']) => { listeners.completed = callback; } },
      onErrorOccurred: { addListener: (callback: Listeners['errorOccurred']) => { listeners.errorOccurred = callback; } },
    },
    tabs: {
      onRemoved: { addListener: (callback: Listeners['tabRemoved']) => { listeners.tabRemoved = callback; } },
    },
  });
  return listeners as Listeners;
}

function beforeRequest(overrides: Partial<chrome.webRequest.WebRequestBodyDetails>): chrome.webRequest.WebRequestBodyDetails {
  return {
    requestId: 'r1',
    url: 'https://example.com/',
    method: 'GET',
    type: 'xmlhttprequest',
    tabId: 1,
    frameId: 0,
    parentFrameId: -1,
    timeStamp: 0,
    requestBody: null,
    ...overrides,
  };
}

function completed(overrides: Partial<chrome.webRequest.WebResponseCacheDetails>): chrome.webRequest.WebResponseCacheDetails {
  return {
    requestId: 'r1',
    url: 'https://example.com/',
    method: 'GET',
    type: 'xmlhttprequest',
    tabId: 1,
    frameId: 0,
    parentFrameId: -1,
    timeStamp: 0,
    statusCode: 200,
    statusLine: 'HTTP/1.1 200 OK',
    fromCache: false,
    ip: '127.0.0.1',
    ...overrides,
  };
}

function errorOccurred(overrides: Partial<chrome.webRequest.WebResponseErrorDetails>): chrome.webRequest.WebResponseErrorDetails {
  return {
    requestId: 'r1',
    url: 'https://example.com/',
    method: 'GET',
    type: 'xmlhttprequest',
    tabId: 1,
    frameId: 0,
    parentFrameId: -1,
    timeStamp: 0,
    error: 'net::ERR_FAILED',
    fromCache: false,
    ...overrides,
  } as chrome.webRequest.WebResponseErrorDetails;
}
