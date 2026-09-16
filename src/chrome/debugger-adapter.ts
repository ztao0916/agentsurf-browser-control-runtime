import { createToolError, ToolFailure } from '../core/protocol/errors';

export interface DebuggerAdapter {
  attach(tabId: number): Promise<void>;
  detach(tabId: number): Promise<void>;
  send(tabId: number, method: string, params?: Record<string, unknown>): Promise<unknown>;
}

const CDP_VERSION = '1.3';

export class ChromeDebuggerAdapter implements DebuggerAdapter {
  private readonly attachedTabs = new Set<number>();

  public constructor() {
    chrome.debugger.onDetach.addListener((source) => {
      if (source.tabId !== undefined) this.attachedTabs.delete(source.tabId);
    });
    chrome.tabs.onRemoved.addListener((tabId) => {
      this.attachedTabs.delete(tabId);
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
}
