import { canonicalJson, REMOTE_EXCLUDED_TOOLS, REMOTE_READ_TOOLS } from './remote-policy';
import { createToolError, ToolFailure, toToolError } from './protocol/errors';
import type { OperationResult, ToolRequest, ToolResponse } from './protocol/tool-contract';
import type { SessionCoordinator } from './session/session-coordinator';

interface OperationRecord {
  id: string;
  fingerprint: string;
  state: OperationResult['state'];
}

export interface RemoteTaskRecord {
  id: string;
  state: 'active' | 'ending' | 'ended';
  operations: OperationRecord[];
}

export interface RemoteExecutionStore {
  load(): Promise<RemoteTaskRecord[]>;
  save(tasks: RemoteTaskRecord[]): Promise<void>;
}

const MAX_TASKS = 128;
const MAX_OPERATIONS = 512;
const CACHE_BYTES = 2 * 1024 * 1024;

/** Browser-side journal. Persist only identifiers, hashes and states, never page data or input text.
 * A worker restart makes unfinished operations unknown. Protected leases survive that restart.
 */
export class RemoteExecutionRuntime {
  private readonly tasks = new Map<string, RemoteTaskRecord>();
  private readonly results = new Map<string, { response: ToolResponse; expires: number; bytes: number }>();
  private cacheBytes = 0;
  private initialized: Promise<void> | undefined;
  private journalQueue: Promise<void> = Promise.resolve();

  public constructor(
    private readonly sessions: SessionCoordinator,
    private readonly store: RemoteExecutionStore,
    private readonly execute: (request: ToolRequest) => Promise<ToolResponse>,
  ) {}

  public async handle(request: ToolRequest): Promise<ToolResponse> {
    try {
      await (this.initialized ??= this.load());
      return await this.process(request);
    } catch (error) {
      return { kind: 'tool-response', protocol_version: '1', request_id: request.request_id, ok: false, error: toToolError(error) };
    }
  }

  private async load(): Promise<void> {
    for (const task of await this.store.load()) {
      for (const op of task.operations) if (op.state === 'running') op.state = 'unknown';
      this.tasks.set(task.id, task);
    }
    await this.persist();
  }

  private async process(request: ToolRequest): Promise<ToolResponse> {
    const sessionId = request.session_id;
    if (!request.remote || !sessionId?.startsWith('remote_') || !this.sessions.protect || !this.sessions.has || !this.sessions.endRemote) {
      throw failure('permission_denied', 'Remote execution requires a server-generated task and an updated extension.');
    }
    if (REMOTE_EXCLUDED_TOOLS.includes(request.tool) || 'force' in request.args || 'include_all' in request.args ||
      ('session_id' in request.args && request.args.session_id !== sessionId)) {
      throw failure('permission_denied', 'Cross-task and local-file parameters are not available remotely.');
    }
    let task = this.tasks.get(sessionId);
    if (request.tool === 'browser.get_operation') {
      const op = task?.operations.find((item) => item.id === request.args.operation_id);
      if (!task || !op) throw failure('invalid_request', 'Operation was not found in this task. Do not repeat an unknown action.');
      const response = this.cached(sessionId, op.id);
      return success(request, { operation_id: op.id, state: op.state,
        ...(response === undefined ? {} : { response: response.ok ? { ok: true, result: response.result } : { ok: false, error: response.error } }) });
    }
    const operationId = request.operation_id ?? request.turn_id ?? request.request_id;
    if (!operationId || operationId.length > 128) throw failure('invalid_request', 'operation_id is required.');
    const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(canonicalJson({ tool: request.tool, args: request.args })));
    const fingerprint = [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, '0')).join('');
    // No await between checking and reserving an operation: concurrent duplicates cannot dispatch twice.
    const existing = task?.operations.find((item) => item.id === operationId);
    if (existing) {
      if (existing.fingerprint !== fingerprint) throw failure('operation_conflict', 'operation_id was already used with different arguments.');
      const cached = this.cached(sessionId, operationId);
      if (cached) return { ...cached, request_id: request.request_id };
      return success(request, { operation_id: operationId, state: existing.state, result_available: false });
    }
    if (request.tool === 'browser.start_session') {
      if (task) throw failure('session_not_found', 'This task cannot be started again.');
      if (this.tasks.size >= MAX_TASKS) {
        const ended = [...this.tasks.values()].find((entry) => entry.state === 'ended');
        if (ended) this.tasks.delete(ended.id);
        else throw failure('resource_limit', 'Too many retained browser tasks. End existing tasks first.');
      }
      task = { id: sessionId, state: 'active', operations: [] };
      this.tasks.set(sessionId, task);
    } else if (!task || task.state === 'ended' || (task.state === 'ending' && request.tool !== 'browser.end_session')) {
      throw failure('session_not_found', 'Task is missing, ended or ending. Explicitly start a new task.');
    }
    if (!task) throw failure('session_not_found', 'Task was not found.');
    const pending = task.operations.some((op) => op.state !== 'completed');
    if (pending && !REMOTE_READ_TOOLS.includes(request.tool)) {
      throw failure('session_busy', 'A prior operation is running or unknown. Query it and observe the page; do not replay it.');
    }
    if (task.operations.length >= MAX_OPERATIONS) throw failure('resource_limit', 'Task operation limit reached. End it and start another task.');
    const operation: OperationRecord = { id: operationId, fingerprint, state: 'running' };
    task.operations.push(operation);
    if (request.tool === 'browser.end_session') task.state = 'ending';
    // Journal before dispatch. A failed write must never reach the browser.
    await this.persist();
    let response: ToolResponse;
    try {
      if (request.tool === 'browser.start_session') {
        response = await this.execute(request);
        if (response.ok) await this.sessions.protect(sessionId, true);
      } else {
        if (!await this.sessions.has(sessionId)) throw failure('session_not_found', 'Browser task no longer exists; it will not be recreated.');
        if (request.tool === 'browser.end_session') {
          const result = await this.sessions.endRemote(sessionId, request.args.close_opened_tabs ?? false);
          task.state = 'ended';
          response = success(request, { ended: true, released_tab_ids: result.releasedTabIds });
        } else {
          // All remote page targets must be claimed before executing, including reads of free tabs.
          if ('tab_id' in request.args && typeof request.args.tab_id === 'number') {
            await this.sessions.claim(sessionId, undefined, request.args.tab_id, 'user', true);
          }
          response = await this.execute(request);
        }
      }
    } catch (error) {
      response = { kind: 'tool-response', protocol_version: '1', request_id: request.request_id, ok: false, error: toToolError(error) };
    }
    operation.state = 'completed';
    // Reserve capacity for end_session even when the normal operation budget is exhausted.
    if (request.tool === 'browser.end_session' && !response.ok) task.state = 'active';
    try {
      await this.persist();
    } catch {
      operation.state = 'unknown';
      throw failure('operation_unknown', 'Execution may have finished but its final state could not be saved. Do not replay.');
    }
    this.cache(sessionId, operationId, response);
    return response;
  }

  private persist(): Promise<void> {
    const result = this.journalQueue.then(() => this.store.save([...this.tasks.values()]));
    this.journalQueue = result.catch(() => undefined);
    return result;
  }

  private cached(sessionId: string, operationId: string): ToolResponse | undefined {
    const key = `${sessionId}:${operationId}`;
    const cached = this.results.get(key);
    if (!cached) return undefined;
    if (cached.expires < Date.now()) {
      this.results.delete(key);
      this.cacheBytes -= cached.bytes;
      return undefined;
    }
    return cached.response;
  }

  private cache(sessionId: string, operationId: string, response: ToolResponse): void {
    const bytes = new TextEncoder().encode(JSON.stringify(response)).length;
    if (bytes > CACHE_BYTES) return;
    while (this.cacheBytes + bytes > CACHE_BYTES || this.results.size >= 64) {
      const first = this.results.entries().next().value as [string, { bytes: number }] | undefined;
      if (!first) break;
      this.results.delete(first[0]);
      this.cacheBytes -= first[1].bytes;
    }
    this.results.set(`${sessionId}:${operationId}`, { response, expires: Date.now() + 5 * 60_000, bytes });
    this.cacheBytes += bytes;
  }
}

function failure(code: Parameters<typeof createToolError>[0], message: string): ToolFailure {
  return new ToolFailure(createToolError(code, message, false));
}

function success(request: ToolRequest, result: unknown): ToolResponse {
  return { kind: 'tool-response', protocol_version: '1', request_id: request.request_id, ok: true, result } as ToolResponse;
}
