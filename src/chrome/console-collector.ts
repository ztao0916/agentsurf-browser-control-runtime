import type { SessionCoordinator } from '../core/session/session-coordinator';

const COLLECTOR_FILE = 'content/page-console.js';

/**
 * The collector replaces the page's own `console` methods, and Chrome then blames this extension for
 * everything that goes through them: the wrapper is the script that calls the real method, so the
 * page's own `console.error` calls end up on the extension's error page. It is therefore installed
 * only on tabs a session drives, and only for as long as that document lives — a page the agent never
 * touches keeps its real console untouched.
 */
export class ChromeConsoleCollector {
  public constructor(private readonly sessions: SessionCoordinator) {
    chrome.webNavigation.onCommitted.addListener((details) => {
      void this.install(details.tabId, details.frameId);
    });
  }

  /**
   * Best effort: a page CSP can block MAIN-world injection, and the tool then reports
   * `available: false` instead. Without a frame id every frame is covered, which is what a freshly
   * claimed tab needs; a frame commit only covers the frame that just loaded, which is also how
   * iframes appearing after the top document get collected.
   */
  public async install(tabId: number, frameId?: number): Promise<void> {
    try {
      const leases = await this.sessions.listLeases();
      if (!leases.has(tabId)) return;
      await chrome.scripting.executeScript({
        target: frameId === undefined ? { tabId, allFrames: true } : { tabId, frameIds: [frameId] },
        files: [COLLECTOR_FILE],
        world: 'MAIN',
      });
    } catch {
      // Never let a best-effort console collector break a navigation or a tool call.
    }
  }
}
