import { createToolError, ToolFailure } from '../core/protocol/errors';

export interface CdpEvent {
  sequence: number;
  tab_id: number;
  method: string;
  params: unknown;
  timestamp: number;
}

export interface CdpEventsResult {
  cursor: number;
  events: CdpEvent[];
  has_more: boolean;
  truncated: boolean;
}

export interface DebuggerAdapter {
  attach(tabId: number): Promise<void>;
  detach(tabId: number): Promise<void>;
  send(tabId: number, method: string, params?: Record<string, unknown>): Promise<unknown>;
  getEvents(tabId: number, afterSequence: number, limit: number, methods?: string[]): CdpEventsResult;
}

type BufferedEvent = CdpEvent;

const CDP_VERSION = '1.3';
const MAX_EVENTS_PER_TAB = 1_000;

export class ChromeDebuggerAdapter implements DebuggerAdapter {
  private readonly attachedTabs = new Set<number>();
  private readonly events = new Map<number, BufferedEvent[]>();
  private sequence = 0;

  public constructor() {
    chrome.debugger.onEvent.addListener((source, method, params) => {
      if (source.tabId === undefined || !this.attachedTabs.has(source.tabId)) return;
      const events = this.events.get(source.tabId) ?? [];
      events.push({
        sequence: ++this.sequence,
        tab_id: source.tabId,
        method,
        params,
        timestamp: Date.now(),
      });
      if (events.length > MAX_EVENTS_PER_TAB) events.splice(0, events.length - MAX_EVENTS_PER_TAB);
      this.events.set(source.tabId, events);
    });
    chrome.debugger.onDetach.addListener((source) => {
      if (source.tabId !== undefined) this.attachedTabs.delete(source.tabId);
    });
    chrome.tabs.onRemoved.addListener((tabId) => {
      this.attachedTabs.delete(tabId);
      this.events.delete(tabId);
    });
  }

  public async attach(tabId: number): Promise<void> {
    if (this.attachedTabs.has(tabId)) return;
    try {
      await chrome.debugger.attach({ tabId }, CDP_VERSION);
      this.attachedTabs.add(tabId);
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : String(error);
      if (message.includes('Another debugger is already attached')) {
        throw new ToolFailure(createToolError('debugger_unavailable', message, true, { tab_id: tabId }));
      }
      throw new ToolFailure(createToolError(
        'debugger_unavailable',
        `Chrome debugger could not attach to tab ${tabId}.`,
        true,
        { tab_id: tabId, cause: message },
      ));
    }
  }

  public async detach(tabId: number): Promise<void> {
    if (!this.attachedTabs.has(tabId)) return;
    try {
      await chrome.debugger.detach({ tabId });
    } catch (error: unknown) {
      throw new ToolFailure(createToolError(
        'debugger_unavailable',
        `Chrome debugger could not detach from tab ${tabId}.`,
        true,
        { tab_id: tabId, cause: String(error) },
      ));
    } finally {
      this.attachedTabs.delete(tabId);
    }
  }

  public async send(tabId: number, method: string, params: Record<string, unknown> = {}): Promise<unknown> {
    await this.attach(tabId);
    try {
      return await chrome.debugger.sendCommand({ tabId }, method, params);
    } catch (error: unknown) {
      throw new ToolFailure(createToolError(
        'cdp_error',
        `CDP command ${method} failed.`,
        true,
        { tab_id: tabId, method, cause: String(error) },
      ));
    }
  }

  public getEvents(tabId: number, afterSequence: number, limit: number, methods?: string[]): CdpEventsResult {
    const all = this.events.get(tabId) ?? [];
    const earliest = all[0]?.sequence ?? this.sequence + 1;
    const filtered = all.filter((event) => event.sequence > afterSequence &&
      (methods === undefined || methods.includes(event.method)));
    const events = filtered.slice(0, limit);
    return {
      cursor: events.at(-1)?.sequence ?? afterSequence,
      events,
      has_more: filtered.length > events.length,
      truncated: afterSequence > 0 && afterSequence < earliest - 1,
    };
  }
}
