import { createToolError, ToolFailure, type ToolError } from './errors';
import {
  PROTOCOL_VERSION,
  DEFAULT_INTERACTIVE_LIMIT,
  type ElementBounds,
  type InteractiveElement,
  type ImageFormat,
  type PageAgentAction,
  type PageAgentInteractiveSnapshot,
  type PageAgentElementActionResult,
  type PageAgentRequest,
  type PageAgentResponse,
  type PageAgentScrollResult,
  type PageAgentState,
  type PageContentResult,
  type ConsoleEntry,
  type ConsoleLevel,
  type InteractiveFilterArgs,
  type KeyModifier,
  type RuntimeMessage,
  type ObservationContent,
  type ScreenshotArgs,
  type ScreenshotClip,
  type ToolName,
  type ToolRequest,
  type ValueState,
  type ViewportState,
} from './tool-contract';

type UnknownRecord = Record<string, unknown>;

export const TOOL_NAMES: readonly ToolName[] = [
  'browser.get_capabilities',
  'browser.start_session',
  'browser.end_session',
  'browser.name_session',
  'browser.claim_tab',
  'browser.release_tab',
  'browser.reset_sessions',
  'browser.close_tab',
  'browser.back',
  'browser.forward',
  'browser.reload',
  'browser.attach_debugger',
  'browser.detach_debugger',
  'browser.cdp',
  'browser.get_cdp_events',
  'browser.get_network_requests',
  'browser.get_console_messages',
  'browser.get_accessibility_tree',
  'browser.mouse_move',
  'browser.click_at',
  'browser.drag_at',
  'browser.scroll_at',
  'browser.press_key',
  'browser.select_text',
  'browser.type_text',
  'browser.handle_dialog',
  'browser.list_downloads',
  'browser.wait_for_download',
  'browser.set_files',
  'browser.list_tabs',
  'browser.get_frames',
  'browser.get_page',
  'browser.get_page_state',
  'browser.get_interactives',
  'browser.get_page_content',
  'browser.click',
  'browser.double_click',
  'browser.type',
  'browser.press',
  'browser.set_checked',
  'browser.select_option',
  'browser.drag',
  'browser.wait_for_element',
  'browser.scroll',
  'browser.screenshot',
  'browser.observe',
  'browser.switch_tab',
  'browser.open',
];

function isRecord(value: unknown): value is UnknownRecord {
  return typeof value === 'object' && value !== null;
}

function requireRecord(value: unknown, field: string): UnknownRecord {
  if (!isRecord(value)) throw invalid(field, 'must be an object');
  return value;
}

function requireString(value: unknown, field: string): string {
  if (typeof value !== 'string' || value.length === 0) throw invalid(field, 'must be a non-empty string');
  return value;
}

function requireBoolean(value: unknown, field: string): boolean {
  if (typeof value !== 'boolean') throw invalid(field, 'must be a boolean');
  return value;
}

function requireFiniteNumber(value: unknown, field: string): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) throw invalid(field, 'must be a finite number');
  return value;
}

function optionalInteger(value: unknown, field: string): number | undefined {
  if (value === undefined) return undefined;
  if (typeof value !== 'number' || !Number.isInteger(value)) throw invalid(field, 'must be an integer');
  return value;
}

function optionalBoolean(value: unknown, field: string): boolean | undefined {
  return value === undefined ? undefined : requireBoolean(value, field);
}

function optionalString(value: unknown, field: string): string | undefined {
  if (value === undefined) return undefined;
  return requireString(value, field);
}

function optionalPositiveInteger(value: unknown, field: string): number | undefined {
  const parsed = optionalInteger(value, field);
  if (parsed !== undefined && parsed <= 0) throw invalid(field, 'must be a positive integer');
  return parsed;
}

/** Chrome frame IDs start at 0 for the top document, so 0 must stay valid. */
function optionalFrameId(value: unknown, field: string): number | undefined {
  const parsed = optionalInteger(value, field);
  if (parsed !== undefined && parsed < 0) throw invalid(field, 'must be a non-negative integer');
  return parsed;
}

function optionalStringArray(value: unknown, field: string): string[] | undefined {
  if (value === undefined) return undefined;
  if (!Array.isArray(value) || !value.every((item) => typeof item === 'string' && item.length > 0)) {
    throw invalid(field, 'must be an array of non-empty strings');
  }
  return value.map((item) => item as string);
}

const CONSOLE_LEVELS: readonly ConsoleLevel[] = ['log', 'info', 'warn', 'error', 'debug'];
const KEY_MODIFIERS: readonly KeyModifier[] = ['Alt', 'Control', 'Meta', 'Shift'];

function optionalKeyModifiers(value: unknown, field: string): KeyModifier[] | undefined {
  if (value === undefined) return undefined;
  if (!Array.isArray(value) || !value.every((item) => KEY_MODIFIERS.includes(item as KeyModifier))) {
    throw invalid(field, 'must be an array of Alt, Control, Meta, or Shift');
  }
  return value as KeyModifier[];
}

function optionalConsoleLevels(value: unknown): ConsoleLevel[] | undefined {
  if (value === undefined) return undefined;
  if (!Array.isArray(value) || !value.every((item) => CONSOLE_LEVELS.includes(item as ConsoleLevel))) {
    throw invalid('args.levels', 'must be an array of log, info, warn, error, debug');
  }
  return value as ConsoleLevel[];
}

function parseScreenshotOptions(args: UnknownRecord): Pick<ScreenshotArgs, 'image_format' | 'full_page' | 'clip'> {
  const format = parseImageFormat(args.image_format);
  const fullPage = optionalBoolean(args.full_page, 'args.full_page');
  let clip: ScreenshotClip | undefined;
  if (args.clip !== undefined) {
    const value = requireRecord(args.clip, 'args.clip');
    const width = requireFiniteNumber(value.width, 'args.clip.width');
    const height = requireFiniteNumber(value.height, 'args.clip.height');
    if (width <= 0 || height <= 0) throw invalid('args.clip', 'width and height must be positive');
    const scale = value.scale === undefined ? undefined : requireFiniteNumber(value.scale, 'args.clip.scale');
    if (scale !== undefined && scale <= 0) throw invalid('args.clip.scale', 'must be positive');
    clip = {
      x: requireFiniteNumber(value.x, 'args.clip.x'),
      y: requireFiniteNumber(value.y, 'args.clip.y'),
      width,
      height,
      ...(scale === undefined ? {} : { scale }),
    };
  }
  return {
    ...(format === undefined ? {} : { image_format: format }),
    ...(fullPage === undefined ? {} : { full_page: fullPage }),
    ...(clip === undefined ? {} : { clip }),
  };
}

function nullableString(value: unknown, field: string): string | null {
  return value === null ? null : requireString(value, field);
}

function nullableBoolean(value: unknown, field: string): boolean | null {
  return value === null ? null : requireBoolean(value, field);
}

function invalid(field: string, message: string): ToolFailure {
  return new ToolFailure(createToolError('invalid_request', `${field} ${message}.`, false));
}

function parseArgs(tool: ToolName, value: unknown): ToolRequest['args'] {
  const args = requireRecord(value, 'args');
  switch (tool) {
    case 'browser.get_capabilities':
      return {};
    case 'browser.start_session': {
      const sessionId = optionalString(args.session_id, 'args.session_id');
      const name = optionalString(args.name, 'args.name');
      return {
        ...(sessionId === undefined ? {} : { session_id: sessionId }),
        ...(name === undefined ? {} : { name }),
      };
    }
    case 'browser.end_session':
      return {
        session_id: requireString(args.session_id, 'args.session_id'),
        ...(args.close_tabs === undefined ? {} : { close_tabs: requireBoolean(args.close_tabs, 'args.close_tabs') }),
      };
    case 'browser.name_session':
      return {
        session_id: requireString(args.session_id, 'args.session_id'),
        name: requireString(args.name, 'args.name'),
      };
    case 'browser.claim_tab':
      return {
        session_id: requireString(args.session_id, 'args.session_id'),
        tab_id: requireInteger(args.tab_id, 'args.tab_id'),
        ...(args.group === undefined ? {} : { group: requireBoolean(args.group, 'args.group') }),
      };
    case 'browser.release_tab':
      return {
        session_id: requireString(args.session_id, 'args.session_id'),
        tab_id: requireInteger(args.tab_id, 'args.tab_id'),
      };
    case 'browser.reset_sessions':
      return {};
    case 'browser.close_tab':
    case 'browser.back':
    case 'browser.forward':
    case 'browser.reload':
    case 'browser.attach_debugger':
    case 'browser.detach_debugger':
    case 'browser.get_accessibility_tree':
      return { tab_id: requireInteger(args.tab_id, 'args.tab_id') };
    case 'browser.cdp': {
      const params = args.params === undefined ? undefined : requireRecord(args.params, 'args.params');
      return {
        tab_id: requireInteger(args.tab_id, 'args.tab_id'),
        method: requireString(args.method, 'args.method'),
        ...(params === undefined ? {} : { params }),
      };
    }
    case 'browser.get_cdp_events': {
      const afterSequence = optionalInteger(args.after_sequence, 'args.after_sequence');
      if (afterSequence !== undefined && afterSequence < 0) throw invalid('args.after_sequence', 'must be non-negative');
      const limit = optionalPositiveInteger(args.limit, 'args.limit');
      const methods = optionalStringArray(args.methods, 'args.methods');
      return {
        tab_id: requireInteger(args.tab_id, 'args.tab_id'),
        ...(afterSequence === undefined ? {} : { after_sequence: afterSequence }),
        ...(limit === undefined ? {} : { limit }),
        ...(methods === undefined ? {} : { methods }),
      };
    }
    case 'browser.get_network_requests': {
      const afterSequence = optionalInteger(args.after_sequence, 'args.after_sequence');
      if (afterSequence !== undefined && afterSequence < 0) throw invalid('args.after_sequence', 'must be non-negative');
      const limit = optionalPositiveInteger(args.limit, 'args.limit');
      const type = optionalString(args.type, 'args.type');
      const failedOnly = optionalBoolean(args.failed_only, 'args.failed_only');
      return {
        tab_id: requireInteger(args.tab_id, 'args.tab_id'),
        ...(afterSequence === undefined ? {} : { after_sequence: afterSequence }),
        ...(limit === undefined ? {} : { limit }),
        ...(type === undefined ? {} : { type }),
        ...(failedOnly === undefined ? {} : { failed_only: failedOnly }),
      };
    }
    case 'browser.mouse_move':
      return {
        tab_id: requireInteger(args.tab_id, 'args.tab_id'),
        x: requireFiniteNumber(args.x, 'args.x'),
        y: requireFiniteNumber(args.y, 'args.y'),
      };
    case 'browser.get_console_messages': {
      const afterSequence = optionalInteger(args.after_sequence, 'args.after_sequence');
      if (afterSequence !== undefined && afterSequence < 0) throw invalid('args.after_sequence', 'must be non-negative');
      const limit = optionalPositiveInteger(args.limit, 'args.limit');
      const levels = optionalConsoleLevels(args.levels);
      const frameId = optionalFrameId(args.frame_id, 'args.frame_id');
      return {
        tab_id: requireInteger(args.tab_id, 'args.tab_id'),
        ...(afterSequence === undefined ? {} : { after_sequence: afterSequence }),
        ...(limit === undefined ? {} : { limit }),
        ...(levels === undefined ? {} : { levels }),
        ...(frameId === undefined ? {} : { frame_id: frameId }),
      };
    }
    case 'browser.click_at': {
      const button = args.button;
      if (button !== undefined && button !== 'left' && button !== 'right' && button !== 'middle') {
        throw invalid('args.button', 'must be left, right, or middle');
      }
      return {
        tab_id: requireInteger(args.tab_id, 'args.tab_id'),
        x: requireFiniteNumber(args.x, 'args.x'),
        y: requireFiniteNumber(args.y, 'args.y'),
        ...(button === undefined ? {} : { button }),
        ...(args.click_count === undefined ? {} : {
          click_count: optionalPositiveInteger(args.click_count, 'args.click_count'),
        }),
        ...(args.modifiers === undefined ? {} : {
          modifiers: optionalKeyModifiers(args.modifiers, 'args.modifiers'),
        }),
      };
    }
    case 'browser.drag_at':
      return {
        tab_id: requireInteger(args.tab_id, 'args.tab_id'),
        from_x: requireFiniteNumber(args.from_x, 'args.from_x'),
        from_y: requireFiniteNumber(args.from_y, 'args.from_y'),
        to_x: requireFiniteNumber(args.to_x, 'args.to_x'),
        to_y: requireFiniteNumber(args.to_y, 'args.to_y'),
      };
    case 'browser.scroll_at':
      return {
        tab_id: requireInteger(args.tab_id, 'args.tab_id'),
        x: requireFiniteNumber(args.x, 'args.x'),
        y: requireFiniteNumber(args.y, 'args.y'),
        delta_x: requireFiniteNumber(args.delta_x, 'args.delta_x'),
        delta_y: requireFiniteNumber(args.delta_y, 'args.delta_y'),
      };
    case 'browser.press_key': {
      const modifiers = optionalKeyModifiers(args.modifiers, 'args.modifiers');
      return {
        tab_id: requireInteger(args.tab_id, 'args.tab_id'),
        key: requireString(args.key, 'args.key'),
        ...(modifiers === undefined ? {} : { modifiers }),
      };
    }
    case 'browser.type_text':
      if (typeof args.text !== 'string') throw invalid('args.text', 'must be a string');
      return { tab_id: requireInteger(args.tab_id, 'args.tab_id'), text: args.text };
    case 'browser.handle_dialog': {
      if (args.action !== 'accept' && args.action !== 'dismiss') throw invalid('args.action', 'must be accept or dismiss');
      const promptText = optionalString(args.prompt_text, 'args.prompt_text');
      return {
        tab_id: requireInteger(args.tab_id, 'args.tab_id'),
        action: args.action,
        ...(promptText === undefined ? {} : { prompt_text: promptText }),
      };
    }
    case 'browser.list_downloads': {
      const tabId = optionalInteger(args.tab_id, 'args.tab_id');
      return tabId === undefined ? {} : { tab_id: tabId };
    }
    case 'browser.wait_for_download': {
      const tabId = optionalInteger(args.tab_id, 'args.tab_id');
      const timeoutMs = optionalPositiveInteger(args.timeout_ms, 'args.timeout_ms');
      return {
        ...(tabId === undefined ? {} : { tab_id: tabId }),
        ...(timeoutMs === undefined ? {} : { timeout_ms: timeoutMs }),
      };
    }
    case 'browser.set_files': {
      const files = optionalStringArray(args.files, 'args.files');
      if (files === undefined || files.length === 0) throw invalid('args.files', 'must not be empty');
      const frameId = optionalFrameId(args.frame_id, 'args.frame_id');
      return {
        tab_id: requireInteger(args.tab_id, 'args.tab_id'),
        element_id: requireString(args.element_id, 'args.element_id'),
        files,
        ...(frameId === undefined ? {} : { frame_id: frameId }),
      };
    }
    case 'browser.list_tabs': {
      const windowId = optionalInteger(args.window_id, 'args.window_id');
      const includeAll = optionalBoolean(args.include_all, 'args.include_all');
      return {
        ...(windowId === undefined ? {} : { window_id: windowId }),
        ...(includeAll === undefined ? {} : { include_all: includeAll }),
      };
    }
    case 'browser.get_frames':
      return { tab_id: requireInteger(args.tab_id, 'args.tab_id') };
    case 'browser.get_page':
    case 'browser.get_page_state': {
      const tabId = optionalInteger(args.tab_id, 'args.tab_id');
      const frameId = optionalFrameId(args.frame_id, 'args.frame_id');
      return {
        ...(tabId === undefined ? {} : { tab_id: tabId }),
        ...(frameId === undefined ? {} : { frame_id: frameId }),
      };
    }
    case 'browser.get_interactives': {
      const tabId = optionalInteger(args.tab_id, 'args.tab_id');
      const frameId = optionalFrameId(args.frame_id, 'args.frame_id');
      return {
        ...(tabId === undefined ? {} : { tab_id: tabId }),
        ...(frameId === undefined ? {} : { frame_id: frameId }),
        ...parseInteractiveFilter(args),
      };
    }
    case 'browser.get_page_content': {
      const max = optionalPositiveInteger(args.max_text_length, 'args.max_text_length');
      const frameId = optionalFrameId(args.frame_id, 'args.frame_id');
      return {
        tab_id: requireInteger(args.tab_id, 'args.tab_id'),
        ...(frameId === undefined ? {} : { frame_id: frameId }),
        include_html: args.include_html === true,
        include_images: args.include_images !== false,
        include_frames: args.include_frames !== false,
        max_text_length: max ?? 50_000,
      };
    }
    case 'browser.click':
    case 'browser.double_click': {
      const tabId = requireInteger(args.tab_id, 'args.tab_id');
      const modifiers = optionalKeyModifiers(args.modifiers, 'args.modifiers');
      const frameId = optionalFrameId(args.frame_id, 'args.frame_id');
      return {
        tab_id: tabId,
        element_id: requireString(args.element_id, 'args.element_id'),
        ...(frameId === undefined ? {} : { frame_id: frameId }),
        ...(modifiers === undefined ? {} : { modifiers }),
      };
    }
    case 'browser.type': {
      const tabId = requireInteger(args.tab_id, 'args.tab_id');
      if (typeof args.text !== 'string') throw invalid('args.text', 'must be a string');
      const frameId = optionalFrameId(args.frame_id, 'args.frame_id');
      return {
        tab_id: tabId,
        element_id: requireString(args.element_id, 'args.element_id'),
        text: args.text,
        ...(frameId === undefined ? {} : { frame_id: frameId }),
      };
    }
    case 'browser.press': {
      const modifiers = optionalKeyModifiers(args.modifiers, 'args.modifiers');
      const frameId = optionalFrameId(args.frame_id, 'args.frame_id');
      return {
        tab_id: requireInteger(args.tab_id, 'args.tab_id'),
        element_id: requireString(args.element_id, 'args.element_id'),
        key: requireString(args.key, 'args.key'),
        ...(frameId === undefined ? {} : { frame_id: frameId }),
        ...(modifiers === undefined ? {} : { modifiers }),
      };
    }
    case 'browser.select_text': {
      const selectionType = args.selection_type;
      if (selectionType !== undefined && selectionType !== 'text' && selectionType !== 'cursor_before' && selectionType !== 'cursor_after') {
        throw invalid('args.selection_type', 'must be text, cursor_before, or cursor_after');
      }
      const normalizedSelectionType = selectionType ?? 'text';
      const text = args.text === undefined ? undefined : typeof args.text === 'string' ? args.text : (() => { throw invalid('args.text', 'must be a string'); })();
      if (normalizedSelectionType === 'text' && text === undefined) throw invalid('args.text', 'is required when selection_type is text');
      const frameId = optionalFrameId(args.frame_id, 'args.frame_id');
      return {
        tab_id: requireInteger(args.tab_id, 'args.tab_id'),
        element_id: requireString(args.element_id, 'args.element_id'),
        ...(text === undefined ? {} : { text }),
        selection_type: normalizedSelectionType,
        ...(frameId === undefined ? {} : { frame_id: frameId }),
      };
    }
    case 'browser.set_checked': {
      const frameId = optionalFrameId(args.frame_id, 'args.frame_id');
      return {
        tab_id: requireInteger(args.tab_id, 'args.tab_id'),
        element_id: requireString(args.element_id, 'args.element_id'),
        checked: requireBoolean(args.checked, 'args.checked'),
        ...(frameId === undefined ? {} : { frame_id: frameId }),
      };
    }
    case 'browser.select_option': {
      const values = optionalStringArray(args.values, 'args.values');
      if (values === undefined || values.length === 0) throw invalid('args.values', 'must not be empty');
      const frameId = optionalFrameId(args.frame_id, 'args.frame_id');
      return {
        tab_id: requireInteger(args.tab_id, 'args.tab_id'),
        element_id: requireString(args.element_id, 'args.element_id'),
        values,
        ...(frameId === undefined ? {} : { frame_id: frameId }),
      };
    }
    case 'browser.drag': {
      const frameId = optionalFrameId(args.frame_id, 'args.frame_id');
      return {
        tab_id: requireInteger(args.tab_id, 'args.tab_id'),
        source_element_id: requireString(args.source_element_id, 'args.source_element_id'),
        target_element_id: requireString(args.target_element_id, 'args.target_element_id'),
        ...(frameId === undefined ? {} : { frame_id: frameId }),
      };
    }
    case 'browser.wait_for_element': {
      const state = args.state;
      if (state !== 'attached' && state !== 'detached' && state !== 'visible' && state !== 'hidden') {
        throw invalid('args.state', 'must be attached, detached, visible, or hidden');
      }
      const frameId = optionalFrameId(args.frame_id, 'args.frame_id');
      return {
        tab_id: requireInteger(args.tab_id, 'args.tab_id'),
        element_id: requireString(args.element_id, 'args.element_id'),
        state,
        ...(frameId === undefined ? {} : { frame_id: frameId }),
        ...(args.timeout_ms === undefined ? {} : {
          timeout_ms: optionalPositiveInteger(args.timeout_ms, 'args.timeout_ms'),
        }),
      };
    }
    case 'browser.scroll':
      return {
        tab_id: requireInteger(args.tab_id, 'args.tab_id'),
        delta_x: requireFiniteNumber(args.delta_x, 'args.delta_x'),
        delta_y: requireFiniteNumber(args.delta_y, 'args.delta_y'),
      };
    case 'browser.screenshot': {
      return {
        tab_id: requireInteger(args.tab_id, 'args.tab_id'),
        ...parseScreenshotOptions(args),
      };
    }
    case 'browser.observe': {
      const include = optionalStringArray(args.include, 'args.include');
      const allowed = new Set(['page_state', 'interactives', 'screenshot', 'accessibility']);
      if (include?.some((item) => !allowed.has(item))) throw invalid('args.include', 'contains an unsupported observation type');
      return {
        tab_id: requireInteger(args.tab_id, 'args.tab_id'),
        ...parseScreenshotOptions(args),
        ...(include === undefined ? {} : { include: include as ObservationContent[] }),
      };
    }
    case 'browser.switch_tab': {
      const tabId = optionalInteger(args.tab_id, 'args.tab_id');
      if (tabId === undefined) throw invalid('args.tab_id', 'is required');
      return { tab_id: tabId };
    }
    case 'browser.open': {
      const url = requireString(args.url, 'args.url');
      const tabId = optionalInteger(args.tab_id, 'args.tab_id');
      const activate = optionalBoolean(args.activate, 'args.activate');
      return {
        url,
        ...(tabId === undefined ? {} : { tab_id: tabId }),
        ...(activate === undefined ? {} : { activate }),
      };
    }
  }
}

function parseImageFormat(value: unknown): ImageFormat | undefined {
  if (value === undefined) return undefined;
  if (value !== 'png' && value !== 'jpeg') throw invalid('args.image_format', 'must be png or jpeg');
  return value;
}

/** Shared by the tool arguments and the Page Agent request so both accept the same filters. */
function parseInteractiveFilter(args: UnknownRecord): InteractiveFilterArgs {
  const limit = optionalPositiveInteger(args.limit, 'limit');
  const visibleOnly = optionalBoolean(args.visible_only, 'visible_only');
  const tag = optionalString(args.tag, 'tag');
  const role = optionalString(args.role, 'role');
  const nameContains = optionalString(args.name_contains, 'name_contains');
  return {
    ...(limit === undefined ? {} : { limit }),
    ...(visibleOnly === undefined ? {} : { visible_only: visibleOnly }),
    ...(tag === undefined ? {} : { tag }),
    ...(role === undefined ? {} : { role }),
    ...(nameContains === undefined ? {} : { name_contains: nameContains }),
  };
}

function requireInteger(value: unknown, field: string): number {
  const parsed = optionalInteger(value, field);
  if (parsed === undefined) throw invalid(field, 'is required');
  return parsed;
}

function requireProtocolVersion(value: unknown): typeof PROTOCOL_VERSION {
  if (value !== PROTOCOL_VERSION) throw invalid('protocol_version', `is unsupported: ${String(value)}`);
  return PROTOCOL_VERSION;
}

export function parseToolRequest(value: unknown): ToolRequest {
  const input = requireRecord(value, 'request');
  if (input.kind !== 'tool-request') throw invalid('kind', 'must be tool-request');
  const protocolVersion = requireProtocolVersion(input.protocol_version);
  const requestId = requireString(input.request_id, 'request_id');
  const sessionId = optionalString(input.session_id, 'session_id');
  const turnId = optionalString(input.turn_id, 'turn_id');
  const toolValue = requireString(input.tool, 'tool');
  if (!TOOL_NAMES.includes(toolValue as ToolName)) throw invalid('tool', `is unsupported: ${toolValue}`);
  const tool = toolValue as ToolName;
  return {
    kind: 'tool-request',
    protocol_version: protocolVersion,
    request_id: requestId,
    ...(sessionId === undefined ? {} : { session_id: sessionId }),
    ...(turnId === undefined ? {} : { turn_id: turnId }),
    tool,
    args: parseArgs(tool, input.args),
  } as ToolRequest;
}

export function parsePageAgentRequest(value: unknown): PageAgentRequest {
  const input = requireRecord(value, 'page-agent request');
  const protocolVersion = requireProtocolVersion(input.protocol_version);
  const requestId = requireString(input.request_id, 'request_id');
  if (input.kind !== 'page-agent-request') throw invalid('kind', 'must be page-agent-request');
  const base = { kind: 'page-agent-request' as const, protocol_version: protocolVersion, request_id: requestId };
  switch (input.action) {
    case 'get-page-state':
      return { ...base, action: 'get-page-state' };
    case 'get-interactives': {
      const filter = parseInteractiveFilter(input);
      return {
        ...base,
        action: 'get-interactives',
        limit: filter.limit ?? DEFAULT_INTERACTIVE_LIMIT,
        visible_only: filter.visible_only ?? false,
        ...(filter.tag === undefined ? {} : { tag: filter.tag }),
        ...(filter.role === undefined ? {} : { role: filter.role }),
        ...(filter.name_contains === undefined ? {} : { name_contains: filter.name_contains }),
      };
    }
    case 'get-page-content':
      return { ...base, action: 'get-page-content', include_html: input.include_html === true, include_images: input.include_images !== false, include_frames: input.include_frames !== false, max_text_length: optionalPositiveInteger(input.max_text_length, 'max_text_length') ?? 50_000 };
    case 'get-console-messages':
      return { ...base, action: 'get-console-messages' };
    case 'click':
    case 'double-click': {
      const modifiers = optionalKeyModifiers(input.modifiers, 'modifiers');
      return {
        ...base,
        action: input.action,
        element_id: requireString(input.element_id, 'element_id'),
        ...(modifiers === undefined ? {} : { modifiers }),
      };
    }
    case 'type':
      if (typeof input.text !== 'string') throw invalid('text', 'must be a string');
      return { ...base, action: 'type', element_id: requireString(input.element_id, 'element_id'), text: input.text };
    case 'press': {
      const modifiers = optionalKeyModifiers(input.modifiers, 'modifiers') ?? [];
      return {
        ...base,
        action: 'press',
        element_id: requireString(input.element_id, 'element_id'),
        key: requireString(input.key, 'key'),
        modifiers,
      };
    }
    case 'select-text': {
      const selectionType = input.selection_type;
      if (selectionType !== 'text' && selectionType !== 'cursor_before' && selectionType !== 'cursor_after') {
        throw invalid('selection_type', 'must be text, cursor_before, or cursor_after');
      }
      const text = input.text === undefined ? undefined : typeof input.text === 'string' ? input.text : (() => { throw invalid('text', 'must be a string'); })();
      return {
        ...base,
        action: 'select-text',
        element_id: requireString(input.element_id, 'element_id'),
        ...(text === undefined ? {} : { text }),
        selection_type: selectionType,
      };
    }
    case 'set-checked':
      return {
        ...base,
        action: 'set-checked',
        element_id: requireString(input.element_id, 'element_id'),
        checked: requireBoolean(input.checked, 'checked'),
      };
    case 'select-option': {
      const values = optionalStringArray(input.values, 'values');
      if (values === undefined || values.length === 0) throw invalid('values', 'must not be empty');
      return {
        ...base,
        action: 'select-option',
        element_id: requireString(input.element_id, 'element_id'),
        values,
      };
    }
    case 'drag':
      return {
        ...base,
        action: 'drag',
        source_element_id: requireString(input.source_element_id, 'source_element_id'),
        target_element_id: requireString(input.target_element_id, 'target_element_id'),
      };
    case 'wait-for-element': {
      const state = input.state;
      if (state !== 'attached' && state !== 'detached' && state !== 'visible' && state !== 'hidden') {
        throw invalid('state', 'must be attached, detached, visible, or hidden');
      }
      return {
        ...base,
        action: 'wait-for-element',
        element_id: requireString(input.element_id, 'element_id'),
        state,
        timeout_ms: optionalPositiveInteger(input.timeout_ms, 'timeout_ms') ?? 5_000,
      };
    }
    case 'prepare-file-input':
      return {
        ...base,
        action: 'prepare-file-input',
        element_id: requireString(input.element_id, 'element_id'),
      };
    case 'clear-file-input-marker':
      return {
        ...base,
        action: 'clear-file-input-marker',
        marker: requireString(input.marker, 'marker'),
      };
    case 'show-agent-cursor':
      return {
        ...base,
        action: 'show-agent-cursor',
        x: requireFiniteNumber(input.x, 'x'),
        y: requireFiniteNumber(input.y, 'y'),
      };
    case 'scroll':
      return {
        ...base,
        action: 'scroll',
        delta_x: requireFiniteNumber(input.delta_x, 'delta_x'),
        delta_y: requireFiniteNumber(input.delta_y, 'delta_y'),
      };
    default:
      throw invalid('action', 'is unsupported');
  }
}

export function parseRuntimeMessage(value: unknown): RuntimeMessage {
  const input = requireRecord(value, 'message');
  return input.kind === 'tool-request' ? parseToolRequest(value) : parsePageAgentRequest(value);
}

export function parsePageAgentResponse(value: unknown, expectedAction: PageAgentAction): PageAgentResponse {
  const input = requireRecord(value, 'page-agent response');
  if (input.kind !== 'page-agent-response') throw pageAgentError('Invalid response kind from Page Agent.');
  const protocolVersion = requireProtocolVersion(input.protocol_version);
  const requestId = requireString(input.request_id, 'request_id');
  if (input.ok === false && isToolError(input.error)) {
    return {
      kind: 'page-agent-response',
      protocol_version: protocolVersion,
      request_id: requestId,
      ok: false,
      error: input.error,
    };
  }
  if (input.ok !== true || input.action !== expectedAction) throw pageAgentError('Page Agent returned an unexpected response.');
  if (expectedAction === 'get-page-state') {
    return {
      kind: 'page-agent-response',
      protocol_version: protocolVersion,
      request_id: requestId,
      ok: true,
      action: 'get-page-state',
      state: parsePageAgentState(input.state),
    };
  }
  if (expectedAction === 'get-interactives') {
    return {
      kind: 'page-agent-response',
      protocol_version: protocolVersion,
      request_id: requestId,
      ok: true,
      action: 'get-interactives',
      snapshot: parseInteractiveSnapshot(input.snapshot),
    };
  }
  if (expectedAction === 'get-page-content') {
    return { kind: 'page-agent-response', protocol_version: protocolVersion, request_id: requestId, ok: true, action: 'get-page-content', result: input.result as PageContentResult };
  }
  if (expectedAction === 'get-console-messages') {
    return {
      kind: 'page-agent-response',
      protocol_version: protocolVersion,
      request_id: requestId,
      ok: true,
      action: 'get-console-messages',
      result: parseConsoleCollection(input.result),
    };
  }
  if (expectedAction === 'click') {
    const result = parseElementActionResult(input.result);
    if (!isRecord(input.result) || input.result.clicked !== true) throw pageAgentError('Invalid click result from Page Agent.');
    return {
      kind: 'page-agent-response',
      protocol_version: protocolVersion,
      request_id: requestId,
      ok: true,
      action: 'click',
      result: { ...result, clicked: true },
    };
  }
  if (expectedAction === 'double-click') {
    const result = parseElementActionResult(input.result);
    if (!isRecord(input.result) || input.result.double_clicked !== true) throw pageAgentError('Invalid double-click result.');
    return { kind: 'page-agent-response', protocol_version: protocolVersion, request_id: requestId, ok: true,
      action: 'double-click', result: { ...result, double_clicked: true } };
  }
  if (expectedAction === 'type') {
    const result = parseElementActionResult(input.result);
    if (!isRecord(input.result) || input.result.typed !== true) throw pageAgentError('Invalid type result from Page Agent.');
    return {
      kind: 'page-agent-response',
      protocol_version: protocolVersion,
      request_id: requestId,
      ok: true,
      action: 'type',
      result: { ...result, typed: true },
    };
  }
  if (expectedAction === 'press') {
    const result = parseElementActionResult(input.result);
    if (!isRecord(input.result) || input.result.pressed !== true) throw pageAgentError('Invalid press result.');
    return { kind: 'page-agent-response', protocol_version: protocolVersion, request_id: requestId, ok: true,
      action: 'press', result: { ...result, pressed: true } };
  }
  if (expectedAction === 'select-text') {
    const result = parseElementActionResult(input.result);
    if (!isRecord(input.result) || input.result.selected !== true) throw pageAgentError('Invalid select-text result.');
    const selectionType = input.result.selection_type;
    if (selectionType !== 'text' && selectionType !== 'cursor_before' && selectionType !== 'cursor_after') {
      throw pageAgentError('Invalid selection type.');
    }
    return { kind: 'page-agent-response', protocol_version: protocolVersion, request_id: requestId, ok: true,
      action: 'select-text', result: { ...result, selected: true, selection_type: selectionType } };
  }
  if (expectedAction === 'set-checked') {
    const result = parseElementActionResult(input.result);
    if (!isRecord(input.result)) throw pageAgentError('Invalid set-checked result.');
    return { kind: 'page-agent-response', protocol_version: protocolVersion, request_id: requestId, ok: true,
      action: 'set-checked', result: { ...result, checked: requireBoolean(input.result.checked, 'result.checked') } };
  }
  if (expectedAction === 'select-option') {
    const result = parseElementActionResult(input.result);
    if (!isRecord(input.result)) throw pageAgentError('Invalid select-option result.');
    const selectedValues = optionalStringArray(input.result.selected_values, 'result.selected_values');
    if (selectedValues === undefined) throw pageAgentError('Invalid selected values.');
    return { kind: 'page-agent-response', protocol_version: protocolVersion, request_id: requestId, ok: true,
      action: 'select-option', result: { ...result, selected_values: selectedValues } };
  }
  if (expectedAction === 'drag') {
    const result = parseElementActionResult(input.result);
    if (!isRecord(input.result) || input.result.dragged !== true) throw pageAgentError('Invalid drag result.');
    return { kind: 'page-agent-response', protocol_version: protocolVersion, request_id: requestId, ok: true,
      action: 'drag', result: { ...result, dragged: true } };
  }
  if (expectedAction === 'wait-for-element') {
    const result = parseElementActionResult(input.result);
    if (!isRecord(input.result) || input.result.matched !== true) throw pageAgentError('Invalid wait result.');
    const state = input.result.state;
    if (state !== 'attached' && state !== 'detached' && state !== 'visible' && state !== 'hidden') {
      throw pageAgentError('Invalid wait state.');
    }
    return { kind: 'page-agent-response', protocol_version: protocolVersion, request_id: requestId, ok: true,
      action: 'wait-for-element', result: { ...result, matched: true, state } };
  }
  if (expectedAction === 'prepare-file-input') {
    const result = requireRecord(input.result, 'result');
    return {
      kind: 'page-agent-response',
      protocol_version: protocolVersion,
      request_id: requestId,
      ok: true,
      action: 'prepare-file-input',
      result: {
        marker: requireString(result.marker, 'result.marker'),
        page_revision: requireString(result.page_revision, 'result.page_revision'),
      },
    };
  }
  if (expectedAction === 'clear-file-input-marker') {
    const result = requireRecord(input.result, 'result');
    if (result.cleared !== true) throw pageAgentError('Invalid file input marker cleanup result.');
    return { kind: 'page-agent-response', protocol_version: protocolVersion, request_id: requestId, ok: true,
      action: 'clear-file-input-marker', result: { cleared: true } };
  }
  if (expectedAction === 'show-agent-cursor') {
    const result = requireRecord(input.result, 'result');
    if (result.shown !== true) throw pageAgentError('Invalid agent cursor result.');
    return { kind: 'page-agent-response', protocol_version: protocolVersion, request_id: requestId, ok: true,
      action: 'show-agent-cursor', result: { shown: true } };
  }
  return {
    kind: 'page-agent-response',
    protocol_version: protocolVersion,
    request_id: requestId,
    ok: true,
    action: 'scroll',
    result: parseScrollResult(input.result),
  };
}

function parseConsoleCollection(value: unknown): { available: boolean; entries: ConsoleEntry[]; dropped: number } {
  const input = requireRecord(value, 'result');
  const rawEntries = Array.isArray(input.entries) ? input.entries : [];
  return {
    available: input.available === true,
    entries: rawEntries.map((entry, index) => parseConsoleEntry(requireRecord(entry, `result.entries[${index}]`), index)),
    dropped: optionalInteger(input.dropped, 'result.dropped') ?? 0,
  };
}

function parseConsoleEntry(input: UnknownRecord, index: number): ConsoleEntry {
  const field = (name: string): string => `result.entries[${index}].${name}`;
  if (!CONSOLE_LEVELS.includes(input.level as ConsoleLevel)) {
    throw invalid(field('level'), 'must be log, info, warn, error, or debug');
  }
  if (input.source !== 'console' && input.source !== 'exception' && input.source !== 'unhandledrejection') {
    throw invalid(field('source'), 'must be console, exception, or unhandledrejection');
  }
  return {
    sequence: requireInteger(input.sequence, field('sequence')),
    level: input.level as ConsoleLevel,
    source: input.source,
    message: typeof input.message === 'string' ? input.message : '',
    stack: typeof input.stack === 'string' && input.stack.length > 0 ? input.stack : null,
    timestamp: requireFiniteNumber(input.timestamp, field('timestamp')),
  };
}

function parseElementActionResult(value: unknown): PageAgentElementActionResult {
  const result = requireRecord(value, 'action result');
  return {
    page_revision: requireString(result.page_revision, 'result.page_revision'),
    page_revision_changed: requireBoolean(result.page_revision_changed, 'result.page_revision_changed'),
    needs_interactives_refresh: requireBoolean(result.needs_interactives_refresh, 'result.needs_interactives_refresh'),
  };
}

function parseScrollResult(value: unknown): PageAgentScrollResult {
  const result = requireRecord(value, 'scroll result');
  return {
    ...parseElementActionResult(result),
    scroll_x: requireFiniteNumber(result.scroll_x, 'result.scroll_x'),
    scroll_y: requireFiniteNumber(result.scroll_y, 'result.scroll_y'),
    near_top: requireBoolean(result.near_top, 'result.near_top'),
    near_bottom: requireBoolean(result.near_bottom, 'result.near_bottom'),
  };
}

function parsePageAgentState(value: unknown): PageAgentState {
  const state = requireRecord(value, 'page-agent state');
  const readyState = state.document_ready_state;
  if (readyState !== 'loading' && readyState !== 'interactive' && readyState !== 'complete') {
    throw pageAgentError('Invalid document ready state from Page Agent.');
  }
  if (typeof state.title !== 'string') throw pageAgentError('Invalid title from Page Agent.');
  if (state.revision_reason !== 'navigation' && state.revision_reason !== 'refresh' && state.revision_reason !== 'important_dom') {
    throw pageAgentError('Invalid revision reason from Page Agent.');
  }
  return {
    url: requireString(state.url, 'state.url'),
    title: state.title,
    document_ready_state: readyState,
    viewport: parseViewport(state.viewport),
    page_revision: requireString(state.page_revision, 'state.page_revision'),
    revision_reason: state.revision_reason,
  };
}

function parseViewport(value: unknown): ViewportState {
  const viewport = requireRecord(value, 'state.viewport');
  return {
    width: requireFiniteNumber(viewport.width, 'viewport.width'),
    height: requireFiniteNumber(viewport.height, 'viewport.height'),
    device_pixel_ratio: requireFiniteNumber(viewport.device_pixel_ratio, 'viewport.device_pixel_ratio'),
    scroll_x: requireFiniteNumber(viewport.scroll_x, 'viewport.scroll_x'),
    scroll_y: requireFiniteNumber(viewport.scroll_y, 'viewport.scroll_y'),
  };
}

function parseInteractiveSnapshot(value: unknown): PageAgentInteractiveSnapshot {
  const snapshot = requireRecord(value, 'snapshot');
  if (!Array.isArray(snapshot.elements)) throw pageAgentError('Invalid elements list from Page Agent.');
  const elements = snapshot.elements.map(parseInteractiveElement);
  return {
    page_revision: requireString(snapshot.page_revision, 'snapshot.page_revision'),
    snapshot_id: requireString(snapshot.snapshot_id, 'snapshot.snapshot_id'),
    // Tolerated when absent so an older injected Page Agent cannot break the caller.
    total: optionalInteger(snapshot.total, 'snapshot.total') ?? elements.length,
    elements,
  };
}

function parseInteractiveElement(value: unknown, index: number): InteractiveElement {
  const element = requireRecord(value, `elements[${index}]`);
  if (typeof element.name !== 'string' || typeof element.text !== 'string') {
    throw pageAgentError(`Invalid text fields for elements[${index}].`);
  }
  return {
    element_id: requireString(element.element_id, `elements[${index}].element_id`),
    role: requireString(element.role, `elements[${index}].role`),
    tag: requireString(element.tag, `elements[${index}].tag`),
    name: element.name,
    text: element.text,
    input_type: nullableString(element.input_type, `elements[${index}].input_type`),
    placeholder: nullableString(element.placeholder, `elements[${index}].placeholder`),
    value_state: parseValueState(element.value_state),
    checked: nullableBoolean(element.checked, `elements[${index}].checked`),
    selected: nullableBoolean(element.selected, `elements[${index}].selected`),
    disabled: requireBoolean(element.disabled, `elements[${index}].disabled`),
    visible: requireBoolean(element.visible, `elements[${index}].visible`),
    bounds: parseBounds(element.bounds),
  };
}

function parseValueState(value: unknown): ValueState {
  if (value !== 'empty' && value !== 'filled' && value !== 'redacted' && value !== 'not_applicable') {
    throw pageAgentError('Invalid value_state from Page Agent.');
  }
  return value;
}

function parseBounds(value: unknown): ElementBounds {
  const bounds = requireRecord(value, 'element.bounds');
  return {
    x: requireFiniteNumber(bounds.x, 'bounds.x'),
    y: requireFiniteNumber(bounds.y, 'bounds.y'),
    width: requireFiniteNumber(bounds.width, 'bounds.width'),
    height: requireFiniteNumber(bounds.height, 'bounds.height'),
  };
}

function pageAgentError(message: string): ToolFailure {
  return new ToolFailure(createToolError('internal_error', message, true));
}

function isToolError(value: unknown): value is ToolError {
  if (!isRecord(value)) return false;
  return typeof value.code === 'string' && typeof value.message === 'string' && typeof value.retryable === 'boolean';
}
