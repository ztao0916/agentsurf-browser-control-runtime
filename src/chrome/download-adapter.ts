import { createToolError, ToolFailure } from '../core/protocol/errors';
import type { DownloadInfo } from '../core/protocol/tool-contract';

export interface DownloadAdapter {
  list(tabId?: number): Promise<DownloadInfo[]>;
  wait(tabId: number | undefined, timeoutMs: number): Promise<DownloadInfo>;
}

export class ChromeDownloadAdapter implements DownloadAdapter {
  private readonly associatedTabs = new Map<number, number>();

  public async list(tabId?: number): Promise<DownloadInfo[]> {
    const items = await chrome.downloads.search({ orderBy: ['-startTime'], limit: 100 });
    return items
      .filter((item) => tabId === undefined || this.associatedTabs.get(item.id) === tabId)
      .map((item) => toDownloadInfo(item, this.associatedTabs.get(item.id) ?? null));
  }

  public async wait(tabId: number | undefined, timeoutMs: number): Promise<DownloadInfo> {
    const startedAfter = new Date(Date.now() - 5_000).toISOString();
    const existing = (await chrome.downloads.search({ startedAfter, orderBy: ['-startTime'], limit: 20 }))
      .find((item) => tabId === undefined || this.associatedTabs.get(item.id) === tabId);
    if (existing?.state === 'complete' || existing?.state === 'interrupted') {
      return toDownloadInfo(existing, this.associatedTabs.get(existing.id) ?? null);
    }

    return new Promise((resolve, reject) => {
      let candidateId = existing?.id;
      const timeout = setTimeout(() => {
        cleanup();
        reject(new ToolFailure(createToolError('request_timeout', 'Timed out waiting for a download.', true, {
          tab_id: tabId ?? null,
          timeout_ms: timeoutMs,
        })));
      }, timeoutMs);
      const onCreated = (item: chrome.downloads.DownloadItem): void => {
        if (candidateId !== undefined) return;
        candidateId = item.id;
        if (tabId !== undefined) this.associatedTabs.set(item.id, tabId);
      };
      const onChanged = (delta: chrome.downloads.DownloadDelta): void => {
        if (candidateId !== delta.id || delta.state?.current === undefined) return;
        if (delta.state.current !== 'complete' && delta.state.current !== 'interrupted') return;
        void chrome.downloads.search({ id: delta.id }).then((items) => {
          cleanup();
          const item = items[0];
          if (item === undefined) {
            reject(new ToolFailure(createToolError('download_failed', 'Completed download could not be read.', true)));
          } else {
            resolve(toDownloadInfo(item, this.associatedTabs.get(item.id) ?? null));
          }
        });
      };
      const cleanup = (): void => {
        clearTimeout(timeout);
        chrome.downloads.onCreated.removeListener(onCreated);
        chrome.downloads.onChanged.removeListener(onChanged);
      };
      chrome.downloads.onCreated.addListener(onCreated);
      chrome.downloads.onChanged.addListener(onChanged);
    });
  }
}

function toDownloadInfo(item: chrome.downloads.DownloadItem, tabId: number | null): DownloadInfo {
  return {
    download_id: item.id,
    tab_id: tabId,
    url: item.url,
    filename: item.filename,
    mime_type: item.mime,
    state: item.state,
    bytes_received: item.bytesReceived,
    total_bytes: item.totalBytes,
    error: item.error ?? null,
  };
}
