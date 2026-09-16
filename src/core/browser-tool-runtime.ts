import { createToolError, ToolFailure, toToolError } from './protocol/errors';
import type {
  ClickResult,
  GetPageResult,
  GetInteractivesResult,
  InteractiveFilterArgs,
  OpenArgs,
  OpenResult,
  PageState,
  ScrollResult,
  ScreenshotArgs,
  ScreenshotResult,
  SelectTextResult,
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
import { TOP_FRAME_ID } from './protocol/tool-contract';
import type { PageAgentClient } from '../chrome/scripting-adapter';
import type { TabsAdapter } from '../chrome/tabs-adapter';
import type { ScreenshotAdapter } from '../chrome/screenshot-adapter';
import type { DownloadAdapter } from '../chrome/download-adapter';
import type { FrameAdapter } from '../chrome/frames-adapter';
import type { ConsoleEntry, GetConsoleMessagesArgs, GetConsoleMessagesResult } from './protocol/tool-contract';

export class BrowserToolRuntime {
  public constructor(
    private readonly tabs: TabsAdapter,
    private readonly pageAgent: PageAgentClient,
    private readonly screenshots: ScreenshotAdapter,
    private readonly sessions?: SessionCoordinator,
    private readonly debuggerAdapter?: DebuggerAdapter,
    private readonly downloads?: DownloadAdapter,
    private readonly frames?: FrameAdapter,
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
      case 'browser.start_session':
        return { session: await this.requireSessions().start(request.args.session_id, request.args.name) };
      case 'browser.claim_tab':
        return {
          session: await this.requireSessions().claim(
            request.args.session_id,
            request.turn_id,
            request.args.tab_id,
            'user',
            // Claiming is a handover, so the tab joins the session's group by default: that is how the
            // user can see which conversation owns which tab. Pass group: false to leave the tab bar alone.
            request.args.group ?? true,
          ),
        };
      case 'browser.reset_sessions': {
        const reset = await this.requireSessions().reset(request.session_id, request.args.force ?? false);
        return {
          released_tab_ids: reset.releasedTabIds,
          session_count: reset.sessionCount,
          other_sessions_kept: reset.otherSessionsKept,
        };
      }
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
      case 'browser.get_console_messages': {
        await this.requireTabAccess(request.session_id, request.args.tab_id);
        const collected = await this.pageAgent.getConsoleMessages(request.args.tab_id, request.args.frame_id ?? TOP_FRAME_ID);
        return { tab_id: request.args.tab_id, ...selectConsoleMessages(collected, request.args) };
      }
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
        return this.setFiles(
          request.args.tab_id,
          request.args.frame_id ?? TOP_FRAME_ID,
          request.args.element_id,
          request.args.files,
        );
      case 'browser.list_tabs': {
        const tabs = await this.tabs.list(request.args.window_id);
        // A conversation only sees its own tabs plus unclaimed ones, so it cannot even aim at another
        // conversation's page by accident. include_all is the deliberate escape for scripts.
        if (request.args.include_all === true || this.sessions === undefined) return { tabs };
        const owners = await this.sessions.listLeases();
        const visible = tabs.filter((tab) => {
          const owner = owners.get(tab.tab_id);
          return owner === undefined || owner === request.session_id;
        });
        const otherSessionTabs = tabs.length - visible.length;
        return { tabs: visible, ...(otherSessionTabs === 0 ? {} : { other_session_tabs: otherSessionTabs }) };
      }
      case 'browser.get_frames':
        return this.getFrames(request.args.tab_id, request.session_id);
      case 'browser.get_page':
        return { page: await this.getPage(request.args.tab_id, request.args.frame_id, request.session_id) } satisfies GetPageResult;
      case 'browser.get_interactives':
        return this.getInteractives(request.args.tab_id, request.args.frame_id, request.args, request.session_id);
      case 'browser.get_page_content': {
        // Checked first so a closed tab reports tab_not_found instead of a Page Agent failure.
        await this.requireTabAccess(request.session_id, request.args.tab_id);
        if (!this.pageAgent.getPageContent) throw new ToolFailure(createToolError('invalid_request', 'Page content extraction is unavailable.', false));
        const frameId = request.args.frame_id ?? TOP_FRAME_ID;
        const result = await this.pageAgent.getPageContent(request.args.tab_id, frameId, {
          include_html: request.args.include_html ?? false,
          include_images: request.args.include_images ?? true,
          include_frames: request.args.include_frames ?? true,
          max_text_length: request.args.max_text_length ?? 50_000,
        });
        return { ...result, tab_id: request.args.tab_id, frame_id: frameId };
      }
      case 'browser.click': {
        await this.assertSessionAccess(request.session_id, request.args.tab_id);
        await this.tabs.get(request.args.tab_id);
        const result = await this.pageAgent.click(
          request.args.tab_id,
          request.args.frame_id ?? TOP_FRAME_ID,
          request.args.element_id,
          request.args.modifiers ?? [],
        );
        return { action: { tab_id: request.args.tab_id, ...result } } satisfies ClickResult;
      }
      case 'browser.double_click': {
        await this.assertSessionAccess(request.session_id, request.args.tab_id);
        await this.tabs.get(request.args.tab_id);
        const result = await this.pageAgent.doubleClick(
          request.args.tab_id,
          request.args.frame_id ?? TOP_FRAME_ID,
          request.args.element_id,
          request.args.modifiers ?? [],
        );
        return { action: { tab_id: request.args.tab_id, ...result } };
      }
      case 'browser.type': {
        await this.assertSessionAccess(request.session_id, request.args.tab_id);
        await this.tabs.get(request.args.tab_id);
        const result = await this.pageAgent.type(
          request.args.tab_id,
          request.args.frame_id ?? TOP_FRAME_ID,
          request.args.element_id,
          request.args.text,
        );
        return { action: { tab_id: request.args.tab_id, ...result } } satisfies TypeResult;
      }
      case 'browser.press': {
        await this.assertSessionAccess(request.session_id, request.args.tab_id);
        const result = await this.pageAgent.press(
          request.args.tab_id,
          request.args.frame_id ?? TOP_FRAME_ID,
          request.args.element_id,
          request.args.key,
          request.args.modifiers ?? [],
        );
        return { action: { tab_id: request.args.tab_id, ...result } };
      }
      case 'browser.select_text': {
        await this.assertSessionAccess(request.session_id, request.args.tab_id);
        const selectText = this.pageAgent.selectText?.bind(this.pageAgent);
        if (selectText === undefined) {
          throw new ToolFailure(createToolError('invalid_request', 'Text selection is unavailable.', false));
        }
        const result = await selectText(
          request.args.tab_id,
          request.args.frame_id ?? TOP_FRAME_ID,
          request.args.element_id,
          request.args.text,
          request.args.selection_type ?? 'text',
        );
        return { action: { tab_id: request.args.tab_id, ...result } } satisfies SelectTextResult;
      }
      case 'browser.set_checked': {
        await this.assertSessionAccess(request.session_id, request.args.tab_id);
        const result = await this.pageAgent.setChecked(
          request.args.tab_id,
          request.args.frame_id ?? TOP_FRAME_ID,
          request.args.element_id,
          request.args.checked,
        );
        return { action: { tab_id: request.args.tab_id, ...result } };
      }
      case 'browser.select_option': {
        await this.assertSessionAccess(request.session_id, request.args.tab_id);
        const result = await this.pageAgent.selectOption(
          request.args.tab_id,
          request.args.frame_id ?? TOP_FRAME_ID,
          request.args.element_id,
          request.args.values,
        );
        return { action: { tab_id: request.args.tab_id, ...result } };
      }
      case 'browser.drag': {
        await this.assertSessionAccess(request.session_id, request.args.tab_id);
        const result = await this.pageAgent.drag(
          request.args.tab_id,
          request.args.frame_id ?? TOP_FRAME_ID,
          request.args.source_element_id,
          request.args.target_element_id,
        );
        return { action: { tab_id: request.args.tab_id, ...result } };
      }
      case 'browser.wait_for_element': {
        await this.assertSessionAccess(request.session_id, request.args.tab_id);
        const result = await this.pageAgent.waitForElement(
          request.args.tab_id,
          request.args.frame_id ?? TOP_FRAME_ID,
          request.args.element_id,
          request.args.state,
          request.args.timeout_ms ?? 5_000,
        );
        return { action: { tab_id: request.args.tab_id, ...result } };
      }
      case 'browser.scroll': {
        await this.assertSessionAccess(request.session_id, request.args.tab_id);
        await this.tabs.get(request.args.tab_id);
        const result = await this.pageAgent.scroll(request.args.tab_id, TOP_FRAME_ID, request.args.delta_x, request.args.delta_y);
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
          try {
            // New tabs always join the group. A tab this call merely navigated is claimed without being
            // grouped, so driving an existing page does not rearrange the user's tab bar.
            await this.requireSessions().claim(
              request.session_id,
              request.turn_id,
              tab.tab_id,
              'agent',
              request.args.tab_id === undefined,
            );
          } catch (error: unknown) {
            // The ownership step can fail (a session that no longer exists, a tab already leased), and
            // it must not leave a tab behind. Only close what this call created.
            if (request.args.tab_id === undefined) await this.tabs.close(tab.tab_id).catch(() => undefined);
            throw error;
          }
        }
        return { tab } satisfies OpenResult;
      }
    }
  }

  private async captureScreenshot(args: ScreenshotArgs): Promise<ScreenshotResult> {
    const tab = await this.tabs.get(args.tab_id);
    const before = await this.pageAgent.getState(tab.tab_id, TOP_FRAME_ID);
    const captured = await this.screenshots.capture(tab, args.image_format ?? 'png', {
      ...(args.full_page === undefined ? {} : { fullPage: args.full_page }),
      ...(args.clip === undefined ? {} : { clip: args.clip }),
    });
    const after = await this.pageAgent.getState(tab.tab_id, TOP_FRAME_ID);
    // Live pages (animations, clocks, hot reload, polling) change during every capture. Failing there
    // made the tool unusable, so the image is returned and flagged instead; an unchanged page omits both.
    const changed = before.page_revision !== after.page_revision;
    return {
      screenshot: {
        tab_id: tab.tab_id,
        page_revision: after.page_revision,
        ...(changed ? { page_changed: true, page_revision_before: before.page_revision } : {}),
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
    if (include.has('interactives')) observation.snapshot = (await this.getInteractives(args.tab_id, undefined, {}, undefined)).snapshot;
    if (include.has('accessibility')) {
      const value = await this.requireDebugger().send(args.tab_id, 'Accessibility.getFullAXTree');
      observation.accessibility_nodes = getArray(value, 'nodes');
    }
    if (include.has('screenshot')) observation.screenshot = (await this.captureScreenshot(args)).screenshot;
    const after = await this.getPage(args.tab_id);
    // Same reasoning as captureScreenshot: report a mixed observation instead of discarding it.
    if (after.page_revision !== before.page_revision) {
      observation.page_changed = true;
      observation.page_revision_after = after.page_revision;
    }
    return { observation };
  }

  private async getFrames(tabId?: number, sessionId?: string): Promise<ToolResults['browser.get_frames']> {
    const tab = tabId === undefined ? await this.tabs.getActive() : await this.tabs.get(tabId);
    await this.assertSessionAccess(sessionId, tab.tab_id);
    return { tab_id: tab.tab_id, frames: await this.requireFrames().list(tab.tab_id) };
  }

  private async getInteractives(
    tabId?: number,
    frameId?: number,
    filter: InteractiveFilterArgs = {},
    sessionId?: string,
  ): Promise<GetInteractivesResult> {
    const tab = tabId === undefined ? await this.tabs.getActive() : await this.tabs.get(tabId);
    await this.assertSessionAccess(sessionId, tab.tab_id);
    const resolvedFrameId = frameId ?? TOP_FRAME_ID;
    const snapshot = await this.pageAgent.getInteractives(tab.tab_id, resolvedFrameId, filter);
    return {
      snapshot: {
        tab_id: tab.tab_id,
        frame_id: resolvedFrameId,
        ...snapshot,
        truncated: snapshot.elements.length < snapshot.total,
      },
    };
  }

  private async getPage(tabId?: number, frameId?: number, sessionId?: string): Promise<PageState> {
    const tab = tabId === undefined ? await this.tabs.getActive() : await this.tabs.get(tabId);
    await this.assertSessionAccess(sessionId, tab.tab_id);
    const resolvedFrameId = frameId ?? TOP_FRAME_ID;
    const agentState = await this.pageAgent.getState(tab.tab_id, resolvedFrameId);
    // A frame owns its own URL and title; only the top document can borrow the tab's metadata.
    const isTopFrame = resolvedFrameId === TOP_FRAME_ID;
    return {
      tab_id: tab.tab_id,
      frame_id: resolvedFrameId,
      url: (isTopFrame ? tab.url : '') || agentState.url,
      title: (isTopFrame ? tab.title : '') || agentState.title,
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

  private async setFiles(
    tabId: number,
    frameId: number,
    elementId: string,
    files: string[],
  ): Promise<ToolResults['browser.set_files']> {
    await this.tabs.get(tabId);
    const prepared = await this.pageAgent.prepareFileInput(tabId, frameId, elementId);
    try {
      const fileInputNodeId = await this.findFileInputNodeId(tabId, frameId, prepared.marker);
      await this.requireDebugger().send(tabId, 'DOM.setFileInputFiles', {
        nodeId: fileInputNodeId,
        files,
      });
      const state = await this.pageAgent.getState(tabId, frameId);
      return {
        tab_id: tabId,
        frame_id: frameId,
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
      await this.pageAgent.clearFileInputMarker(tabId, frameId, prepared.marker).catch(() => undefined);
    }
  }

  /**
   * Finds the marked file input. The top document can be queried directly; a frame that is not the
   * top document needs a pierced node tree, because `DOM.querySelector` does not cross into child
   * documents.
   */
  private async findFileInputNodeId(tabId: number, frameId: number, marker: string): Promise<number> {
    const selector = `input[type="file"][data-browser-control-file-input="${marker}"]`;
    if (frameId === TOP_FRAME_ID) {
      const documentResult = await this.requireDebugger().send(tabId, 'DOM.getDocument', { depth: 0, pierce: false });
      const rootNodeId = getNestedNumber(documentResult, 'root', 'nodeId');
      if (rootNodeId === undefined) {
        throw new ToolFailure(createToolError('file_upload_failed', 'CDP did not return the document root.', true));
      }
      const queryResult = await this.requireDebugger().send(tabId, 'DOM.querySelector', { nodeId: rootNodeId, selector });
      const nodeId = getNumber(queryResult, 'nodeId');
      if (nodeId === undefined || nodeId === 0) {
        throw new ToolFailure(createToolError('stale_element', 'The file input is no longer attached to the page.', true));
      }
      return nodeId;
    }

    const documentResult = await this.requireDebugger().send(tabId, 'DOM.getDocument', { depth: -1, pierce: true });
    const nodeId = findNodeIdByAttribute(documentResult, 'data-browser-control-file-input', marker);
    if (nodeId === null) {
      throw new ToolFailure(createToolError('stale_element', 'The file input is no longer attached to the page.', true, {
        tab_id: tabId,
        frame_id: frameId,
      }));
    }
    return nodeId;
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

  private requireFrames(): FrameAdapter {
    if (this.frames === undefined) {
      throw new ToolFailure(createToolError('internal_error', 'Frame enumeration is unavailable.', false));
    }
    return this.frames;
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
}

function findNodeIdByAttribute(value: unknown, attributeName: string, attributeValue: string): number | null {
  const root = readRecord(value, 'root');
  if (root === null) return null;
  const queue: Array<Record<string, unknown>> = [root];
  while (queue.length > 0) {
    const node = queue.shift() as Record<string, unknown>;
    if (hasAttributePair(node, attributeName, attributeValue)) {
      const nodeId = node['nodeId'];
      if (typeof nodeId === 'number' && nodeId > 0) return nodeId;
    }
    const children = node['children'];
    if (Array.isArray(children)) {
      for (const child of children) {
        const record = readRecordValue(child);
        if (record !== null) queue.push(record);
      }
    }
    // Pierced node trees keep a frame's document under contentDocument.
    const contentDocument = readRecord(node, 'contentDocument');
    if (contentDocument !== null) queue.push(contentDocument);
  }
  return null;
}

function hasAttributePair(node: Record<string, unknown>, attributeName: string, attributeValue: string): boolean {
  const attributes = node['attributes'];
  if (!Array.isArray(attributes)) return false;
  for (let index = 0; index + 1 < attributes.length; index += 2) {
    if (attributes[index] === attributeName && attributes[index + 1] === attributeValue) return true;
  }
  return false;
}

function readRecord(value: unknown, key: string): Record<string, unknown> | null {
  return readRecordValue((value as Record<string, unknown> | null)?.[key]);
}

function readRecordValue(value: unknown): Record<string, unknown> | null {
  return typeof value === 'object' && value !== null ? value as Record<string, unknown> : null;
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

function selectConsoleMessages(
  collected: { available: boolean; entries: ConsoleEntry[]; dropped: number },
  args: GetConsoleMessagesArgs,
): Omit<GetConsoleMessagesResult, 'tab_id'> {
  const afterSequence = args.after_sequence ?? 0;
  const earliest = collected.entries[0]?.sequence ?? 0;
  const filtered = collected.entries.filter((entry) =>
    entry.sequence > afterSequence && (args.levels === undefined || args.levels.includes(entry.level)));
  const entries = filtered.slice(0, Math.min(args.limit ?? 100, 500));
  return {
    available: collected.available,
    cursor: entries.at(-1)?.sequence ?? afterSequence,
    entries,
    has_more: filtered.length > entries.length,
    // The page keeps a bounded buffer, so an old cursor means messages were dropped in between.
    truncated: afterSequence > 0 && earliest > 0 && afterSequence < earliest - 1,
    dropped: collected.dropped,
  };
}
