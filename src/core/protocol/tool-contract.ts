import type { ToolError } from './errors';

export const PROTOCOL_VERSION = '1' as const;

export type ToolName =
  | 'browser.get_capabilities'
  | 'browser.start_session'
  | 'browser.end_session'
  | 'browser.name_session'
  | 'browser.claim_tab'
  | 'browser.release_tab'
  | 'browser.close_tab'
  | 'browser.back'
  | 'browser.forward'
  | 'browser.reload'
  | 'browser.attach_debugger'
  | 'browser.detach_debugger'
  | 'browser.cdp'
  | 'browser.get_cdp_events'
  | 'browser.get_accessibility_tree'
  | 'browser.mouse_move'
  | 'browser.click_at'
  | 'browser.drag_at'
  | 'browser.scroll_at'
  | 'browser.press_key'
  | 'browser.type_text'
  | 'browser.handle_dialog'
  | 'browser.list_downloads'
  | 'browser.wait_for_download'
  | 'browser.set_files'
  | 'browser.list_tabs'
  | 'browser.get_page'
  | 'browser.get_page_state'
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
  | 'browser.open';

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

export interface BrowserSessionInfo {
  session_id: string;
  name: string | null;
  tab_ids: number[];
  group_id: number | null;
}

export interface StartSessionArgs {
  session_id?: string;
  name?: string;
}

export interface EndSessionArgs {
  session_id: string;
  close_tabs?: boolean;
}

export interface NameSessionArgs {
  session_id: string;
  name: string;
}

export interface ClaimTabArgs {
  session_id: string;
  tab_id: number;
  group?: boolean;
}

export interface ReleaseTabArgs {
  session_id: string;
  tab_id: number;
}

export interface TabTargetArgs {
  tab_id: number;
}

export interface CdpArgs extends TabTargetArgs {
  method: string;
  params?: Record<string, unknown>;
}

export interface GetCdpEventsArgs extends TabTargetArgs {
  after_sequence?: number;
  limit?: number;
  methods?: string[];
}

export interface PointArgs extends TabTargetArgs {
  x: number;
  y: number;
}

export interface ClickAtArgs extends PointArgs {
  button?: 'left' | 'right' | 'middle';
  click_count?: number;
}

export interface DragAtArgs extends TabTargetArgs {
  from_x: number;
  from_y: number;
  to_x: number;
  to_y: number;
}

export interface ScrollAtArgs extends PointArgs {
  delta_x: number;
  delta_y: number;
}

export interface PressKeyArgs extends TabTargetArgs {
  key: string;
}

export interface TypeTextArgs extends TabTargetArgs {
  text: string;
}

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
  page_revision: string;
  snapshot_id: string;
  elements: InteractiveElement[];
}

export interface ListTabsArgs {
  window_id?: number;
}

export interface GetPageArgs {
  tab_id?: number;
}

export type GetPageStateArgs = GetPageArgs;

export interface GetInteractivesArgs {
  tab_id?: number;
}

export interface GetPageContentArgs {
  tab_id: number;
  include_html?: boolean;
  include_images?: boolean;
  include_frames?: boolean;
  max_text_length?: number;
}

export interface ClickArgs {
  tab_id: number;
  element_id: string;
}

export interface TypeArgs extends ClickArgs {
  text: string;
}

export interface PressArgs extends ClickArgs {
  key: string;
}

export interface SetCheckedArgs extends ClickArgs {
  checked: boolean;
}

export interface SelectOptionArgs extends ClickArgs {
  values: string[];
}

export interface DragArgs {
  tab_id: number;
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
}

export interface ToolArguments {
  'browser.get_capabilities': Record<string, never>;
  'browser.start_session': StartSessionArgs;
  'browser.end_session': EndSessionArgs;
  'browser.name_session': NameSessionArgs;
  'browser.claim_tab': ClaimTabArgs;
  'browser.release_tab': ReleaseTabArgs;
  'browser.close_tab': TabTargetArgs;
  'browser.back': TabTargetArgs;
  'browser.forward': TabTargetArgs;
  'browser.reload': TabTargetArgs;
  'browser.attach_debugger': TabTargetArgs;
  'browser.detach_debugger': TabTargetArgs;
  'browser.cdp': CdpArgs;
  'browser.get_cdp_events': GetCdpEventsArgs;
  'browser.get_accessibility_tree': TabTargetArgs;
  'browser.mouse_move': PointArgs;
  'browser.click_at': ClickAtArgs;
  'browser.drag_at': DragAtArgs;
  'browser.scroll_at': ScrollAtArgs;
  'browser.press_key': PressKeyArgs;
  'browser.type_text': TypeTextArgs;
  'browser.handle_dialog': HandleDialogArgs;
  'browser.list_downloads': ListDownloadsArgs;
  'browser.wait_for_download': WaitForDownloadArgs;
  'browser.set_files': SetFilesArgs;
  'browser.list_tabs': ListTabsArgs;
  'browser.get_page': GetPageArgs;
  'browser.get_page_state': GetPageStateArgs;
  'browser.get_interactives': GetInteractivesArgs;
  'browser.get_page_content': GetPageContentArgs;
  'browser.click': ClickArgs;
  'browser.double_click': ClickArgs;
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
}

export interface BrowserSessionResult {
  session: BrowserSessionInfo;
}

export interface EndSessionResult {
  session_id: string;
  released_tab_ids: number[];
  closed_tabs: boolean;
}

export interface ReleaseTabResult {
  session: BrowserSessionInfo;
  released_tab_id: number;
}

export interface CloseTabResult {
  tab_id: number;
  closed: true;
}

export interface DebuggerStateResult {
  tab_id: number;
  attached: boolean;
}

export interface CdpResult {
  tab_id: number;
  value: unknown;
}

export interface CdpEventInfo {
  sequence: number;
  tab_id: number;
  method: string;
  params: unknown;
  timestamp: number;
}

export interface GetCdpEventsResult {
  tab_id: number;
  cursor: number;
  events: CdpEventInfo[];
  has_more: boolean;
  truncated: boolean;
}

export interface AccessibilityTreeResult {
  tab_id: number;
  page_revision: string;
  nodes: unknown[];
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

export type GetPageStateResult = GetPageResult;

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
  'browser.get_capabilities': {
    protocol_version: typeof PROTOCOL_VERSION;
    tools: ToolName[];
    features: {
      native_messaging: true;
      websocket_agent_bridge: true;
      sessions: true;
      tab_groups: true;
      tab_leases: true;
      element_ids: true;
      accessibility_tree: true;
      screenshots: Array<'viewport' | 'full_page' | 'clip'>;
      cdp: true;
      downloads: true;
      file_upload: true;
      agent_cursor: true;
      top_level_document: true;
      page_content: true;
      page_images: true;
      iframes: false;
      shadow_dom: false;
    };
  };
  'browser.start_session': BrowserSessionResult;
  'browser.end_session': EndSessionResult;
  'browser.name_session': BrowserSessionResult;
  'browser.claim_tab': BrowserSessionResult;
  'browser.release_tab': ReleaseTabResult;
  'browser.close_tab': CloseTabResult;
  'browser.back': SwitchTabResult;
  'browser.forward': SwitchTabResult;
  'browser.reload': SwitchTabResult;
  'browser.attach_debugger': DebuggerStateResult;
  'browser.detach_debugger': DebuggerStateResult;
  'browser.cdp': CdpResult;
  'browser.get_cdp_events': GetCdpEventsResult;
  'browser.get_accessibility_tree': AccessibilityTreeResult;
  'browser.mouse_move': CoordinateActionResult;
  'browser.click_at': CoordinateActionResult;
  'browser.drag_at': CoordinateActionResult;
  'browser.scroll_at': CoordinateActionResult;
  'browser.press_key': CoordinateActionResult;
  'browser.type_text': CoordinateActionResult;
  'browser.handle_dialog': CoordinateActionResult;
  'browser.list_downloads': { downloads: DownloadInfo[] };
  'browser.wait_for_download': { download: DownloadInfo };
  'browser.set_files': {
    tab_id: number;
    page_revision: string;
    file_count: number;
    files_set: true;
    needs_interactives_refresh: true;
  };
  'browser.list_tabs': ListTabsResult;
  'browser.get_page': GetPageResult;
  'browser.get_page_state': GetPageStateResult;
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
  | 'click'
  | 'double-click'
  | 'type'
  | 'press'
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
  | (PageAgentRequestBase & { action: 'get-page-state' | 'get-interactives' })
  | (PageAgentRequestBase & { action: 'get-page-content'; include_html: boolean; include_images: boolean; include_frames: boolean; max_text_length: number })
  | (PageAgentRequestBase & { action: 'click'; element_id: string })
  | (PageAgentRequestBase & { action: 'double-click'; element_id: string })
  | (PageAgentRequestBase & { action: 'type'; element_id: string; text: string })
  | (PageAgentRequestBase & { action: 'press'; element_id: string; key: string })
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
  elements: InteractiveElement[];
}

export interface PageAgentElementActionResult {
  page_revision: string;
  page_revision_changed: boolean;
  needs_interactives_refresh: boolean;
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
