import { createToolError, ToolFailure } from '../core/protocol/errors';
import type {
  LoadingStatus,
  OpenArgs,
  TabInfo,
} from '../core/protocol/tool-contract';

export interface TabsAdapter {
  list(windowId?: number): Promise<TabInfo[]>;
  get(tabId: number): Promise<TabInfo>;
  getActive(): Promise<TabInfo>;
  activate(tabId: number): Promise<TabInfo>;
  open(args: OpenArgs): Promise<TabInfo>;
  close(tabId: number): Promise<void>;
  back(tabId: number): Promise<TabInfo>;
  forward(tabId: number): Promise<TabInfo>;
  reload(tabId: number): Promise<TabInfo>;
}

function mapStatus(status: chrome.tabs.Tab['status']): LoadingStatus {
  if (status === 'loading' || status === 'complete') {
    return status;
  }
  return 'unknown';
}

function toTabInfo(tab: chrome.tabs.Tab): TabInfo {
  if (tab.id === undefined) {
    throw new ToolFailure(createToolError('internal_error', 'Chrome returned a Tab without an id.', false));
  }

  return {
    tab_id: tab.id,
    window_id: tab.windowId,
    url: tab.url ?? '',
    title: tab.title ?? '',
    active: tab.active,
    status: mapStatus(tab.status),
    incognito: tab.incognito,
    group_id: tab.groupId === chrome.tabGroups.TAB_GROUP_ID_NONE ? null : tab.groupId,
  };
}

export class ChromeTabsAdapter implements TabsAdapter {
  public async list(windowId?: number): Promise<TabInfo[]> {
    const query = windowId === undefined ? {} : { windowId };
    const tabs = await chrome.tabs.query(query);
    return tabs.map(toTabInfo);
  }

  public async get(tabId: number): Promise<TabInfo> {
    try {
      return toTabInfo(await chrome.tabs.get(tabId));
    } catch (error: unknown) {
      throw new ToolFailure(
        createToolError('tab_not_found', `Tab ${tabId} was not found.`, true, { tab_id: tabId, cause: String(error) }),
      );
    }
  }

  public async getActive(): Promise<TabInfo> {
    const tabs = await chrome.tabs.query({ active: true, lastFocusedWindow: true });
    const activeTab = tabs[0];
    if (activeTab === undefined) {
      throw new ToolFailure(createToolError('tab_not_found', 'No active browser tab was found.', true));
    }
    return toTabInfo(activeTab);
  }

  public async activate(tabId: number): Promise<TabInfo> {
    try {
      const tab = await chrome.tabs.update(tabId, { active: true });
      if (tab === undefined) {
        throw new Error('Chrome returned no tab after activation.');
      }
      return toTabInfo(tab);
    } catch (error: unknown) {
      if (error instanceof ToolFailure) {
        throw error;
      }
      throw new ToolFailure(createToolError('tab_not_found', `Tab ${tabId} could not be activated.`, true));
    }
  }

  public async open(args: OpenArgs): Promise<TabInfo> {
    const activate = args.activate ?? true;
    try {
      if (args.tab_id !== undefined) {
        const updateProperties: chrome.tabs.UpdateProperties = { url: args.url };
        if (activate) {
          updateProperties.active = true;
        }
        const tab = await chrome.tabs.update(args.tab_id, updateProperties);
        if (tab === undefined) {
          throw new Error('Chrome returned no tab after URL update.');
        }
        return toTabInfo(tab);
      }

      const tab = await chrome.tabs.create({ url: args.url, active: activate });
      return toTabInfo(tab);
    } catch (error: unknown) {
      if (error instanceof ToolFailure) {
        throw error;
      }
      throw new ToolFailure(createToolError('tab_not_found', 'The URL could not be opened in Chrome.', true, { cause: String(error) }));
    }
  }

  public async close(tabId: number): Promise<void> {
    try {
      await chrome.tabs.remove(tabId);
    } catch (error: unknown) {
      throw new ToolFailure(createToolError('tab_not_found', `Tab ${tabId} could not be closed.`, true, { cause: String(error) }));
    }
  }

  public async back(tabId: number): Promise<TabInfo> {
    return this.navigateHistory(tabId, 'back');
  }

  public async forward(tabId: number): Promise<TabInfo> {
    return this.navigateHistory(tabId, 'forward');
  }

  public async reload(tabId: number): Promise<TabInfo> {
    try {
      await chrome.tabs.reload(tabId);
      return this.get(tabId);
    } catch (error: unknown) {
      throw new ToolFailure(createToolError('tab_not_found', `Tab ${tabId} could not be reloaded.`, true, { cause: String(error) }));
    }
  }

  private async navigateHistory(tabId: number, direction: 'back' | 'forward'): Promise<TabInfo> {
    try {
      if (direction === 'back') await chrome.tabs.goBack(tabId);
      else await chrome.tabs.goForward(tabId);
      return this.get(tabId);
    } catch (error: unknown) {
      throw new ToolFailure(createToolError(
        'navigation_timeout',
        `Tab ${tabId} could not navigate ${direction}.`,
        true,
        { cause: String(error) },
      ));
    }
  }
}
