import { createToolError, ToolFailure } from '../core/protocol/errors';
import type { FrameInfo } from '../core/protocol/tool-contract';

export interface FrameAdapter {
  list(tabId: number): Promise<FrameInfo[]>;
}

/**
 * Frame IDs come from `chrome.webNavigation`, which also reports the parent of every frame. Frame 0
 * is the top document. IDs survive in-page navigations only while the frame stays in the same
 * process, so callers must treat `frame_not_found` as retryable.
 */
export class ChromeFrameAdapter implements FrameAdapter {
  public async list(tabId: number): Promise<FrameInfo[]> {
    let frames: chrome.webNavigation.GetAllFrameResultDetails[] | null;
    try {
      frames = await chrome.webNavigation.getAllFrames({ tabId });
    } catch (error: unknown) {
      throw new ToolFailure(createToolError('tab_not_found', `Tab ${tabId} was not found.`, true, {
        tab_id: tabId,
        cause: String(error),
      }));
    }
    if (frames === null) {
      throw new ToolFailure(createToolError('tab_not_found', `Tab ${tabId} was not found.`, true, { tab_id: tabId }));
    }
    return frames.map((frame) => ({
      frame_id: frame.frameId,
      parent_frame_id: frame.parentFrameId < 0 ? null : frame.parentFrameId,
      url: frame.url,
      is_top: frame.frameId === 0,
    }));
  }
}
