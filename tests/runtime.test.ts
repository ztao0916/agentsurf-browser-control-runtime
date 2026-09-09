import { describe, expect, it } from 'vitest';
import { BrowserToolRuntime } from '../src/core/browser-tool-runtime';
import { createToolError, ToolFailure } from '../src/core/protocol/errors';
import type { PageAgentClient } from '../src/chrome/scripting-adapter';
import type { TabsAdapter } from '../src/chrome/tabs-adapter';
import type { CapturedScreenshot, ScreenshotAdapter } from '../src/chrome/screenshot-adapter';
import type {
  OpenArgs,
  PageAgentInteractiveSnapshot,
  PageAgentState,
  PageAgentElementActionResult,
  PageAgentScrollResult,
  TabInfo,
  ToolRequest,
  ImageFormat,
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
  elements: [],
};

function request<TTool extends ToolRequest['tool']>(tool: TTool, args: ToolRequest<TTool>['args']): ToolRequest<TTool> {
  return {
    kind: 'tool-request',
    protocol_version: '1',
    request_id: 'test-request',
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
    void args;
    return Promise.resolve({ ...tab, tab_id: 8, url: 'https://open.example/' });
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

class FakePageAgentClient implements PageAgentClient {
  public getState(): Promise<PageAgentState> {
    return Promise.resolve(pageAgentState);
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
    }
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
