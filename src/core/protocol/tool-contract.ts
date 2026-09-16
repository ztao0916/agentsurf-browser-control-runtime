import type { ToolError } from './errors';

export const PROTOCOL_VERSION = '1' as const;

/** Chrome gives the top document frame ID 0; every other frame is addressed by its own ID. */
export const TOP_FRAME_ID = 0;

export type ToolName =
  | 'browser.start_session'
  | 'browser.claim_tab'
  | 'browser.reset_sessions'
  | 'browser.close_tab'
  | 'browser.back'
  | 'browser.forward'
  | 'browser.reload'
  | 'browser.get_console_messages'
  | 'browser.list_downloads'
  | 'browser.wait_for_download'
  | 'browser.set_files'
  | 'browser.list_tabs'
  | 'browser.get_frames'
  | 'browser.get_page'
  | 'browser.get_interactives'
  | 'browser.get_page_content'
  | 'browser.click'
  | 'browser.double_click'
  | 'browser.type'
  | 'browser.press'
  | 'browser.set_checked'
  | 'browser.select_option'
  | 'browser.drag'
  | 'browser.wait_for_element'
  | 'browser.scroll'
  | 'browser.screenshot'
  | 'browser.observe'
  | 'browser.switch_tab'
  | 'browser.open'
  | 'browser.select_text'
  | 'browser.handle_dialog';

export type LoadingStatus = 'loading' | 'complete' | 'unknown';
export type PageRevisionReason = 'navigation' | 'refresh' | 'important_dom';
export type ImageFormat = 'png' | 'jpeg';

export interface ViewportState {
  width: number;
  height: number;
  device_pixel_ratio: number;
  scroll_x: number;
  scroll_y: number;
}

export interface TabInfo {
  tab_id: number;
  window_id: number;
  url: string;
  title: string;
  active: boolean;
  status: LoadingStatus;
  incognito: boolean;
  group_id: number | null;
}

/**
 * A frame inside a tab. `frame_id` is Chrome's frame ID: 0 is the top document, and every other
 * frame belongs to the document that hosts it. A frame that navigates keeps its ID only while it
 * stays in the same process, so callers should treat `frame_not_found` as retryable and re-read the
 * frame list.
 */
export interface FrameInfo {
  frame_id: number;
  parent_frame_id: number | null;
  url: string;
  is_top: boolean;
}

export interface BrowserSessionInfo {
  session_id: string;
  name: string | null;
  tab_ids: number[];
  group_id: number | null;
}

/**
 * Only the MCP server sends this, to give each conversation its own session before the first real
 * call. It stays in the protocol but is not advertised as a tool.
 */
export interface StartSessionArgs {
  session_id?: string;
  name?: string;
}

export interface ClaimTabArgs {
  /** Defaults to the session at the request root, which is the one the MCP server always sets. */
  session_id?: string;
  tab_id: number;
  group?: boolean;
  /** Names the session's tab group after the conversation, overriding the page-derived title. */
  name?: string;
}

export interface ResetSessionsArgs {
  /** Release every session, including tabs another conversation still holds. Default false. */
  force?: boolean;
  /**
   * Close the tabs this conversation opened itself, so a finished task leaves nothing behind. Tabs
   * the user already had open are never closed. Default true.
   */
  close_opened_tabs?: boolean;
}

export interface ResetSessionsResult {
  released_tab_ids: number[];
  /** Subset of `released_tab_ids`: the tabs opened by this conversation and closed by this call. */
  closed_tab_ids: number[];
  session_count: number;
  /** Sessions left alone because they belong to other conversations. */
  other_sessions_kept: number;
}

export interface TabTargetArgs {
  tab_id: number;
}

export interface GetConsoleMessagesArgs extends TabTargetArgs {
  after_sequence?: number;
  limit?: number;
  levels?: ConsoleLevel[];
  frame_id?: number;
}

export type KeyModifier = 'Alt' | 'Control' | 'Meta' | 'Shift';

export interface HandleDialogArgs extends TabTargetArgs {
  action: 'accept' | 'dismiss';
  prompt_text?: string;
}

export interface ListDownloadsArgs {
  tab_id?: number;
}

export interface WaitForDownloadArgs {
  tab_id?: number;
  timeout_ms?: number;
}

export interface SetFilesArgs extends ClickArgs {
  files: string[];
}

export interface PageState {
  tab_id: number;
  frame_id: number;
  url: string;
  title: string;
  loading: LoadingStatus;
  viewport: ViewportState;
  page_revision: string;
  revision_reason: PageRevisionReason;
}

export type ValueState = 'empty' | 'filled' | 'redacted' | 'not_applicable';

export interface ElementBounds {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface InteractiveElement {
  element_id: string;
  role: string;
  tag: string;
  name: string;
  text: string;
  input_type: string | null;
  placeholder: string | null;
  value_state: ValueState;
  checked: boolean | null;
  selected: boolean | null;
  disabled: boolean;
  visible: boolean;
  bounds: ElementBounds;
}

export interface InteractiveSnapshot {
  tab_id: number;
  frame_id: number;
  page_revision: string;
  snapshot_id: string;
  /** Elements that matched the filters before the limit was applied. */
  total: number;
  /** True when the limit hid part of the match, so the caller knows the list is incomplete. */
  truncated: boolean;
  elements: InteractiveElement[];
}

export interface ListTabsArgs {
  window_id?: number;
  /** Include tabs another session holds. Default false, so a conversation only sees its own. */
  include_all?: boolean;
}

export interface GetPageArgs {
  tab_id?: number;
  frame_id?: number;
}

export interface GetInteractivesArgs extends InteractiveFilterArgs {
  tab_id?: number;
  frame_id?: number;
}

/**
 * A full snapshot of a heavy application can reach hundreds of elements (measured: 665 elements,
 * 245 KB of JSON on one page), which costs more context than any model should spend on a lookup.
 * The filters and the limit are applied inside the page, before anything crosses the message
 * boundary.
 */
export interface InteractiveFilterArgs {
  /** Maximum elements returned. Defaults to {@link DEFAULT_INTERACTIVE_LIMIT}. */
  limit?: number;
  /** Drop elements reported as not visible. */
  visible_only?: boolean;
  /** Keep one tag, for example `button` or `input`. */
  tag?: string;
  /** Keep one role, for example `tab` or `combobox`. */
  role?: string;
  /** Case-insensitive substring of the accessible name or the element text. */
  name_contains?: string;
}

/** 150 keeps every measured application page intact while capping the outliers. */
export const DEFAULT_INTERACTIVE_LIMIT = 150;

export interface GetPageContentArgs {
  tab_id: number;
  frame_id?: number;
  include_html?: boolean;
  include_images?: boolean;
  include_frames?: boolean;
  max_text_length?: number;
}

export interface ClickArgs {
  tab_id: number;
  element_id: string;
  frame_id?: number;
}

export interface ClickWithModifiersArgs extends ClickArgs {
  modifiers?: KeyModifier[];
}

export interface TypeArgs extends ClickArgs {
  text: string;
}

export interface PressArgs extends ClickArgs {
  key: string;
  modifiers?: KeyModifier[];
}

export interface SelectTextArgs extends ClickArgs {
  text?: string;
  selection_type?: 'text' | 'cursor_before' | 'cursor_after';
}

export interface SetCheckedArgs extends ClickArgs {
  checked: boolean;
}

export interface SelectOptionArgs extends ClickArgs {
  values: string[];
}

export interface DragArgs {
  tab_id: number;
  frame_id?: number;
  source_element_id: string;
  target_element_id: string;
}

export interface WaitForElementArgs extends ClickArgs {
  state: 'attached' | 'detached' | 'visible' | 'hidden';
  timeout_ms?: number;
}

export interface ScrollArgs {
  tab_id: number;
  delta_x: number;
  delta_y: number;
}

export interface ScreenshotArgs {
  tab_id: number;
  image_format?: ImageFormat;
  full_page?: boolean;
  clip?: ScreenshotClip;
}

export interface ScreenshotClip {
  x: number;
  y: number;
  width: number;
  height: number;
  scale?: number;
}

export type ObservationContent = 'page_state' | 'interactives' | 'screenshot' | 'accessibility';

export interface ObserveArgs extends ScreenshotArgs {
  include?: ObservationContent[];
}

export interface SwitchTabArgs {
  tab_id: number;
}

export interface OpenArgs {
  url: string;
  tab_id?: number;
  activate?: boolean;
  /** Names the session's tab group after the conversation, overriding the page-derived title. */
  name?: string;
}

export interface ToolArguments {
  'browser.start_session': StartSessionArgs;
  'browser.claim_tab': ClaimTabArgs;
  'browser.reset_sessions': ResetSessionsArgs;
  'browser.close_tab': TabTargetArgs;
  'browser.back': TabTargetArgs;
  'browser.forward': TabTargetArgs;
  'browser.reload': TabTargetArgs;
  'browser.get_console_messages': GetConsoleMessagesArgs;
  'browser.select_text': SelectTextArgs;
  'browser.handle_dialog': HandleDialogArgs;
  'browser.list_downloads': ListDownloadsArgs;
  'browser.wait_for_download': WaitForDownloadArgs;
  'browser.set_files': SetFilesArgs;
  'browser.list_tabs': ListTabsArgs;
  'browser.get_frames': TabTargetArgs;
  'browser.get_page': GetPageArgs;
  'browser.get_interactives': GetInteractivesArgs;
  'browser.get_page_content': GetPageContentArgs;
  'browser.click': ClickWithModifiersArgs;
  'browser.double_click': ClickWithModifiersArgs;
  'browser.type': TypeArgs;
  'browser.press': PressArgs;
  'browser.set_checked': SetCheckedArgs;
  'browser.select_option': SelectOptionArgs;
  'browser.drag': DragArgs;
  'browser.wait_for_element': WaitForElementArgs;
  'browser.scroll': ScrollArgs;
  'browser.screenshot': ScreenshotArgs;
  'browser.observe': ObserveArgs;
  'browser.switch_tab': SwitchTabArgs;
  'browser.open': OpenArgs;
}

export interface ListTabsResult {
  tabs: TabInfo[];
  /** How many tabs were left out because another session holds them. */
  other_session_tabs?: number;
}

export interface GetFramesResult {
  tab_id: number;
  frames: FrameInfo[];
}

export interface BrowserSessionResult {
  session: BrowserSessionInfo;
}

export interface CloseTabResult {
  tab_id: number;
  closed: true;
}

export type ConsoleLevel = 'log' | 'info' | 'warn' | 'error' | 'debug';
export type ConsoleEntrySource = 'console' | 'exception' | 'unhandledrejection';

export interface ConsoleEntry {
  sequence: number;
  level: ConsoleLevel;
  source: ConsoleEntrySource;
  message: string;
  stack: string | null;
  timestamp: number;
}

export interface GetConsoleMessagesResult {
  tab_id: number;
  /** False when the MAIN-world collector was not present, so an empty list is not proof of silence. */
  available: boolean;
  cursor: number;
  entries: ConsoleEntry[];
  has_more: boolean;
  truncated: boolean;
  dropped: number;
}

export interface CoordinateActionResult {
  tab_id: number;
  performed: true;
}

export interface DownloadInfo {
  download_id: number;
  tab_id: number | null;
  url: string;
  filename: string;
  mime_type: string;
  state: 'in_progress' | 'interrupted' | 'complete';
  bytes_received: number;
  total_bytes: number;
  error: string | null;
}

export interface GetPageResult {
  page: PageState;
}

export interface GetInteractivesResult {
  snapshot: InteractiveSnapshot;
}

export interface PageContentImage {
  src: string;
  alt: string;
  width: number;
  height: number;
  visible: boolean;
}

export interface PageContentResult {
  tab_id: number;
  page_revision: string;
  url: string;
  title: string;
  text: string;
  html?: string;
  images: PageContentImage[];
  frames: Array<{ src: string; name: string; title: string }>;
}

export interface ElementActionState {
  tab_id: number;
  page_revision: string;
  page_revision_changed: boolean;
  needs_interactives_refresh: boolean;
}

export interface ClickResult {
  action: ElementActionState & { clicked: true };
}

export interface TypeResult {
  action: ElementActionState & { typed: true };
}

export interface DoubleClickResult {
  action: ElementActionState & { double_clicked: true };
}

export interface PressResult {
  action: ElementActionState & { pressed: true };
}

export interface SelectTextResult {
  action: ElementActionState & {
    selected: true;
    selection_type: NonNullable<SelectTextArgs['selection_type']>;
  };
}

export interface SetCheckedResult {
  action: ElementActionState & { checked: boolean };
}

export interface SelectOptionResult {
  action: ElementActionState & { selected_values: string[] };
}

export interface DragResult {
  action: ElementActionState & { dragged: true };
}

export interface WaitForElementResult {
  action: ElementActionState & { matched: true; state: WaitForElementArgs['state'] };
}

export interface ScrollResult {
  scroll: ElementActionState & {
    scroll_x: number;
    scroll_y: number;
    near_top: boolean;
    near_bottom: boolean;
  };
}

export interface ScreenshotResult {
  screenshot: {
    tab_id: number;
    page_revision: string;
    /** True only when the page changed while the image was captured (any live page does). */
    page_changed?: boolean;
    /** Present only with `page_changed`: the revision the capture started from. */
    page_revision_before?: string;
    width: number;
    height: number;
    mime_type: 'image/png' | 'image/jpeg';
    image_data: string;
  };
}

export interface ObserveResult {
  observation: {
    tab_id: number;
    page_revision: string;
    /** True only when the page changed while the observation was assembled. */
    page_changed?: boolean;
    /** Present only with `page_changed`: the revision the page had moved on to. */
    page_revision_after?: string;
    page?: PageState;
    snapshot?: InteractiveSnapshot;
    screenshot?: ScreenshotResult['screenshot'];
    accessibility_nodes?: unknown[];
  };
}

export interface SwitchTabResult {
  tab: TabInfo;
}

export interface OpenResult {
  tab: TabInfo;
}

export interface ToolResults {
  'browser.start_session': BrowserSessionResult;
  'browser.claim_tab': BrowserSessionResult;
  'browser.reset_sessions': ResetSessionsResult;
  'browser.close_tab': CloseTabResult;
  'browser.back': SwitchTabResult;
  'browser.forward': SwitchTabResult;
  'browser.reload': SwitchTabResult;
  'browser.get_console_messages': GetConsoleMessagesResult;
  'browser.select_text': SelectTextResult;
  'browser.handle_dialog': CoordinateActionResult;
  'browser.list_downloads': { downloads: DownloadInfo[] };
  'browser.wait_for_download': { download: DownloadInfo };
  'browser.set_files': {
    tab_id: number;
    frame_id: number;
    page_revision: string;
    file_count: number;
    files_set: true;
    needs_interactives_refresh: true;
  };
  'browser.list_tabs': ListTabsResult;
  'browser.get_frames': GetFramesResult;
  'browser.get_page': GetPageResult;
  'browser.get_interactives': GetInteractivesResult;
  'browser.get_page_content': PageContentResult;
  'browser.click': ClickResult;
  'browser.double_click': DoubleClickResult;
  'browser.type': TypeResult;
  'browser.press': PressResult;
  'browser.set_checked': SetCheckedResult;
  'browser.select_option': SelectOptionResult;
  'browser.drag': DragResult;
  'browser.wait_for_element': WaitForElementResult;
  'browser.scroll': ScrollResult;
  'browser.screenshot': ScreenshotResult;
  'browser.observe': ObserveResult;
  'browser.switch_tab': SwitchTabResult;
  'browser.open': OpenResult;
}

export type ToolRequest<TTool extends ToolName = ToolName> = {
  [TCurrentTool in TTool]: {
    kind: 'tool-request';
    protocol_version: typeof PROTOCOL_VERSION;
    request_id: string;
    session_id?: string;
    turn_id?: string;
    tool: TCurrentTool;
    args: ToolArguments[TCurrentTool];
  };
}[TTool];

export type ToolResponse<TTool extends ToolName = ToolName> =
  | {
      kind: 'tool-response';
      protocol_version: typeof PROTOCOL_VERSION;
      request_id: string;
      ok: true;
      result: ToolResults[TTool];
    }
  | {
      kind: 'tool-response';
      protocol_version: typeof PROTOCOL_VERSION;
      request_id: string;
      ok: false;
      error: ToolError;
    };

export type PageAgentAction =
  | 'get-page-state'
  | 'get-interactives'
  | 'get-page-content'
  | 'get-console-messages'
  | 'click'
  | 'double-click'
  | 'type'
  | 'press'
  | 'select-text'
  | 'set-checked'
  | 'select-option'
  | 'drag'
  | 'wait-for-element'
  | 'prepare-file-input'
  | 'clear-file-input-marker'
  | 'show-agent-cursor'
  | 'scroll';

interface PageAgentRequestBase {
  kind: 'page-agent-request';
  protocol_version: typeof PROTOCOL_VERSION;
  request_id: string;
}

export type PageAgentRequest =
  | (PageAgentRequestBase & { action: 'get-page-state' })
  | (PageAgentRequestBase & {
      action: 'get-interactives';
      limit: number;
      visible_only: boolean;
      tag?: string;
      role?: string;
      name_contains?: string;
    })
  | (PageAgentRequestBase & { action: 'get-page-content'; include_html: boolean; include_images: boolean; include_frames: boolean; max_text_length: number })
  | (PageAgentRequestBase & { action: 'get-console-messages' })
  | (PageAgentRequestBase & { action: 'click'; element_id: string; modifiers?: KeyModifier[] })
  | (PageAgentRequestBase & { action: 'double-click'; element_id: string; modifiers?: KeyModifier[] })
  | (PageAgentRequestBase & { action: 'type'; element_id: string; text: string })
  | (PageAgentRequestBase & { action: 'press'; element_id: string; key: string; modifiers?: KeyModifier[] })
  | (PageAgentRequestBase & { action: 'select-text'; element_id: string; text?: string; selection_type: NonNullable<SelectTextArgs['selection_type']> })
  | (PageAgentRequestBase & { action: 'set-checked'; element_id: string; checked: boolean })
  | (PageAgentRequestBase & { action: 'select-option'; element_id: string; values: string[] })
  | (PageAgentRequestBase & { action: 'drag'; source_element_id: string; target_element_id: string })
  | (PageAgentRequestBase & {
      action: 'wait-for-element';
      element_id: string;
      state: WaitForElementArgs['state'];
      timeout_ms: number;
    })
  | (PageAgentRequestBase & { action: 'prepare-file-input'; element_id: string })
  | (PageAgentRequestBase & { action: 'clear-file-input-marker'; marker: string })
  | (PageAgentRequestBase & { action: 'show-agent-cursor'; x: number; y: number })
  | (PageAgentRequestBase & { action: 'scroll'; delta_x: number; delta_y: number });

export interface PageAgentState {
  url: string;
  title: string;
  document_ready_state: DocumentReadyState;
  viewport: ViewportState;
  page_revision: string;
  revision_reason: PageRevisionReason;
}

export interface PageAgentInteractiveSnapshot {
  page_revision: string;
  snapshot_id: string;
  total: number;
  elements: InteractiveElement[];
}

export interface PageAgentElementActionResult {
  page_revision: string;
  page_revision_changed: boolean;
  needs_interactives_refresh: boolean;
}

export interface PageAgentSelectTextResult extends PageAgentElementActionResult {
  selected: true;
  selection_type: NonNullable<SelectTextArgs['selection_type']>;
}

export interface PageAgentScrollResult extends PageAgentElementActionResult {
  scroll_x: number;
  scroll_y: number;
  near_top: boolean;
  near_bottom: boolean;
}

export type PageAgentSuccessResponse =
  | {
      kind: 'page-agent-response';
      protocol_version: typeof PROTOCOL_VERSION;
      request_id: string;
      ok: true;
      action: 'get-page-content';
      result: PageContentResult;
    }
  | {
      kind: 'page-agent-response';
      protocol_version: typeof PROTOCOL_VERSION;
      request_id: string;
      ok: true;
      action: 'get-console-messages';
      result: { available: boolean; entries: ConsoleEntry[]; dropped: number };
    }
  | {
      kind: 'page-agent-response';
      protocol_version: typeof PROTOCOL_VERSION;
      request_id: string;
      ok: true;
      action: 'get-page-state';
      state: PageAgentState;
    }
  | {
      kind: 'page-agent-response';
      protocol_version: typeof PROTOCOL_VERSION;
      request_id: string;
      ok: true;
      action: 'get-interactives';
      snapshot: PageAgentInteractiveSnapshot;
    }
  | {
      kind: 'page-agent-response';
      protocol_version: typeof PROTOCOL_VERSION;
      request_id: string;
      ok: true;
      action: 'click';
      result: PageAgentElementActionResult & { clicked: true };
    }
  | {
      kind: 'page-agent-response';
      protocol_version: typeof PROTOCOL_VERSION;
      request_id: string;
      ok: true;
      action: 'double-click';
      result: PageAgentElementActionResult & { double_clicked: true };
    }
  | {
      kind: 'page-agent-response';
      protocol_version: typeof PROTOCOL_VERSION;
      request_id: string;
      ok: true;
      action: 'type';
      result: PageAgentElementActionResult & { typed: true };
    }
  | {
      kind: 'page-agent-response';
      protocol_version: typeof PROTOCOL_VERSION;
      request_id: string;
      ok: true;
      action: 'press';
      result: PageAgentElementActionResult & { pressed: true };
    }
  | {
      kind: 'page-agent-response';
      protocol_version: typeof PROTOCOL_VERSION;
      request_id: string;
      ok: true;
      action: 'select-text';
      result: PageAgentSelectTextResult;
    }
  | {
      kind: 'page-agent-response';
      protocol_version: typeof PROTOCOL_VERSION;
      request_id: string;
      ok: true;
      action: 'set-checked';
      result: PageAgentElementActionResult & { checked: boolean };
    }
  | {
      kind: 'page-agent-response';
      protocol_version: typeof PROTOCOL_VERSION;
      request_id: string;
      ok: true;
      action: 'select-option';
      result: PageAgentElementActionResult & { selected_values: string[] };
    }
  | {
      kind: 'page-agent-response';
      protocol_version: typeof PROTOCOL_VERSION;
      request_id: string;
      ok: true;
      action: 'drag';
      result: PageAgentElementActionResult & { dragged: true };
    }
  | {
      kind: 'page-agent-response';
      protocol_version: typeof PROTOCOL_VERSION;
      request_id: string;
      ok: true;
      action: 'wait-for-element';
      result: PageAgentElementActionResult & { matched: true; state: WaitForElementArgs['state'] };
    }
  | {
      kind: 'page-agent-response';
      protocol_version: typeof PROTOCOL_VERSION;
      request_id: string;
      ok: true;
      action: 'prepare-file-input';
      result: { marker: string; page_revision: string };
    }
  | {
      kind: 'page-agent-response';
      protocol_version: typeof PROTOCOL_VERSION;
      request_id: string;
      ok: true;
      action: 'clear-file-input-marker';
      result: { cleared: true };
    }
  | {
      kind: 'page-agent-response';
      protocol_version: typeof PROTOCOL_VERSION;
      request_id: string;
      ok: true;
      action: 'show-agent-cursor';
      result: { shown: true };
    }
  | {
      kind: 'page-agent-response';
      protocol_version: typeof PROTOCOL_VERSION;
      request_id: string;
      ok: true;
      action: 'scroll';
      result: PageAgentScrollResult;
    };

export type PageAgentResponse =
  | PageAgentSuccessResponse
  | {
      kind: 'page-agent-response';
      protocol_version: typeof PROTOCOL_VERSION;
      request_id: string;
      ok: false;
      error: ToolError;
    };

export type RuntimeMessage = ToolRequest | PageAgentRequest;
