import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import { TOOL_NAMES } from '../core/protocol/schemas';
import type { ToolName } from '../core/protocol/tool-contract';
import { callLocalBridge, LocalBridgeError } from './bridge-client';

const tabId = { tab_id: z.number().int().describe('Chrome tab ID.') };
const optionalTabId = { tab_id: z.number().int().optional().describe('Chrome tab ID. Defaults to the active tab when omitted.') };
const sessionId = { session_id: z.string().min(1).describe('Browser session ID.') };
const elementId = { tab_id: z.number().int(), element_id: z.string().min(1).describe('Opaque element_id returned by browser_get_interactives.') };
const frameId = {
  frame_id: z.number().int().nonnegative().optional().describe(
    'Chrome frame ID inside the tab from browser_get_frames. 0 is the top document, which is the default.',
  ),
};

const schemas = {
  'browser.get_capabilities': {},
  'browser.start_session': { session_id: z.string().min(1).optional(), name: z.string().min(1).optional() },
  'browser.end_session': { ...sessionId, close_tabs: z.boolean().optional() },
  'browser.name_session': { ...sessionId, name: z.string().min(1) },
  'browser.claim_tab': { ...sessionId, tab_id: tabId.tab_id, group: z.boolean().optional() },
  'browser.release_tab': { ...sessionId, tab_id: tabId.tab_id },
  'browser.reset_sessions': {},
  'browser.close_tab': tabId,
  'browser.back': tabId,
  'browser.forward': tabId,
  'browser.reload': tabId,
  'browser.attach_debugger': tabId,
  'browser.detach_debugger': tabId,
  'browser.cdp': { ...tabId, method: z.string().min(1), params: z.record(z.string(), z.unknown()).optional() },
  'browser.get_cdp_events': { ...tabId, after_sequence: z.number().int().optional(), limit: z.number().int().positive().optional(), methods: z.array(z.string()).optional() },
  'browser.get_network_requests': { ...tabId, after_sequence: z.number().int().optional(), limit: z.number().int().positive().optional(), type: z.string().min(1).optional(), failed_only: z.boolean().optional() },
  'browser.get_console_messages': { ...tabId, ...frameId, after_sequence: z.number().int().optional(), limit: z.number().int().positive().optional(), levels: z.array(z.enum(['log', 'info', 'warn', 'error', 'debug'])).optional() },
  'browser.get_accessibility_tree': tabId,
  'browser.mouse_move': { ...tabId, x: z.number(), y: z.number() },
  'browser.click_at': { ...tabId, x: z.number(), y: z.number(), button: z.enum(['left', 'right', 'middle']).optional(), click_count: z.number().int().positive().optional(), modifiers: z.array(z.enum(['Alt', 'Control', 'Meta', 'Shift'])).optional() },
  'browser.drag_at': { ...tabId, from_x: z.number(), from_y: z.number(), to_x: z.number(), to_y: z.number() },
  'browser.scroll_at': { ...tabId, x: z.number(), y: z.number(), delta_x: z.number(), delta_y: z.number() },
  'browser.press_key': { ...tabId, key: z.string().min(1), modifiers: z.array(z.enum(['Alt', 'Control', 'Meta', 'Shift'])).optional() },
  'browser.select_text': { ...elementId, ...frameId, text: z.string().optional(), selection_type: z.enum(['text', 'cursor_before', 'cursor_after']).optional() },
  'browser.type_text': { ...tabId, text: z.string() },
  'browser.handle_dialog': { ...tabId, action: z.enum(['accept', 'dismiss']), prompt_text: z.string().optional() },
  'browser.list_downloads': optionalTabId,
  'browser.wait_for_download': { ...optionalTabId, timeout_ms: z.number().int().positive().optional() },
  'browser.set_files': { ...elementId, ...frameId, files: z.array(z.string().min(1)) },
  'browser.list_tabs': { window_id: z.number().int().optional() },
  'browser.get_frames': tabId,
  'browser.get_page': { ...optionalTabId, ...frameId },
  'browser.get_page_state': { ...optionalTabId, ...frameId },
  'browser.get_interactives': {
    ...optionalTabId,
    ...frameId,
    limit: z.number().int().positive().optional().describe('Maximum elements returned. Defaults to 150.'),
    visible_only: z.boolean().optional().describe('Drop elements that are not visible.'),
    tag: z.string().min(1).optional().describe('Keep one tag, for example button or input.'),
    role: z.string().min(1).optional().describe('Keep one role, for example tab or combobox.'),
    name_contains: z.string().min(1).optional().describe('Case-insensitive substring of the element name or text.'),
  },
  'browser.get_page_content': { ...tabId, ...frameId, include_html: z.boolean().optional(), include_images: z.boolean().optional(), include_frames: z.boolean().optional(), max_text_length: z.number().int().positive().optional() },
  'browser.click': { ...elementId, ...frameId, modifiers: z.array(z.enum(['Alt', 'Control', 'Meta', 'Shift'])).optional() },
  'browser.double_click': { ...elementId, ...frameId, modifiers: z.array(z.enum(['Alt', 'Control', 'Meta', 'Shift'])).optional() },
  'browser.type': { ...elementId, ...frameId, text: z.string() },
  'browser.press': { ...elementId, ...frameId, key: z.string().min(1), modifiers: z.array(z.enum(['Alt', 'Control', 'Meta', 'Shift'])).optional() },
  'browser.set_checked': { ...elementId, ...frameId, checked: z.boolean() },
  'browser.select_option': { ...elementId, ...frameId, values: z.array(z.string()) },
  'browser.drag': { tab_id: tabId.tab_id, ...frameId, source_element_id: z.string().min(1), target_element_id: z.string().min(1) },
  'browser.wait_for_element': { ...elementId, ...frameId, state: z.enum(['attached', 'detached', 'visible', 'hidden']), timeout_ms: z.number().int().positive().optional() },
  'browser.scroll': { ...tabId, delta_x: z.number(), delta_y: z.number() },
  'browser.screenshot': { ...tabId, image_format: z.enum(['png', 'jpeg']).optional(), full_page: z.boolean().optional(), clip: z.object({ x: z.number(), y: z.number(), width: z.number().positive(), height: z.number().positive(), scale: z.number().positive().optional() }).optional() },
  'browser.observe': { ...tabId, image_format: z.enum(['png', 'jpeg']).optional(), full_page: z.boolean().optional(), clip: z.object({ x: z.number(), y: z.number(), width: z.number().positive(), height: z.number().positive(), scale: z.number().positive().optional() }).optional(), include: z.array(z.enum(['page_state', 'interactives', 'screenshot', 'accessibility'])).optional() },
  'browser.switch_tab': tabId,
  'browser.open': { url: z.string().url(), tab_id: z.number().int().optional(), activate: z.boolean().optional() },
};

const optionalSessionId = {
  session_id: z.string().min(1).optional().describe(
    'Session that owns the tab. Pass it on every call so the runtime can refuse a tab another session holds.',
  ),
};

// Every tool accepts a session so ownership can be enforced, but a tool that declares its own
// session_id keeps its stricter schema because its own definition is spread last. The shape is
// widened from the literal map, so the conversion is intentional.
const toolSchemas = Object.fromEntries(
  Object.entries(schemas).map(([tool, schema]) => [tool, { ...optionalSessionId, ...schema }]),
) as unknown as typeof schemas;

type ContentBlock = CallToolResult['content'][number];

interface ScreenshotPayload {
  mime_type: string;
  image_data: string;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function isScreenshotPayload(value: unknown): value is ScreenshotPayload {
  return isRecord(value) && typeof value.image_data === 'string' && typeof value.mime_type === 'string';
}

/**
 * Screenshots are returned as MCP image content so clients actually see them. The base64 payload is
 * also stripped from the JSON text, which would otherwise cost roughly 15k tokens per capture.
 */
function toContent(tool: ToolName, result: unknown): ContentBlock[] {
  const screenshot = tool === 'browser.screenshot' && isRecord(result) ? result.screenshot
    : tool === 'browser.observe' && isRecord(result) && isRecord(result.observation) ? result.observation.screenshot
    : undefined;
  if (!isScreenshotPayload(screenshot)) {
    return [{ type: 'text', text: JSON.stringify(result, null, 2) }];
  }

  const metadata: Record<string, unknown> = { ...screenshot };
  delete metadata.image_data;
  // The runtime returns a data URL, but MCP image content requires the bare base64 payload.
  const comma = screenshot.image_data.indexOf(',');
  const base64 = comma === -1 ? screenshot.image_data : screenshot.image_data.slice(comma + 1);
  const text = tool === 'browser.observe' && isRecord(result) && isRecord(result.observation)
    ? { ...result, observation: { ...result.observation, screenshot: metadata } }
    : { ...(isRecord(result) ? result : {}), screenshot: metadata };
  return [
    { type: 'image', data: base64, mimeType: screenshot.mime_type },
    { type: 'text', text: JSON.stringify(text, null, 2) },
  ];
}

// One MCP server process serves one conversation (the client spawns a process per conversation), so
// the server can own a session by itself: tabs it opens are claimed and grouped automatically and
// another conversation is refused them, without the agent passing anything. An explicit session_id
// in the tool arguments wins and becomes this conversation's default from then on, which keeps the
// manual handover flow working.
let conversationSessionId = `mcp_${randomUUID()}`;
const startedSessions = new Set<string>();

/** Created on first use, so a bridge that is not up yet still reports its own error on the real call. */
async function ensureSession(sessionId: string): Promise<void> {
  if (startedSessions.has(sessionId)) return;
  try {
    // The id has to travel in args as well as at the request root: browser.start_session reads it
    // from args and would otherwise create a session under a different generated id.
    await callLocalBridge('browser.start_session', { session_id: sessionId }, sessionId);
    startedSessions.add(sessionId);
  } catch {
    // Ignored on purpose: the request that follows returns the actionable error.
  }
}

/** `browser_start_session` may generate the id itself, so adopt whatever it reports back. */
function adoptStartedSession(result: unknown): void {
  if (!isRecord(result) || !isRecord(result['session'])) return;
  const sessionId = result['session']['session_id'];
  if (typeof sessionId !== 'string' || sessionId.length === 0) return;
  conversationSessionId = sessionId;
  startedSessions.add(sessionId);
}

export async function startMcpServer(): Promise<void> {
  const server = new McpServer(
    { name: 'agentsurf', version: '0.1.0' },
    {
      instructions: [
        'AgentSurf controls the user\'s local Chrome.',
        'Start with browser_list_tabs.',
        'Before element actions, call browser_get_interactives and use its returned opaque element_id; never invent selectors or element IDs.',
        'An element_id only works in the frame that produced it: when the snapshot came from a frame_id, pass that same frame_id on the later element action, otherwise the runtime looks in the top document and reports a stale element.',
        'Ask the user before consequential actions such as submitting, purchasing, deleting, uploading, or sending messages.',
        'This conversation already owns a browser session: tabs you open are claimed and grouped automatically, and another conversation is refused them. Use browser_claim_tab to take over a tab the user already had open; that claims and groups it too.',
      ].join(' '),
    },
  );

  for (const tool of TOOL_NAMES) {
    const mcpName = tool.replaceAll('.', '_');
    server.registerTool(mcpName, {
      title: mcpName,
      description: descriptionFor(tool),
      inputSchema: toolSchemas[tool],
    }, async (args: Record<string, unknown>): Promise<CallToolResult> => {
      try {
        // Forwarded at the request root, and left in args for the session tools that read it there.
        const explicit = typeof args['session_id'] === 'string' ? args['session_id'] : undefined;
        if (explicit !== undefined) conversationSessionId = explicit;
        await ensureSession(conversationSessionId);
        let result: unknown;
        try {
          result = await callLocalBridge(tool, args, conversationSessionId);
        } catch (error: unknown) {
          // `browser_reset_sessions` (or a cleared extension store) can delete the session this
          // conversation was using, so recreate it once instead of failing the call.
          if (!(error instanceof LocalBridgeError) || error.toolError.code !== 'session_not_found') throw error;
          startedSessions.delete(conversationSessionId);
          await ensureSession(conversationSessionId);
          result = await callLocalBridge(tool, args, conversationSessionId);
        }
        if (tool === 'browser.start_session') adoptStartedSession(result);
        return { content: toContent(tool, result) };
      } catch (error: unknown) {
        if (error instanceof LocalBridgeError) {
          return {
            isError: true,
            content: [{ type: 'text', text: JSON.stringify({ error: error.toolError }, null, 2) }],
          };
        }
        const message = error instanceof Error ? error.message : String(error);
        return { isError: true, content: [{ type: 'text', text: `AgentSurf error: ${message}` }] };
      }
    });
  }

  await server.connect(new StdioServerTransport());
}

function descriptionFor(tool: ToolName): string {
  const descriptions: Record<ToolName, string> = {
    'browser.get_capabilities': 'Get AgentSurf capabilities and supported browser tools.',

    'browser.start_session': 'Start a session that owns the right to drive specific tabs. Usually unnecessary: this conversation already has one and its tabs are claimed and grouped automatically. Use it to create a named session, or to take over a specific session id.',
    'browser.end_session': 'End a session and release every tab it holds. Set close_tabs to close those tabs as well.',
    'browser.name_session': 'Rename a session so it is easier to recognize. The name becomes the Chrome tab group title.',
    'browser.claim_tab': 'Take over a tab this session does not own yet, for example a page the user already had open. The tab joins the session group unless you pass group: false, and other sessions are refused it from then on.',
    'browser.release_tab': 'Give up a session ownership of a tab.',
    'browser.reset_sessions': 'Release every browser session and tab lease at once, and ungroup the tabs those sessions held. Use it to recover tabs stuck as owned by a conversation that was closed without ending its session.',
    'browser.list_tabs': 'List Chrome tabs without changing the active tab. Start here to find a tab_id.',
    'browser.get_frames': 'List the frames inside a tab: iframes and blank-src app frames included. Frame 0 is the top document. Pass a returned frame_id to page reads and element actions to work inside that frame.',
    'browser.open': 'Open a URL in Chrome, or navigate an existing tab when tab_id is given.',
    'browser.switch_tab': 'Bring a tab to the front of its window. Screenshots work without this, but the user will see the tab change.',
    'browser.close_tab': 'Close a Chrome tab.',

    'browser.back': 'Go back one entry in the tab history.',
    'browser.forward': 'Go forward one entry in the tab history.',
    'browser.reload': 'Reload the tab, re-running its scripts.',

    'browser.get_page': 'Read page metadata and viewport state.',
    'browser.get_page_state': 'Read the current page state and revision.',
    'browser.get_interactives': 'List interactive page elements and their opaque element_ids. Call this before any element action. Pass frame_id to inspect an iframe; the top document is frame 0, and an element_id only works in the frame that returned it. A heavy page can hold hundreds of elements, so the list is capped at 150 and reports total plus truncated; narrow it with limit, visible_only, tag, role or name_contains instead of asking for everything.',
    'browser.get_page_content': 'Extract readable page text, and optionally HTML, image, and iframe metadata. Covers the top document unless frame_id targets a frame; app shells keep their real content inside an iframe, so check browser_get_frames when the text looks like navigation only.',
    'browser.get_accessibility_tree': 'Read the Chrome accessibility tree for a tab, for structure that get_page_content flattens away.',
    'browser.screenshot': 'Capture a screenshot of a Chrome tab as an image. Works on a background tab. Prefer this over describing a page in text when layout or visual state matters.',
    'browser.observe': 'Capture page state, interactive elements, accessibility data, and a screenshot in one call.',

    'browser.get_console_messages': 'Read page console output, uncaught exceptions, and unhandled rejections. Check available: false, which means the collector was not running and an empty list is not proof of silence.',
    'browser.get_network_requests': 'List network requests observed for a tab since the extension started. Use failed_only to find errors, and type to cut noise.',
    'browser.attach_debugger': 'Attach the Chrome debugger so browser_get_cdp_events starts recording. This shows a "Chrome is being debugged" banner and fails if DevTools is already open on the tab. browser_cdp and browser_screenshot attach on their own.',
    'browser.detach_debugger': 'Detach the Chrome debugger and remove the debug banner for a tab.',
    'browser.cdp': 'Send a raw Chrome DevTools Protocol command to a tab. Use this for anything without a dedicated tool, for example Runtime.evaluate to run JavaScript in the page, or Emulation.setDeviceMetricsOverride to resize the viewport. The debugger attaches automatically.',
    'browser.get_cdp_events': 'Read buffered CDP events for a tab, optionally filtered by method, for example Runtime.consoleAPICalled or Network.responseReceived. Only events seen since the debugger attached are buffered, up to 1000 per tab.',

    'browser.click': 'Click an element returned by browser_get_interactives.',
    'browser.double_click': 'Double-click an element returned by browser_get_interactives.',
    'browser.type': 'Type into an editable element returned by browser_get_interactives.',
    'browser.press': 'Press a key on an element returned by browser_get_interactives. Supports optional modifier keys.',
    'browser.select_text': 'Select text or place the cursor before or after text in an editable element.',
    'browser.set_checked': 'Set a checkbox or radio button to a specific checked state.',
    'browser.select_option': 'Choose options in a select element by value.',
    'browser.drag': 'Drag one element from browser_get_interactives onto another.',
    'browser.wait_for_element': 'Wait for an element from browser_get_interactives to become attached, detached, visible, or hidden. Get a fresh element_id if the page revision changed while waiting.',
    'browser.scroll': 'Scroll the document by a pixel delta, reporting whether it reached the top or bottom. Use browser_scroll_at to scroll a nested container instead.',

    'browser.mouse_move': 'Move the mouse to viewport coordinates, to trigger hover-only menus. There is no element-based hover tool.',
    'browser.click_at': 'Click at raw viewport coordinates. Prefer browser_click, which takes an element_id and verifies the element is still visible and enabled on the current page revision.',
    'browser.drag_at': 'Drag between raw viewport coordinates along an interpolated path, for canvas and map interactions. Prefer browser_drag for HTML elements.',
    'browser.scroll_at': 'Send a mouse wheel event at viewport coordinates, so a nested scroll container scrolls instead of the document.',
    'browser.press_key': 'Send a key press to the focused element, including keys such as Enter or Tab that trigger actions. Supports optional modifier keys. Prefer browser_press to target a specific element.',
    'browser.type_text': 'Insert text into whatever is currently focused, without targeting an element. Prefer browser_type for a specific element.',
    'browser.handle_dialog': 'Accept or dismiss a JavaScript alert, confirm, or prompt. Supply prompt_text when accepting a prompt.',

    'browser.set_files': 'Set files on a file input element using absolute local paths.',
    'browser.list_downloads': 'List recent Chrome downloads. Chrome does not record which tab started a download, so tab_id is null unless a previous browser_wait_for_download associated it.',
    'browser.wait_for_download': 'Wait for a download to complete or fail, optionally only one started from a given tab.',
  };
  return descriptions[tool];
}
