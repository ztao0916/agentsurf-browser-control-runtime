import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import { randomUUID } from 'node:crypto';
import { TOOL_NAMES, UNADVERTISED_TOOL_NAMES } from '../core/protocol/schemas';
import { callLocalBridge, LocalBridgeError } from './bridge-client';
import { stripLeadingBom } from './stdio-input';
import { toolSchemas, toContent, descriptionFor } from './tool-definitions';

// One MCP server process serves one conversation (the client spawns a process per conversation), so
// the server can own a session by itself: tabs it opens are claimed and grouped automatically and
// another conversation is refused them, without the agent passing anything. An explicit session_id
// in the tool arguments wins and becomes this conversation's default from then on, which keeps the
// manual handover flow working.
let conversationSessionId = `mcp_${randomUUID()}`;
let conversationSessionName: string | undefined;
const startedSessions = new Set<string>();

/**
 * Created on first use, so a bridge that is not up yet still reports its own error on the real call.
 * A name that only arrives on a later call is sent too: the tab group is normally created by the
 * first claimed tab, so without that follow-up the group would keep its generated title forever.
 */
async function ensureSession(sessionId: string, name?: string): Promise<void> {
  const renamed = name !== undefined && name !== conversationSessionName;
  if (renamed) conversationSessionName = name;
  if (startedSessions.has(sessionId) && !renamed) return;
  try {
    // The id has to travel in args as well as at the request root: browser.start_session reads it
    // from args and would otherwise create a session under a different generated id.
    await callLocalBridge(
      'browser.start_session',
      { session_id: sessionId, ...(name === undefined ? {} : { name }) },
      sessionId,
    );
    startedSessions.add(sessionId);
  } catch {
    // Ignored on purpose: the request that follows returns the actionable error.
  }
}

/** `browser_start_session` may generate the id itself, so adopt whatever it reports back. */
function adoptStartedSession(result: unknown): void {
  if (typeof result !== 'object' || result === null || !('session' in result) ||
    typeof result.session !== 'object' || result.session === null) return;
  const sessionId = 'session_id' in result.session ? result.session.session_id : undefined;
  if (typeof sessionId !== 'string' || sessionId.length === 0) return;
  conversationSessionId = sessionId;
  startedSessions.add(sessionId);
}

/** How long shutdown waits for the release request before the process goes away regardless. */
const SHUTDOWN_RELEASE_TIMEOUT_MS = 1_500;

let releasingOnShutdown = false;

/**
 * A client can end the conversation at any moment, and without this nothing would release the
 * conversation's tabs until the idle timeout fired 30 minutes later, leaving its group in the user's
 * tab bar in the meantime. Best effort and bounded: a bridge that is already gone rejects immediately,
 * a hung request cannot keep the process alive, and a server that never opened a session does nothing.
 */
function releaseSessionOnShutdown(): void {
  if (releasingOnShutdown || startedSessions.size === 0) return;
  releasingOnShutdown = true;
  setTimeout(() => process.exit(0), SHUTDOWN_RELEASE_TIMEOUT_MS).unref();
  void callLocalBridge('browser.reset_sessions', { close_opened_tabs: true }, conversationSessionId)
    .catch(() => undefined)
    .finally(() => process.exit(0));
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
        'browser_list_tabs hides tabs held by another conversation and reports the count instead; a tab that is not yours is refused with tab_in_use.',
        'Ask the user before consequential actions such as submitting, purchasing, deleting, uploading, or sending messages.',
        'This conversation already owns a browser session: tabs you open are claimed and grouped automatically, and another conversation is refused them. Use browser_claim_tab to take over a tab the user already had open; that claims and groups it too.',
        'Pass session_name on any call once you know what the task is: it names this conversation\'s Chrome tab group, so the tab bar reads as the task instead of a generated id. It sticks for the conversation, and without it the group falls back to the first page you touched.',
        'When the browser task is finished, call browser_reset_sessions so the tab group does not linger in the user\'s tab bar: it ungroups, and closes the tabs you opened yourself while leaving the user\'s own tabs open. Report your findings after that, and do not make cleanup the user\'s job.',
      ].join(' '),
    },
  );

  for (const tool of TOOL_NAMES) {
    if (UNADVERTISED_TOOL_NAMES.includes(tool)) continue;
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
        const name = typeof args['session_name'] === 'string' ? args['session_name'] : undefined;
        await ensureSession(conversationSessionId, name);
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

  await server.connect(new StdioServerTransport(stripLeadingBom(process.stdin)));
  // Registered once the server is up: a transport that failed to connect never created a session,
  // so there would be nothing to release. Clients end a conversation either by killing the process
  // or by closing its stdin, so both paths are covered.
  process.once('SIGTERM', releaseSessionOnShutdown);
  process.once('SIGINT', releaseSessionOnShutdown);
  process.stdin.once('end', releaseSessionOnShutdown);
  process.stdin.once('close', releaseSessionOnShutdown);
}

