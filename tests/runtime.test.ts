import { describe, expect, it } from 'vitest';
import { BrowserToolRuntime } from '../src/core/browser-tool-runtime';
import { createToolError, ToolFailure } from '../src/core/protocol/errors';
import type { PageAgentClient } from '../src/chrome/scripting-adapter';
import type { TabsAdapter } from '../src/chrome/tabs-adapter';
import type { CapturedScreenshot, ScreenshotAdapter } from '../src/chrome/screenshot-adapter';
import type { FrameAdapter } from '../src/chrome/frames-adapter';
import type { SessionCoordinator, TabClaimOrigin } from '../src/core/session/session-coordinator';
import type {
  OpenArgs,
  PageAgentInteractiveSnapshot,
  PageAgentState,
  PageAgentElementActionResult,
  PageAgentScrollResult,
  TabInfo,
  ToolRequest,
  ImageFormat,
  ConsoleEntry,
  BrowserSessionInfo,
  KeyModifier,
  PageAgentSelectTextResult,
  FrameInfo,
  InteractiveFilterArgs,
} from '../src/core/protocol/tool-contract';

const tab: TabInfo = {
  tab_id: 7,
  window_id: 1,
  url: 'https://example.com/',
  title: 'Example',
  active: true,
  status: 'complete',
  incognito: false,
  group_id: null,
};

const pageAgentState: PageAgentState = {
  url: tab.url,
  title: tab.title,
  document_ready_state: 'complete',
  viewport: {
    width: 1280,
    height: 720,
    device_pixel_ratio: 1,
    scroll_x: 0,
    scroll_y: 0,
  },
  page_revision: 'rev_document_0',
  revision_reason: 'navigation',
};

const interactiveSnapshot: PageAgentInteractiveSnapshot = {
  page_revision: pageAgentState.page_revision,
  snapshot_id: 'snap_document_0_test',
  total: 0,
  elements: [],
};

function request<TTool extends ToolRequest['tool']>(
  tool: TTool,
  args: ToolRequest<TTool>['args'],
  sessionId?: string,
): ToolRequest<TTool> {
  return {
    kind: 'tool-request',
    protocol_version: '1',
    request_id: 'test-request',
    ...(sessionId === undefined ? {} : { session_id: sessionId }),
    tool,
    args,
  } as ToolRequest<TTool>;
}

class FakeTabsAdapter implements TabsAdapter {
  public list(): Promise<TabInfo[]> {
    return Promise.resolve([tab]);
  }

  public get(): Promise<TabInfo> {
    return Promise.resolve(tab);
  }

  public getActive(): Promise<TabInfo> {
    return Promise.resolve(tab);
  }

  public activate(): Promise<TabInfo> {
    return Promise.resolve(tab);
  }

  public open(args: OpenArgs): Promise<TabInfo> {
    // Mirrors the real adapter: navigating an existing tab keeps its id, a new tab gets a new one.
    if (args.tab_id !== undefined) return Promise.resolve({ ...tab, tab_id: args.tab_id, url: args.url });
    return Promise.resolve({ ...tab, tab_id: 8, url: args.url });
  }

  public close(): Promise<void> {
    return Promise.resolve();
  }

  public back(): Promise<TabInfo> {
    return Promise.resolve(tab);
  }

  public forward(): Promise<TabInfo> {
    return Promise.resolve(tab);
  }

  public reload(): Promise<TabInfo> {
    return Promise.resolve(tab);
  }
}

const consoleEntries: ConsoleEntry[] = [
  { sequence: 1, level: 'log', source: 'console', message: 'hello', stack: null, timestamp: 10 },
  { sequence: 2, level: 'error', source: 'exception', message: 'boom', stack: 'Error: boom', timestamp: 20 },
  { sequence: 3, level: 'warn', source: 'console', message: 'careful', stack: null, timestamp: 30 },
];

class FakePageAgentClient implements PageAgentClient {
  public getState(): Promise<PageAgentState> {
    return Promise.resolve(pageAgentState);
  }

  public getConsoleMessages(): Promise<{ available: boolean; entries: ConsoleEntry[]; dropped: number }> {
    return Promise.resolve({ available: true, entries: consoleEntries, dropped: 0 });
  }

  public getInteractives(): Promise<PageAgentInteractiveSnapshot> {
    return Promise.resolve(interactiveSnapshot);
  }

  public click(): Promise<PageAgentElementActionResult & { clicked: true }> {
    return Promise.resolve({
      clicked: true,
      page_revision: pageAgentState.page_revision,
      page_revision_changed: false,
      needs_interactives_refresh: true,
    });
  }

  public doubleClick(): Promise<PageAgentElementActionResult & { double_clicked: true }> {
    return Promise.resolve({
      double_clicked: true,
      page_revision: pageAgentState.page_revision,
      page_revision_changed: false,
      needs_interactives_refresh: true,
    });
  }

  public type(): Promise<PageAgentElementActionResult & { typed: true }> {
    return Promise.resolve({
      typed: true,
      page_revision: pageAgentState.page_revision,
      page_revision_changed: false,
      needs_interactives_refresh: true,
    });
  }

  public press(): Promise<PageAgentElementActionResult & { pressed: true }> {
    return Promise.resolve({
      pressed: true,
      page_revision: pageAgentState.page_revision,
      page_revision_changed: false,
      needs_interactives_refresh: true,
    });
  }

  public setChecked(): Promise<PageAgentElementActionResult & { checked: boolean }> {
    return Promise.resolve({
      checked: true,
      page_revision: pageAgentState.page_revision,
      page_revision_changed: false,
      needs_interactives_refresh: true,
    });
  }

  public selectOption(): Promise<PageAgentElementActionResult & { selected_values: string[] }> {
    return Promise.resolve({
      selected_values: ['value'],
      page_revision: pageAgentState.page_revision,
      page_revision_changed: false,
      needs_interactives_refresh: true,
    });
  }

  public drag(): Promise<PageAgentElementActionResult & { dragged: true }> {
    return Promise.resolve({
      dragged: true,
      page_revision: pageAgentState.page_revision,
      page_revision_changed: false,
      needs_interactives_refresh: true,
    });
  }

  public waitForElement(): Promise<PageAgentElementActionResult & { matched: true; state: 'visible' }> {
    return Promise.resolve({
      matched: true,
      state: 'visible',
      page_revision: pageAgentState.page_revision,
      page_revision_changed: false,
      needs_interactives_refresh: false,
    });
  }

  public prepareFileInput(): Promise<{ marker: string; page_revision: string }> {
    return Promise.resolve({ marker: 'test-marker', page_revision: pageAgentState.page_revision });
  }

  public clearFileInputMarker(): Promise<void> {
    return Promise.resolve();
  }

  public showAgentCursor(): Promise<void> {
    return Promise.resolve();
  }

  public scroll(): Promise<PageAgentScrollResult> {
    return Promise.resolve({
      page_revision: pageAgentState.page_revision,
      page_revision_changed: false,
      needs_interactives_refresh: true,
      scroll_x: 0,
      scroll_y: 500,
      near_top: false,
      near_bottom: false,
    });
  }
}

class FakeScreenshotAdapter implements ScreenshotAdapter {
  public capture(_tab: TabInfo, _format: ImageFormat): Promise<CapturedScreenshot> {
    void _tab;
    void _format;
    return Promise.resolve({
      width: 1280,
      height: 720,
      mimeType: 'image/png',
      imageData: 'data:image/png;base64,test',
    });
  }
}

class SelectingPageAgentClient extends FakePageAgentClient {
  public selectText(): Promise<PageAgentSelectTextResult> {
    return Promise.resolve({
      selected: true,
      selection_type: 'text',
      page_revision: pageAgentState.page_revision,
      page_revision_changed: false,
      needs_interactives_refresh: false,
    });
  }
}

class RecordingPageAgentClient extends FakePageAgentClient {
  public lastClickModifiers: KeyModifier[] | undefined = undefined;
  public lastClickFrameId: number | undefined = undefined;

  public override click(
    _tabId?: number,
    frameId?: number,
    _elementId?: string,
    modifiers?: KeyModifier[],
  ): Promise<PageAgentElementActionResult & { clicked: true }> {
    this.lastClickFrameId = frameId;
    this.lastClickModifiers = modifiers;
    return Promise.resolve({
      clicked: true,
      page_revision: pageAgentState.page_revision,
      page_revision_changed: false,
      needs_interactives_refresh: true,
    });
  }
}

const frameList: FrameInfo[] = [
  { frame_id: 0, parent_frame_id: null, url: 'https://example.com/', is_top: true },
  { frame_id: 7, parent_frame_id: 0, url: 'about:blank', is_top: false },
];

class FakeFrameAdapter implements FrameAdapter {
  public lastTabId: number | undefined = undefined;

  public list(tabId: number): Promise<FrameInfo[]> {
    this.lastTabId = tabId;
    return Promise.resolve(frameList);
  }
}

interface ClaimCall {
  sessionId: string;
  tabId: number;
  origin: string;
  group: boolean;
}

class FakeSessionCoordinator implements SessionCoordinator {
  public readonly claims: ClaimCall[] = [];
  public readonly resetCalls: Array<{ sessionId: string | undefined; force: boolean }> = [];
  /** tab_id → owning session_id, as the runtime sees it when filtering list_tabs. */
  public owners = new Map<number, string>();

  public listLeases(): Promise<Map<number, string>> {
    return Promise.resolve(new Map(this.owners));
  }

  public start(sessionId?: string): Promise<BrowserSessionInfo> {
    return Promise.resolve(sessionInfo(sessionId ?? 'session_default'));
  }

  public end(): Promise<{ releasedTabIds: number[] }> {
    return Promise.resolve({ releasedTabIds: [] });
  }

  public reset(sessionId: string | undefined, force: boolean): Promise<{ releasedTabIds: number[]; sessionCount: number; otherSessionsKept: number }> {
    this.resetCalls.push({ sessionId, force });
    return Promise.resolve({ releasedTabIds: [42], sessionCount: 1, otherSessionsKept: 2 });
  }

  public name(sessionId: string): Promise<BrowserSessionInfo> {
    return Promise.resolve(sessionInfo(sessionId));
  }

  public claim(
    sessionId: string,
    _turnId: string | undefined,
    tabId: number,
    origin: TabClaimOrigin,
    group: boolean,
  ): Promise<BrowserSessionInfo> {
    this.claims.push({ sessionId, tabId, origin, group });
    return Promise.resolve(sessionInfo(sessionId));
  }

  public release(sessionId: string): Promise<BrowserSessionInfo> {
    return Promise.resolve(sessionInfo(sessionId));
  }

  public assertAccess(): Promise<void> {
    return Promise.resolve();
  }
}

function sessionInfo(sessionId: string): BrowserSessionInfo {
  return { session_id: sessionId, name: null, tab_ids: [], group_id: null };
}

class TruncatingPageAgentClient extends FakePageAgentClient {
  public lastFilter: InteractiveFilterArgs | undefined = undefined;

  public override getInteractives(
    _tabId?: number,
    _frameId?: number,
    filter?: InteractiveFilterArgs,
  ): Promise<PageAgentInteractiveSnapshot> {
    this.lastFilter = filter;
    // A page that holds more elements than the caller asked for.
    return Promise.resolve({ ...interactiveSnapshot, total: 12 });
  }
}

class MissingConsolePageAgentClient extends FakePageAgentClient {
  public override getConsoleMessages(): Promise<{ available: boolean; entries: ConsoleEntry[]; dropped: number }> {
    return Promise.resolve({ available: false, entries: [], dropped: 0 });
  }
}

class ChangingPageAgentClient extends FakePageAgentClient {
  private stateReads = 0;

  public override getState(): Promise<PageAgentState> {
    this.stateReads += 1;
    return Promise.resolve({
      ...pageAgentState,
      page_revision: this.stateReads === 1 ? 'rev_before' : 'rev_after',
    });
  }
}

class FailingScreenshotAdapter implements ScreenshotAdapter {
  public capture(): Promise<CapturedScreenshot> {
    return Promise.reject(
      new ToolFailure(createToolError('screenshot_unavailable', 'Screenshot failed.', true)),
    );
  }
}

describe('BrowserToolRuntime', () => {
  const runtime = new BrowserToolRuntime(
    new FakeTabsAdapter(),
    new FakePageAgentClient(),
    new FakeScreenshotAdapter(),
  );

  it('returns tab information for list_tabs', async () => {
    const response = await runtime.handle(request('browser.list_tabs', {}));
    expect(response.ok).toBe(true);
    if (response.ok) {
      expect(response.result.tabs[0]?.tab_id).toBe(7);
    }
  });

  it('combines Chrome tab metadata with Page Agent viewport state', async () => {
    const response = await runtime.handle(request('browser.get_page_state', {}));
    expect(response.ok).toBe(true);
    if (response.ok) {
      expect(response.result.page.viewport.width).toBe(1280);
      expect(response.result.page.loading).toBe('complete');
    }
  });

  it('adds the tab id to an interactive snapshot', async () => {
    const response = await runtime.handle(request('browser.get_interactives', {}));
    expect(response.ok).toBe(true);
    if (response.ok) {
      expect(response.result.snapshot.tab_id).toBe(7);
      expect(response.result.snapshot.snapshot_id).toBe('snap_document_0_test');
      expect(response.result.snapshot.truncated).toBe(false);
    }
  });

  it('forwards the element filters and reports a truncated snapshot', async () => {
    const truncating = new TruncatingPageAgentClient();
    const truncatingRuntime = new BrowserToolRuntime(
      new FakeTabsAdapter(),
      truncating,
      new FakeScreenshotAdapter(),
    );

    const response = await truncatingRuntime.handle(request('browser.get_interactives', {
      tab_id: 7,
      limit: 5,
      visible_only: true,
      tag: 'button',
      name_contains: 'save',
    }));

    expect(response.ok).toBe(true);
    if (response.ok) {
      expect(response.result.snapshot.total).toBe(12);
      expect(response.result.snapshot.truncated).toBe(true);
    }
    expect(truncating.lastFilter).toMatchObject({
      limit: 5,
      visible_only: true,
      tag: 'button',
      name_contains: 'save',
    });
  });

  it('returns console messages with pagination metadata', async () => {
    const response = await runtime.handle(request('browser.get_console_messages', { tab_id: 7 }));
    expect(response.ok).toBe(true);
    if (response.ok) {
      expect(response.result.available).toBe(true);
      expect(response.result.entries.map((entry) => entry.message)).toEqual(['hello', 'boom', 'careful']);
      expect(response.result.cursor).toBe(3);
      expect(response.result.has_more).toBe(false);
      expect(response.result.truncated).toBe(false);
    }
  });

  it('filters console messages by level and by sequence', async () => {
    const byLevel = await runtime.handle(request('browser.get_console_messages', { tab_id: 7, levels: ['error'] }));
    expect(byLevel.ok).toBe(true);
    if (byLevel.ok) {
      expect(byLevel.result.entries.map((entry) => entry.message)).toEqual(['boom']);
      expect(byLevel.result.cursor).toBe(2);
    }

    const afterSequence = await runtime.handle(request('browser.get_console_messages', { tab_id: 7, after_sequence: 2 }));
    expect(afterSequence.ok).toBe(true);
    if (afterSequence.ok) {
      expect(afterSequence.result.entries.map((entry) => entry.sequence)).toEqual([3]);
    }
  });

  it('limits console messages and reports that more are available', async () => {
    const response = await runtime.handle(request('browser.get_console_messages', { tab_id: 7, limit: 2 }));
    expect(response.ok).toBe(true);
    if (response.ok) {
      expect(response.result.entries).toHaveLength(2);
      expect(response.result.has_more).toBe(true);
      expect(response.result.cursor).toBe(2);
    }
  });

  it('surfaces an unavailable console collector instead of an empty list', async () => {
    const unavailable = new BrowserToolRuntime(
      new FakeTabsAdapter(),
      new MissingConsolePageAgentClient(),
      new FakeScreenshotAdapter(),
    );
    const response = await unavailable.handle(request('browser.get_console_messages', { tab_id: 7 }));
    expect(response.ok).toBe(true);
    if (response.ok) {
      expect(response.result.available).toBe(false);
      expect(response.result.entries).toEqual([]);
    }
  });

  it('forwards click modifiers to the Page Agent client', async () => {
    const recording = new RecordingPageAgentClient();
    const recordingRuntime = new BrowserToolRuntime(
      new FakeTabsAdapter(),
      recording,
      new FakeScreenshotAdapter(),
    );
    const response = await recordingRuntime.handle(
      request('browser.click', { tab_id: 7, element_id: 'opaque-id', modifiers: ['Control'] }),
    );
    expect(response.ok).toBe(true);
    expect(recording.lastClickModifiers).toEqual(['Control']);
  });

  it('routes element actions to the requested frame and defaults to the top document', async () => {
    const recording = new RecordingPageAgentClient();
    const recordingRuntime = new BrowserToolRuntime(
      new FakeTabsAdapter(),
      recording,
      new FakeScreenshotAdapter(),
    );

    await recordingRuntime.handle(request('browser.click', { tab_id: 7, element_id: 'opaque-id', frame_id: 7 }));
    expect(recording.lastClickFrameId).toBe(7);

    await recordingRuntime.handle(request('browser.click', { tab_id: 7, element_id: 'opaque-id' }));
    expect(recording.lastClickFrameId).toBe(0);
  });

  it('reports the frame id on page state and interactive snapshots', async () => {
    const framePage = await runtime.handle(request('browser.get_page_state', { tab_id: 7, frame_id: 7 }));
    expect(framePage.ok).toBe(true);
    if (framePage.ok) expect(framePage.result.page.frame_id).toBe(7);

    const topSnapshot = await runtime.handle(request('browser.get_interactives', { tab_id: 7 }));
    expect(topSnapshot.ok).toBe(true);
    if (topSnapshot.ok) expect(topSnapshot.result.snapshot.frame_id).toBe(0);

    const frameSnapshot = await runtime.handle(request('browser.get_interactives', { tab_id: 7, frame_id: 7 }));
    expect(frameSnapshot.ok).toBe(true);
    if (frameSnapshot.ok) expect(frameSnapshot.result.snapshot.frame_id).toBe(7);
  });

  it('lists frames and reports when frame enumeration is unavailable', async () => {
    const frames = new FakeFrameAdapter();
    const runtimeWithFrames = new BrowserToolRuntime(
      new FakeTabsAdapter(),
      new FakePageAgentClient(),
      new FakeScreenshotAdapter(),
      undefined,
      undefined,
      undefined,
      undefined,
      frames,
    );

    const response = await runtimeWithFrames.handle(request('browser.get_frames', { tab_id: 7 }));
    expect(response.ok).toBe(true);
    if (response.ok) {
      expect(response.result.frames.map((frame) => frame.frame_id)).toEqual([0, 7]);
      expect(response.result.frames[1]?.parent_frame_id).toBe(0);
      expect(response.result.frames[0]?.is_top).toBe(true);
    }
    expect(frames.lastTabId).toBe(7);

    const unavailable = await runtime.handle(request('browser.get_frames', { tab_id: 7 }));
    expect(unavailable.ok).toBe(false);
    if (!unavailable.ok) expect(unavailable.error.code).toBe('internal_error');
  });

  it('routes text selection through the Page Agent client', async () => {
    const selectingRuntime = new BrowserToolRuntime(
      new FakeTabsAdapter(),
      new SelectingPageAgentClient(),
      new FakeScreenshotAdapter(),
    );
    const response = await selectingRuntime.handle(
      request('browser.select_text', { tab_id: 7, element_id: 'opaque-id', text: 'hello' }),
    );
    expect(response.ok).toBe(true);
    if (response.ok) {
      expect(response.result.action).toMatchObject({ tab_id: 7, selected: true, selection_type: 'text' });
    }
  });

  it('reports that text selection is unavailable without a Page Agent implementation', async () => {
    const response = await runtime.handle(
      request('browser.select_text', { tab_id: 7, element_id: 'opaque-id', text: 'hello' }),
    );
    expect(response.ok).toBe(false);
    if (!response.ok) expect(response.error.code).toBe('invalid_request');
  });

  it('groups a tab a session takes over, and an opened tab, but not a merely navigated one', async () => {
    const sessions = new FakeSessionCoordinator();
    const runtimeWithSessions = new BrowserToolRuntime(
      new FakeTabsAdapter(),
      new FakePageAgentClient(),
      new FakeScreenshotAdapter(),
      sessions,
    );

    // A handover claims the tab and puts it in the session's group by default.
    await runtimeWithSessions.handle(request('browser.claim_tab', { session_id: 's1', tab_id: 42 }));
    expect(sessions.claims.at(-1)).toEqual({ sessionId: 's1', tabId: 42, origin: 'user', group: true });

    await runtimeWithSessions.handle(request('browser.claim_tab', { session_id: 's1', tab_id: 42, group: false }));
    expect(sessions.claims.at(-1)?.group).toBe(false);

    // A new tab is grouped; navigating an existing tab is claimed without touching the tab bar.
    const opened = await runtimeWithSessions.handle(request('browser.open', { url: 'https://open.example/' }, 's1'));
    expect(opened.ok).toBe(true);
    expect(sessions.claims.at(-1)).toEqual({ sessionId: 's1', tabId: 8, origin: 'agent', group: true });

    const navigated = await runtimeWithSessions.handle(request('browser.open', { url: 'https://open.example/', tab_id: 7 }, 's1'));
    expect(navigated.ok).toBe(true);
    expect(sessions.claims.at(-1)).toEqual({ sessionId: 's1', tabId: 7, origin: 'agent', group: false });
  });

  it('routes reset_sessions to the coordinator with the caller session and the force flag', async () => {
    const sessions = new FakeSessionCoordinator();
    const runtimeWithSessions = new BrowserToolRuntime(
      new FakeTabsAdapter(),
      new FakePageAgentClient(),
      new FakeScreenshotAdapter(),
      sessions,
    );

    const response = await runtimeWithSessions.handle(request('browser.reset_sessions', {}, 'my_session'));
    expect(response.ok).toBe(true);
    if (response.ok) {
      expect(response.result).toEqual({ released_tab_ids: [42], session_count: 1, other_sessions_kept: 2 });
    }
    expect(sessions.resetCalls).toEqual([{ sessionId: 'my_session', force: false }]);

    await runtimeWithSessions.handle(request('browser.reset_sessions', { force: true }));
    expect(sessions.resetCalls.at(-1)).toEqual({ sessionId: undefined, force: true });
  });

  it('hides tabs another session holds, unless include_all is set', async () => {
    const sessions = new FakeSessionCoordinator();
    const runtimeWithSessions = new BrowserToolRuntime(
      new FakeTabsAdapter(),
      new FakePageAgentClient(),
      new FakeScreenshotAdapter(),
      sessions,
    );

    // The fake tabs adapter only knows tab 7, so make it another session's tab.
    sessions.owners.set(7, 'other_session');

    const hidden = await runtimeWithSessions.handle(request('browser.list_tabs', {}, 'this_session'));
    expect(hidden.ok).toBe(true);
    if (hidden.ok) {
      expect(hidden.result.tabs).toEqual([]);
      expect(hidden.result.other_session_tabs).toBe(1);
    }

    const included = await runtimeWithSessions.handle(request('browser.list_tabs', { include_all: true }, 'this_session'));
    expect(included.ok).toBe(true);
    if (included.ok) {
      expect(included.result.tabs.map((tab) => tab.tab_id)).toEqual([7]);
      expect(included.result.other_session_tabs).toBeUndefined();
    }

    // The owning session sees its own tab, and an unclaimed tab is visible to everyone.
    sessions.owners.set(7, 'this_session');
    const own = await runtimeWithSessions.handle(request('browser.list_tabs', {}, 'this_session'));
    expect(own.ok).toBe(true);
    if (own.ok) expect(own.result.tabs.map((tab) => tab.tab_id)).toEqual([7]);

    sessions.owners.clear();
    const unclaimed = await runtimeWithSessions.handle(request('browser.list_tabs', {}, 'this_session'));
    expect(unclaimed.ok).toBe(true);
    if (unclaimed.ok) expect(unclaimed.result.tabs.map((tab) => tab.tab_id)).toEqual([7]);
  });

  it('rejects unsupported URL protocols', async () => {
    const response = await runtime.handle(request('browser.open', { url: 'file:///tmp/test.html' }));
    expect(response.ok).toBe(false);
    if (!response.ok) {
      expect(response.error.code).toBe('invalid_url');
    }
  });

  it('routes element actions through the Page Agent client', async () => {
    const response = await runtime.handle(request('browser.click', { tab_id: 7, element_id: 'opaque-id' }));
    expect(response.ok).toBe(true);
    if (response.ok) expect(response.result.action).toMatchObject({ tab_id: 7, clicked: true });
  });

  it('associates a screenshot with the requested tab and page revision', async () => {
    const response = await runtime.handle(request('browser.screenshot', { tab_id: 7 }));
    expect(response.ok).toBe(true);
    if (response.ok) {
      expect(response.result.screenshot).toMatchObject({
        tab_id: 7,
        page_revision: 'rev_document_0',
        width: 1280,
        height: 720,
        mime_type: 'image/png',
      });
    }
  });

  it('returns a structured error when screenshot capture fails', async () => {
    const failingRuntime = new BrowserToolRuntime(
      new FakeTabsAdapter(),
      new FakePageAgentClient(),
      new FailingScreenshotAdapter(),
    );
    const response = await failingRuntime.handle(request('browser.screenshot', { tab_id: 7 }));
    expect(response.ok).toBe(false);
    if (!response.ok) expect(response.error.code).toBe('screenshot_unavailable');
  });

  it('rejects a screenshot when the page revision changes during capture', async () => {
    const changingRuntime = new BrowserToolRuntime(
      new FakeTabsAdapter(),
      new ChangingPageAgentClient(),
      new FakeScreenshotAdapter(),
    );
    const response = await changingRuntime.handle(request('browser.screenshot', { tab_id: 7 }));
    expect(response.ok).toBe(false);
    if (!response.ok) expect(response.error.code).toBe('screenshot_unavailable');
  });
});
