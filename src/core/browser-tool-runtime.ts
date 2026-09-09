import { createToolError, ToolFailure, toToolError } from './protocol/errors';
import type {
  ClickResult,
  GetPageResult,
  GetInteractivesResult,
  OpenArgs,
  OpenResult,
  PageState,
  ScrollResult,
  ScreenshotArgs,
  ScreenshotResult,
  ObserveResult,
  TabInfo,
  ToolRequest,
  ToolResponse,
  ToolResults,
  TypeResult,
  ToolName,
} from './protocol/tool-contract';
import type { SessionCoordinator } from './session/session-coordinator';
import type { DebuggerAdapter } from '../chrome/debugger-adapter';
import { TOOL_NAMES } from './protocol/schemas';
import type { PageAgentClient } from '../chrome/scripting-adapter';
import type { TabsAdapter } from '../chrome/tabs-adapter';
import type { ScreenshotAdapter } from '../chrome/screenshot-adapter';
import type { DownloadAdapter } from '../chrome/download-adapter';

export class BrowserToolRuntime {
  public constructor(
    private readonly tabs: TabsAdapter,
    private readonly pageAgent: PageAgentClient,
    private readonly screenshots: ScreenshotAdapter,
    private readonly sessions?: SessionCoordinator,
    private readonly debuggerAdapter?: DebuggerAdapter,
    private readonly downloads?: DownloadAdapter,
  ) {}

  public handle<TTool extends ToolName>(request: ToolRequest<TTool>): Promise<ToolResponse<TTool>>;
  public async handle(request: ToolRequest): Promise<ToolResponse> {
    try {
      const result = await this.dispatch(request);
      return {
        kind: 'tool-response',
        protocol_version: '1',
        request_id: request.request_id,
        ok: true,
        result,
      };
    } catch (error: unknown) {
      return {
        kind: 'tool-response',
        protocol_version: '1',
        request_id: request.request_id,
        ok: false,
        error: toToolError(error),
      };
    }
  }

  private async dispatch(request: ToolRequest): Promise<ToolResults[ToolName]> {
    switch (request.tool) {
      case 'browser.get_capabilities':
        return {
          protocol_version: '1',
          tools: [...TOOL_NAMES],
          features: {
            native_messaging: true,
            websocket_agent_bridge: true,
            sessions: true,
            tab_groups: true,
            tab_leases: true,
            element_ids: true,
            accessibility_tree: true,
            screenshots: ['viewport', 'full_page', 'clip'],
            cdp: true,
            downloads: true,
            file_upload: true,
            agent_cursor: true,
            top_level_document: true,
            iframes: false,
            shadow_dom: false,
          },
        };
      case 'browser.start_session':
        return { session: await this.requireSessions().start(request.args.session_id, request.args.name) };
      case 'browser.end_session': {
        const ended = await this.requireSessions().end(request.args.session_id, request.args.close_tabs ?? false);
        return {
          session_id: request.args.session_id,
          released_tab_ids: ended.releasedTabIds,
          closed_tabs: request.args.close_tabs ?? false,
        };
      }
      case 'browser.name_session':
        return { session: await this.requireSessions().name(request.args.session_id, request.args.name) };
      case 'browser.claim_tab':
        return {
          session: await this.requireSessions().claim(
            request.args.session_id,
            request.turn_id,
            request.args.tab_id,
            'user',
            request.args.group ?? false,
          ),
        };
      case 'browser.release_tab':
        return {
          session: await this.requireSessions().release(request.args.session_id, request.args.tab_id),
          released_tab_id: request.args.tab_id,
        };
      case 'browser.close_tab':
        await this.assertSessionAccess(request.session_id, request.args.tab_id);
        await this.tabs.close(request.args.tab_id);
        return { tab_id: request.args.tab_id, closed: true };
      case 'browser.back':
        await this.assertSessionAccess(request.session_id, request.args.tab_id);
        return { tab: await this.tabs.back(request.args.tab_id) };
      case 'browser.forward':
        await this.assertSessionAccess(request.session_id, request.args.tab_id);
        return { tab: await this.tabs.forward(request.args.tab_id) };
      case 'browser.reload':
        await this.assertSessionAccess(request.session_id, request.args.tab_id);
        return { tab: await this.tabs.reload(request.args.tab_id) };
      case 'browser.attach_debugger':
        await this.assertSessionAccess(request.session_id, request.args.tab_id);
        await this.requireDebugger().attach(request.args.tab_id);
        return { tab_id: request.args.tab_id, attached: true };
      case 'browser.detach_debugger':
        await this.assertSessionAccess(request.session_id, request.args.tab_id);
        await this.requireDebugger().detach(request.args.tab_id);
        return { tab_id: request.args.tab_id, attached: false };
      case 'browser.cdp':
        await this.assertSessionAccess(request.session_id, request.args.tab_id);
        return {
          tab_id: request.args.tab_id,
          value: await this.requireDebugger().send(request.args.tab_id, request.args.method, request.args.params),
        };
      case 'browser.get_cdp_events': {
        await this.assertSessionAccess(request.session_id, request.args.tab_id);
        const events = this.requireDebugger().getEvents(
          request.args.tab_id,
          request.args.after_sequence ?? 0,
          Math.min(request.args.limit ?? 100, 1_000),
          request.args.methods,
        );
        return { tab_id: request.args.tab_id, ...events };
      }
      case 'browser.get_accessibility_tree': {
        await this.assertSessionAccess(request.session_id, request.args.tab_id);
        const state = await this.pageAgent.getState(request.args.tab_id);
        const value = await this.requireDebugger().send(request.args.tab_id, 'Accessibility.getFullAXTree');
        const nodes = getArray(value, 'nodes');
        return { tab_id: request.args.tab_id, page_revision: state.page_revision, nodes };
      }
      case 'browser.mouse_move':
        await this.requireTabAccess(request.session_id, request.args.tab_id);
        await this.showAgentCursor(request.args.tab_id, request.args.x, request.args.y);
        await this.requireDebugger().send(request.args.tab_id, 'Input.dispatchMouseEvent', {
          type: 'mouseMoved', x: request.args.x, y: request.args.y,
        });
        return { tab_id: request.args.tab_id, performed: true };
      case 'browser.click_at': {
        await this.requireTabAccess(request.session_id, request.args.tab_id);
        await this.showAgentCursor(request.args.tab_id, request.args.x, request.args.y);
        const button = request.args.button ?? 'left';
        const clickCount = request.args.click_count ?? 1;
        await this.requireDebugger().send(request.args.tab_id, 'Input.dispatchMouseEvent', {
          type: 'mouseMoved', x: request.args.x, y: request.args.y,
        });
        await this.requireDebugger().send(request.args.tab_id, 'Input.dispatchMouseEvent', {
          type: 'mousePressed', x: request.args.x, y: request.args.y, button, clickCount,
        });
        await this.requireDebugger().send(request.args.tab_id, 'Input.dispatchMouseEvent', {
          type: 'mouseReleased', x: request.args.x, y: request.args.y, button, clickCount,
        });
        return { tab_id: request.args.tab_id, performed: true };
      }
      case 'browser.drag_at': {
        await this.requireTabAccess(request.session_id, request.args.tab_id);
        await this.showAgentCursor(request.args.tab_id, request.args.from_x, request.args.from_y);
        const points = interpolatePoints(
          request.args.from_x,
          request.args.from_y,
          request.args.to_x,
          request.args.to_y,
          8,
        );
        await this.requireDebugger().send(request.args.tab_id, 'Input.dispatchMouseEvent', {
          type: 'mouseMoved', x: request.args.from_x, y: request.args.from_y,
        });
        await this.requireDebugger().send(request.args.tab_id, 'Input.dispatchMouseEvent', {
          type: 'mousePressed', x: request.args.from_x, y: request.args.from_y, button: 'left', buttons: 1, clickCount: 1,
        });
        for (const point of points) {
          await this.showAgentCursor(request.args.tab_id, point.x, point.y);
          await this.requireDebugger().send(request.args.tab_id, 'Input.dispatchMouseEvent', {
            type: 'mouseMoved', x: point.x, y: point.y, button: 'left', buttons: 1,
          });
        }
        await this.requireDebugger().send(request.args.tab_id, 'Input.dispatchMouseEvent', {
          type: 'mouseReleased', x: request.args.to_x, y: request.args.to_y, button: 'left', buttons: 0, clickCount: 1,
        });
        return { tab_id: request.args.tab_id, performed: true };
      }
      case 'browser.scroll_at':
        await this.requireTabAccess(request.session_id, request.args.tab_id);
        await this.showAgentCursor(request.args.tab_id, request.args.x, request.args.y);
        await this.requireDebugger().send(request.args.tab_id, 'Input.dispatchMouseEvent', {
          type: 'mouseWheel',
          x: request.args.x,
          y: request.args.y,
          deltaX: request.args.delta_x,
          deltaY: request.args.delta_y,
        });
        return { tab_id: request.args.tab_id, performed: true };
      case 'browser.press_key':
        await this.requireTabAccess(request.session_id, request.args.tab_id);
        await this.requireDebugger().send(request.args.tab_id, 'Input.dispatchKeyEvent', {
          type: 'keyDown', key: request.args.key,
        });
        await this.requireDebugger().send(request.args.tab_id, 'Input.dispatchKeyEvent', {
          type: 'keyUp', key: request.args.key,
        });
        return { tab_id: request.args.tab_id, performed: true };
      case 'browser.type_text':
        await this.requireTabAccess(request.session_id, request.args.tab_id);
        await this.requireDebugger().send(request.args.tab_id, 'Input.insertText', { text: request.args.text });
        return { tab_id: request.args.tab_id, performed: true };
      case 'browser.handle_dialog':
        await this.requireTabAccess(request.session_id, request.args.tab_id);
        await this.requireDebugger().send(request.args.tab_id, 'Page.handleJavaScriptDialog', {
          accept: request.args.action === 'accept',
          ...(request.args.prompt_text === undefined ? {} : { promptText: request.args.prompt_text }),
        });
        return { tab_id: request.args.tab_id, performed: true };
      case 'browser.list_downloads':
        if (request.args.tab_id !== undefined) {
          await this.assertSessionAccess(request.session_id, request.args.tab_id);
        }
        return { downloads: await this.requireDownloads().list(request.args.tab_id) };
      case 'browser.wait_for_download':
        if (request.args.tab_id !== undefined) {
          await this.assertSessionAccess(request.session_id, request.args.tab_id);
        }
        return {
          download: await this.requireDownloads().wait(request.args.tab_id, request.args.timeout_ms ?? 30_000),
        };
      case 'browser.set_files':
        await this.assertSessionAccess(request.session_id, request.args.tab_id);
        return this.setFiles(request.args.tab_id, request.args.element_id, request.args.files);
      case 'browser.list_tabs':
        return { tabs: await this.tabs.list(request.args.window_id) };
      case 'browser.get_page':
        return { page: await this.getPage(request.args.tab_id, request.session_id) } satisfies GetPageResult;
      case 'browser.get_page_state':
        return { page: await this.getPage(request.args.tab_id, request.session_id) } satisfies GetPageResult;
      case 'browser.get_interactives':
        return this.getInteractives(request.args.tab_id, request.session_id);
      case 'browser.click': {
        await this.assertSessionAccess(request.session_id, request.args.tab_id);
        await this.tabs.get(request.args.tab_id);
        const result = await this.pageAgent.click(request.args.tab_id, request.args.element_id);
        return { action: { tab_id: request.args.tab_id, ...result } } satisfies ClickResult;
      }
      case 'browser.double_click': {
        await this.assertSessionAccess(request.session_id, request.args.tab_id);
        await this.tabs.get(request.args.tab_id);
        const result = await this.pageAgent.doubleClick(request.args.tab_id, request.args.element_id);
        return { action: { tab_id: request.args.tab_id, ...result } };
      }
      case 'browser.type': {
        await this.assertSessionAccess(request.session_id, request.args.tab_id);
        await this.tabs.get(request.args.tab_id);
        const result = await this.pageAgent.type(request.args.tab_id, request.args.element_id, request.args.text);
        return { action: { tab_id: request.args.tab_id, ...result } } satisfies TypeResult;
      }
      case 'browser.press': {
        await this.assertSessionAccess(request.session_id, request.args.tab_id);
        const result = await this.pageAgent.press(request.args.tab_id, request.args.element_id, request.args.key);
        return { action: { tab_id: request.args.tab_id, ...result } };
      }
      case 'browser.set_checked': {
        await this.assertSessionAccess(request.session_id, request.args.tab_id);
        const result = await this.pageAgent.setChecked(request.args.tab_id, request.args.element_id, request.args.checked);
        return { action: { tab_id: request.args.tab_id, ...result } };
      }
      case 'browser.select_option': {
        await this.assertSessionAccess(request.session_id, request.args.tab_id);
        const result = await this.pageAgent.selectOption(request.args.tab_id, request.args.element_id, request.args.values);
        return { action: { tab_id: request.args.tab_id, ...result } };
      }
      case 'browser.drag': {
        await this.assertSessionAccess(request.session_id, request.args.tab_id);
        const result = await this.pageAgent.drag(
          request.args.tab_id,
          request.args.source_element_id,
          request.args.target_element_id,
        );
        return { action: { tab_id: request.args.tab_id, ...result } };
      }
      case 'browser.wait_for_element': {
        await this.assertSessionAccess(request.session_id, request.args.tab_id);
        const result = await this.pageAgent.waitForElement(
          request.args.tab_id,
          request.args.element_id,
          request.args.state,
          request.args.timeout_ms ?? 5_000,
        );
        return { action: { tab_id: request.args.tab_id, ...result } };
      }
      case 'browser.scroll': {
        await this.assertSessionAccess(request.session_id, request.args.tab_id);
        await this.tabs.get(request.args.tab_id);
        const result = await this.pageAgent.scroll(request.args.tab_id, request.args.delta_x, request.args.delta_y);
        return { scroll: { tab_id: request.args.tab_id, ...result } } satisfies ScrollResult;
      }
      case 'browser.screenshot':
        await this.assertSessionAccess(request.session_id, request.args.tab_id);
        return this.captureScreenshot(request.args);
      case 'browser.observe':
        await this.assertSessionAccess(request.session_id, request.args.tab_id);
        return this.observe(request.args);
      case 'browser.switch_tab':
        await this.assertSessionAccess(request.session_id, request.args.tab_id);
        return { tab: await this.tabs.activate(request.args.tab_id) };
      case 'browser.open': {
        if (request.args.tab_id !== undefined) await this.assertSessionAccess(request.session_id, request.args.tab_id);
        const tab = await this.open(request.args);
        if (request.session_id !== undefined) {
          await this.requireSessions().claim(
            request.session_id,
            request.turn_id,
            tab.tab_id,
            'agent',
            request.args.tab_id === undefined,
          );
        }
        return { tab } satisfies OpenResult;
      }
    }
  }

  private async captureScreenshot(args: ScreenshotArgs): Promise<ScreenshotResult> {
    const tab = await this.tabs.get(args.tab_id);
    const before = await this.pageAgent.getState(tab.tab_id);
    const captured = await this.screenshots.capture(tab, args.image_format ?? 'png', {
      ...(args.full_page === undefined ? {} : { fullPage: args.full_page }),
      ...(args.clip === undefined ? {} : { clip: args.clip }),
    });
    const currentTab = await this.tabs.get(tab.tab_id);
    if (!currentTab.active) {
      throw new ToolFailure(createToolError('screenshot_unavailable', 'The active tab changed during capture.', true));
    }
    const after = await this.pageAgent.getState(tab.tab_id);
    if (before.page_revision !== after.page_revision) {
      throw new ToolFailure(
        createToolError('screenshot_unavailable', 'The page changed during screenshot capture.', true, {
          before_revision: before.page_revision,
          after_revision: after.page_revision,
        }),
      );
    }
    return {
      screenshot: {
        tab_id: tab.tab_id,
        page_revision: after.page_revision,
        width: captured.width,
        height: captured.height,
        mime_type: captured.mimeType,
        image_data: captured.imageData,
      },
    };
  }

  private async observe(args: ScreenshotArgs & { include?: Array<'page_state' | 'interactives' | 'screenshot' | 'accessibility'> }): Promise<ObserveResult> {
    const include = new Set(args.include ?? ['page_state', 'interactives', 'screenshot', 'accessibility']);
    const before = await this.getPage(args.tab_id);
    const observation: ObserveResult['observation'] = {
      tab_id: args.tab_id,
      page_revision: before.page_revision,
    };
    if (include.has('page_state')) observation.page = before;
    if (include.has('interactives')) observation.snapshot = (await this.getInteractives(args.tab_id)).snapshot;
    if (include.has('accessibility')) {
      const value = await this.requireDebugger().send(args.tab_id, 'Accessibility.getFullAXTree');
      observation.accessibility_nodes = getArray(value, 'nodes');
    }
    if (include.has('screenshot')) observation.screenshot = (await this.captureScreenshot(args)).screenshot;
    const after = await this.getPage(args.tab_id);
    if (after.page_revision !== before.page_revision) {
      throw new ToolFailure(createToolError('stale_element', 'Page changed while creating the observation.', true, {
        before_revision: before.page_revision,
        after_revision: after.page_revision,
      }));
    }
    return { observation };
  }

  private async getInteractives(tabId?: number, sessionId?: string): Promise<GetInteractivesResult> {
    const tab = tabId === undefined ? await this.tabs.getActive() : await this.tabs.get(tabId);
    await this.assertSessionAccess(sessionId, tab.tab_id);
    const snapshot = await this.pageAgent.getInteractives(tab.tab_id);
    return {
      snapshot: {
        tab_id: tab.tab_id,
        ...snapshot,
      },
    };
  }

  private async getPage(tabId?: number, sessionId?: string): Promise<PageState> {
    const tab = tabId === undefined ? await this.tabs.getActive() : await this.tabs.get(tabId);
    await this.assertSessionAccess(sessionId, tab.tab_id);
    const agentState = await this.pageAgent.getState(tab.tab_id);
    return {
      tab_id: tab.tab_id,
      url: tab.url || agentState.url,
      title: tab.title || agentState.title,
      loading: tab.status === 'loading' ? 'loading' : agentState.document_ready_state === 'complete' ? 'complete' : 'loading',
      viewport: agentState.viewport,
      page_revision: agentState.page_revision,
      revision_reason: agentState.revision_reason,
    };
  }

  private async open(args: OpenArgs): Promise<TabInfo> {
    let parsedUrl: URL;
    try {
      parsedUrl = new URL(args.url);
    } catch {
      throw new ToolFailure(createToolError('invalid_url', 'URL must be an absolute http or https URL.', false));
    }
    if (parsedUrl.protocol !== 'http:' && parsedUrl.protocol !== 'https:') {
      throw new ToolFailure(createToolError('invalid_url', 'Only http and https URLs are supported.', false));
    }
    return this.tabs.open(args);
  }

  private async setFiles(tabId: number, elementId: string, files: string[]): Promise<ToolResults['browser.set_files']> {
    await this.tabs.get(tabId);
    const prepared = await this.pageAgent.prepareFileInput(tabId, elementId);
    try {
      const documentResult = await this.requireDebugger().send(tabId, 'DOM.getDocument', { depth: 0, pierce: false });
      const rootNodeId = getNestedNumber(documentResult, 'root', 'nodeId');
      if (rootNodeId === undefined) {
        throw new ToolFailure(createToolError('file_upload_failed', 'CDP did not return the document root.', true));
      }
      const queryResult = await this.requireDebugger().send(tabId, 'DOM.querySelector', {
        nodeId: rootNodeId,
        selector: `input[type="file"][data-browser-control-file-input="${prepared.marker}"]`,
      });
      const fileInputNodeId = getNumber(queryResult, 'nodeId');
      if (fileInputNodeId === undefined || fileInputNodeId === 0) {
        throw new ToolFailure(createToolError('stale_element', 'The file input is no longer attached to the page.', true));
      }
      await this.requireDebugger().send(tabId, 'DOM.setFileInputFiles', {
        nodeId: fileInputNodeId,
        files,
      });
      const state = await this.pageAgent.getState(tabId);
      return {
        tab_id: tabId,
        page_revision: state.page_revision,
        file_count: files.length,
        files_set: true as const,
        needs_interactives_refresh: true,
      };
    } catch (error: unknown) {
      if (error instanceof ToolFailure &&
        (error.toolError.code === 'stale_element' || error.toolError.code === 'element_not_found' ||
          error.toolError.code === 'element_disabled' || error.toolError.code === 'element_not_editable')) {
        throw error;
      }
      throw new ToolFailure(createToolError('file_upload_failed', 'Chrome could not set files on the input.', false, {
        cause: toToolError(error).message,
      }));
    } finally {
      await this.pageAgent.clearFileInputMarker(tabId, prepared.marker).catch(() => undefined);
    }
  }

  private requireSessions(): SessionCoordinator {
    if (this.sessions === undefined) {
      throw new ToolFailure(createToolError('internal_error', 'Browser session management is unavailable.', false));
    }
    return this.sessions;
  }

  private async assertSessionAccess(sessionId: string | undefined, tabId: number): Promise<void> {
    if (this.sessions !== undefined) await this.sessions.assertAccess(sessionId, tabId);
  }

  private async requireTabAccess(sessionId: string | undefined, tabId: number): Promise<void> {
    await this.tabs.get(tabId);
    await this.assertSessionAccess(sessionId, tabId);
  }

  private requireDebugger(): DebuggerAdapter {
    if (this.debuggerAdapter === undefined) {
      throw new ToolFailure(createToolError('debugger_unavailable', 'Chrome debugger integration is unavailable.', false));
    }
    return this.debuggerAdapter;
  }

  private requireDownloads(): DownloadAdapter {
    if (this.downloads === undefined) {
      throw new ToolFailure(createToolError('download_failed', 'Chrome download integration is unavailable.', false));
    }
    return this.downloads;
  }

  private async showAgentCursor(tabId: number, x: number, y: number): Promise<void> {
    await this.pageAgent.showAgentCursor(tabId, x, y).catch(() => undefined);
  }
}

function getArray(value: unknown, key: string): unknown[] {
  if (typeof value !== 'object' || value === null) return [];
  const field = (value as Record<string, unknown>)[key];
  return Array.isArray(field) ? field : [];
}

function getNumber(value: unknown, key: string): number | undefined {
  if (typeof value !== 'object' || value === null) return undefined;
  const field = (value as Record<string, unknown>)[key];
  return typeof field === 'number' ? field : undefined;
}

function getNestedNumber(value: unknown, objectKey: string, numberKey: string): number | undefined {
  if (typeof value !== 'object' || value === null) return undefined;
  return getNumber((value as Record<string, unknown>)[objectKey], numberKey);
}

function interpolatePoints(fromX: number, fromY: number, toX: number, toY: number, steps: number): Array<{ x: number; y: number }> {
  return Array.from({ length: steps }, (_, index) => {
    const progress = (index + 1) / steps;
    return { x: fromX + (toX - fromX) * progress, y: fromY + (toY - fromY) * progress };
  });
}
