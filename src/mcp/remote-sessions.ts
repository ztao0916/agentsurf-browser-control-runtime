import { randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import type { ToolName, ToolRequest } from '../core/protocol/tool-contract';
import { REMOTE_READ_TOOLS } from '../core/remote-policy';
import { createToolError, ToolFailure } from '../core/protocol/errors';
import { BridgeDeliveryError, LocalBridgeError } from './bridge-client';
import { writePrivateJson } from './remote-config';

interface RemoteSession {
  id: string;
  principal: string;
  start_operation: string;
  state: 'starting' | 'active' | 'ending' | 'ended';
  touched: number;
  uncertain: string[];
}

export interface RemoteSessionStore {
  load(): Promise<RemoteSession[]>;
  save(sessions: RemoteSession[]): Promise<void>;
}

export function fileSessionStore(path: string): RemoteSessionStore {
  return {
    load: async () => {
      try {
        const data: unknown = JSON.parse(await readFile(path, 'utf8'));
        if (!Array.isArray(data) || data.length > 128 || data.some((entry: unknown) => !validSession(entry))) throw new Error('Remote session journal is invalid.');
        return data as RemoteSession[];
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code === 'ENOENT') return [];
        throw error;
      }
    },
    save: (sessions) => writePrivateJson(path, sessions),
  };
}

function validSession(value: unknown): boolean {
  if (typeof value !== 'object' || value === null) return false;
  const v = value as Record<string, unknown>;
  return typeof v.id === 'string' && v.id.startsWith('remote_') && typeof v.principal === 'string' &&
    typeof v.start_operation === 'string' && ['starting', 'active', 'ending', 'ended'].includes(String(v.state)) &&
    typeof v.touched === 'number' && Array.isArray(v.uncertain) && v.uncertain.every((id) => typeof id === 'string');
}

export type RemoteBridgeCall = (tool: ToolName, args: ToolRequest['args'], sessionId: string, operationId?: string) => Promise<unknown>;

/** HTTP connections own no browser state. This registry binds random task handles to principals. */
export class RemoteSessions {
  private readonly sessions = new Map<string, RemoteSession>();
  private readonly queues = new Map<string, { tail: Promise<void>; count: number }>();
  private writes: Promise<void> = Promise.resolve();
  private stopping = false;
  private readonly ready: Promise<void>;

  public constructor(private readonly store: RemoteSessionStore, private readonly bridge: RemoteBridgeCall) {
    this.ready = store.load().then((sessions) => {
      for (const session of sessions) this.sessions.set(session.id, session);
    });
  }

  public async call(principal: string, tool: ToolName, args: Record<string, unknown>, authorized: () => Promise<boolean>): Promise<unknown> {
    await this.ready;
    if (this.stopping || !await authorized()) throw denied();
    const operationId = typeof args.operation_id === 'string' ? args.operation_id : randomUUID();
    let session: RemoteSession;
    if (tool === 'browser.start_session') {
      const existing = [...this.sessions.values()].find((entry) => entry.principal === principal && entry.start_operation === operationId);
      if (existing) {
        if (existing.state === 'ended') throw missing();
        session = existing;
      } else {
        if ([...this.sessions.values()].filter((entry) => entry.state !== 'ended').length >= 32) throw limit();
        if (this.sessions.size >= 128) {
          const ended = [...this.sessions.values()].find((entry) => entry.state === 'ended');
          if (!ended) throw limit();
          this.sessions.delete(ended.id);
        }
        session = { id: `remote_${randomUUID()}`, principal, start_operation: operationId, state: 'starting', touched: Date.now(), uncertain: [] };
        this.sessions.set(session.id, session);
        await this.persist();
      }
    } else {
      const found = typeof args.session_id === 'string' ? this.sessions.get(args.session_id) : undefined;
      if (!found || found.principal !== principal) throw missing();
      session = found;
      if (session.state === 'ended' && tool !== 'browser.get_operation') throw missing();
      if (session.state === 'ending' && tool !== 'browser.get_operation' && tool !== 'browser.end_session') throw missing();
    }
    const forwarded = { ...args };
    delete forwarded.operation_id;
    delete forwarded.session_id;
    if (tool === 'browser.start_session' || tool === 'browser.claim_tab') forwarded.session_id = session.id;
    if (tool === 'browser.get_operation') forwarded.operation_id = operationId;
    // Set ending before awaiting the queue, so later requests cannot overtake an explicit end.
    if (tool === 'browser.end_session') session.state = 'ending';
    const run = async (): Promise<unknown> => {
      if (!await authorized()) throw denied();
      if (session.state === 'ended' && tool !== 'browser.get_operation') throw missing();
      if (Date.now() - session.touched > 30 * 60_000 && tool !== 'browser.end_session' && tool !== 'browser.get_operation') throw missing();
      if (session.uncertain.length > 0 && tool !== 'browser.get_operation' && !REMOTE_READ_TOOLS.includes(tool)) {
        throw new ToolFailure(createToolError('session_busy', 'A prior operation has an unknown outcome. Query it before further changes.', false));
      }
      session.touched = Date.now();
      await this.persist();
      try {
        const result = await this.bridge(tool, forwarded, session.id, tool === 'browser.get_operation' ? undefined : operationId);
        if (tool === 'browser.start_session') session.state = 'active';
        if (tool === 'browser.end_session') session.state = 'ended';
        if (isRecord(result) && (result.state === 'running' || result.state === 'unknown')) {
          if (!session.uncertain.includes(operationId)) session.uncertain.push(operationId);
        }
        if (tool === 'browser.get_operation' && isRecord(result) && result.state === 'completed') {
          session.uncertain = session.uncertain.filter((id) => id !== operationId);
          if (session.state === 'starting') session.state = 'active';
          if (session.state === 'ending') session.state = 'ended';
        }
        await this.persist();
        return redactSessionIds(result, session.id);
      } catch (error) {
        if (error instanceof BridgeDeliveryError && error.dispatched) {
          if (!session.uncertain.includes(operationId)) session.uncertain.push(operationId);
          await this.persist();
          throw new ToolFailure(createToolError('operation_unknown', 'The operation may have executed. Query browser_get_operation; do not replay it.', false,
            { session_id: session.id, operation_id: operationId }));
        }
        if (tool === 'browser.end_session') session.state = 'active';
        if (error instanceof LocalBridgeError) {
          throw new ToolFailure(createToolError(error.toolError.code, remoteErrorMessage(error.toolError.code), false,
            { session_id: session.id, operation_id: operationId }));
        }
        throw error;
      }
    };
    // Status queries must remain usable while a normal request is still waiting for the browser.
    if (tool === 'browser.get_operation') return run();
    return this.enqueue(session.id, run);
  }

  public async sweep(): Promise<void> {
    await this.ready;
    for (const session of this.sessions.values()) {
      if (session.state === 'ended' || session.uncertain.length || this.queues.get(session.id)?.count || Date.now() - session.touched < 30 * 60_000) continue;
      try {
        await this.bridge('browser.end_session', { close_opened_tabs: false }, session.id, `idle_${randomUUID()}`);
        session.state = 'ended';
      } catch { /* Keep protected ownership until the browser confirms release. */ }
    }
    await this.persist();
  }

  public async close(): Promise<void> {
    this.stopping = true;
    await this.ready;
    // In-flight operations keep their ownership. Queued operations recheck authorization/stopping.
    await Promise.race([Promise.all([...this.queues.values()].map((queue) => queue.tail)), new Promise((resolve) => setTimeout(resolve, 2_000))]);
    for (const session of this.sessions.values()) {
      if (session.state === 'ended' || session.uncertain.length || this.queues.get(session.id)?.count) continue;
      try {
        await this.bridge('browser.end_session', { close_opened_tabs: false }, session.id, `shutdown_${randomUUID()}`);
        session.state = 'ended';
      } catch { /* Durable browser-side records and protected leases are retained for recovery. */ }
    }
    await this.persist();
  }

  private async enqueue(id: string, run: () => Promise<unknown>): Promise<unknown> {
    const queue = this.queues.get(id) ?? { tail: Promise.resolve(), count: 0 };
    if (queue.count >= 8) throw limit();
    queue.count++;
    const result = queue.tail.then(async () => {
      if (this.stopping) throw denied();
      return run();
    });
    queue.tail = result.then(() => undefined, () => undefined);
    this.queues.set(id, queue);
    try { return await result; } finally {
      queue.count--;
      if (!queue.count) this.queues.delete(id);
    }
  }

  private persist(): Promise<void> {
    const result = this.writes.then(() => this.store.save([...this.sessions.values()]));
    this.writes = result.catch(() => undefined);
    return result;
  }
}

const missing = () => new ToolFailure(createToolError('session_not_found', 'Task is missing, expired, ended or belongs to another principal. Start a new task explicitly.', false));
const denied = () => new ToolFailure(createToolError('permission_denied', 'Remote access was revoked or the service is stopping.', false));
const limit = () => new ToolFailure(createToolError('resource_limit', 'Remote task or queue limit reached.', false));
const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null;

function remoteErrorMessage(code: string): string {
  if (code === 'tab_in_use') return 'This tab is owned by another task.';
  if (code === 'session_busy') return 'Task has an in-flight or unknown operation. Query its status before continuing.';
  if (code === 'stale_element') return 'Element is stale. Read browser_get_interactives again.';
  if (code === 'bridge_unavailable') return 'Browser extension is offline. Reconnect AgentSurf before issuing another operation.';
  return `Browser returned ${code}. Inspect the page before deciding the next action.`;
}

function redactSessionIds(value: unknown, sessionId: string): unknown {
  if (Array.isArray(value)) return value.map((entry) => redactSessionIds(entry, sessionId));
  if (!isRecord(value)) return value;
  return Object.fromEntries(Object.entries(value).filter(([key]) => key !== 'owning_session_id')
    .map(([key, entry]) => [key, key === 'session_id' ? sessionId : redactSessionIds(entry, sessionId)]));
}
