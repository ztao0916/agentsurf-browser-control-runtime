import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { z } from 'zod';
import { TOOL_NAMES } from '../core/protocol/schemas';
import type { ToolName, ToolRequest } from '../core/protocol/tool-contract';
import { callLocalBridge } from './bridge-client';

const tabId = { tab_id: z.number().int().describe('Chrome tab ID.') };
const optionalTabId = { tab_id: z.number().int().optional().describe('Chrome tab ID. Defaults to the active tab when omitted.') };
const sessionId = { session_id: z.string().min(1).describe('Browser session ID.') };
const elementId = { tab_id: z.number().int(), element_id: z.string().min(1).describe('Opaque element_id returned by browser_get_interactives.') };

const schemas = {
  'browser.get_capabilities': {},
  'browser.start_session': { session_id: z.string().min(1).optional(), name: z.string().min(1).optional() },
  'browser.end_session': { ...sessionId, close_tabs: z.boolean().optional() },
  'browser.name_session': { ...sessionId, name: z.string().min(1) },
  'browser.claim_tab': { ...sessionId, tab_id: tabId.tab_id, group: z.boolean().optional() },
  'browser.release_tab': { ...sessionId, tab_id: tabId.tab_id },
  'browser.close_tab': tabId,
  'browser.back': tabId,
  'browser.forward': tabId,
  'browser.reload': tabId,
  'browser.attach_debugger': tabId,
  'browser.detach_debugger': tabId,
  'browser.cdp': { ...tabId, method: z.string().min(1), params: z.record(z.string(), z.unknown()).optional() },
  'browser.get_cdp_events': { ...tabId, after_sequence: z.number().int().optional(), limit: z.number().int().positive().optional(), methods: z.array(z.string()).optional() },
  'browser.get_accessibility_tree': tabId,
  'browser.mouse_move': { ...tabId, x: z.number(), y: z.number() },
  'browser.click_at': { ...tabId, x: z.number(), y: z.number(), button: z.enum(['left', 'right', 'middle']).optional(), click_count: z.number().int().positive().optional() },
  'browser.drag_at': { ...tabId, from_x: z.number(), from_y: z.number(), to_x: z.number(), to_y: z.number() },
  'browser.scroll_at': { ...tabId, x: z.number(), y: z.number(), delta_x: z.number(), delta_y: z.number() },
  'browser.press_key': { ...tabId, key: z.string().min(1) },
  'browser.type_text': { ...tabId, text: z.string() },
  'browser.handle_dialog': { ...tabId, action: z.enum(['accept', 'dismiss']), prompt_text: z.string().optional() },
  'browser.list_downloads': optionalTabId,
  'browser.wait_for_download': { ...optionalTabId, timeout_ms: z.number().int().positive().optional() },
  'browser.set_files': { ...elementId, files: z.array(z.string().min(1)) },
  'browser.list_tabs': { window_id: z.number().int().optional() },
  'browser.get_page': optionalTabId,
  'browser.get_page_state': optionalTabId,
  'browser.get_interactives': optionalTabId,
  'browser.get_page_content': { ...tabId, include_html: z.boolean().optional(), include_images: z.boolean().optional(), include_frames: z.boolean().optional(), max_text_length: z.number().int().positive().optional() },
  'browser.click': elementId,
  'browser.double_click': elementId,
  'browser.type': { ...elementId, text: z.string() },
  'browser.press': { ...elementId, key: z.string().min(1) },
  'browser.set_checked': { ...elementId, checked: z.boolean() },
  'browser.select_option': { ...elementId, values: z.array(z.string()) },
  'browser.drag': { tab_id: tabId.tab_id, source_element_id: z.string().min(1), target_element_id: z.string().min(1) },
  'browser.wait_for_element': { ...elementId, state: z.enum(['attached', 'detached', 'visible', 'hidden']), timeout_ms: z.number().int().positive().optional() },
  'browser.scroll': { ...tabId, delta_x: z.number(), delta_y: z.number() },
  'browser.screenshot': { ...tabId, image_format: z.enum(['png', 'jpeg']).optional(), full_page: z.boolean().optional(), clip: z.object({ x: z.number(), y: z.number(), width: z.number().positive(), height: z.number().positive(), scale: z.number().positive().optional() }).optional() },
  'browser.observe': { ...tabId, image_format: z.enum(['png', 'jpeg']).optional(), full_page: z.boolean().optional(), clip: z.object({ x: z.number(), y: z.number(), width: z.number().positive(), height: z.number().positive(), scale: z.number().positive().optional() }).optional(), include: z.array(z.enum(['page_state', 'interactives', 'screenshot', 'accessibility'])).optional() },
  'browser.switch_tab': tabId,
  'browser.open': { url: z.string().url(), tab_id: z.number().int().optional(), activate: z.boolean().optional() },
};

export async function startMcpServer(): Promise<void> {
  const server = new McpServer(
    { name: 'agentsurf', version: '0.1.0' },
    {
      instructions: 'AgentSurf controls the user\'s local Chrome. Start with browser_list_tabs. Before element actions, call browser_get_interactives and use its returned opaque element_id; never invent selectors or element IDs. Ask the user before consequential actions such as submitting, purchasing, deleting, uploading, or sending messages.',
    },
  );

  for (const tool of TOOL_NAMES) {
    const mcpName = tool.replaceAll('.', '_');
    server.registerTool(mcpName, {
      title: mcpName,
      description: descriptionFor(tool),
      inputSchema: schemas[tool],
    }, async (args) => {
      try {
        const result = await callLocalBridge(tool, args as ToolRequest['args']);
        return { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }] };
      } catch (error: unknown) {
        const message = error instanceof Error ? error.message : String(error);
        return { isError: true, content: [{ type: 'text', text: `AgentSurf error: ${message}` }] };
      }
    });
  }

  await server.connect(new StdioServerTransport());
}

function descriptionFor(tool: ToolName): string {
  const descriptions: Partial<Record<ToolName, string>> = {
    'browser.get_capabilities': 'Get AgentSurf capabilities and supported browser tools.',
    'browser.list_tabs': 'List Chrome tabs without changing the active tab.',
    'browser.open': 'Open a URL in Chrome or navigate an existing tab.',
    'browser.get_page': 'Read page metadata and viewport state.',
    'browser.get_page_state': 'Read the current page state and revision.',
    'browser.get_interactives': 'List interactive page elements and opaque element IDs.',
    'browser.get_page_content': 'Extract readable page text and optionally HTML, images, and iframe metadata.',
    'browser.get_accessibility_tree': 'Read the Chrome accessibility tree for a tab.',
    'browser.screenshot': 'Capture a screenshot of a Chrome tab.',
    'browser.observe': 'Combine page state, interactive elements, accessibility data, and a screenshot.',
    'browser.click': 'Click an element returned by browser_get_interactives.',
    'browser.type': 'Type into an editable element returned by browser_get_interactives.',
    'browser.press': 'Press a key on an element returned by browser_get_interactives.',
    'browser.set_files': 'Set files on a file input element using absolute local paths.',
  };
  return descriptions[tool] ?? `Run the AgentSurf ${tool} browser operation.`;
}
