import { createToolError, ToolFailure } from '../core/protocol/errors';
import type { ImageFormat, TabInfo } from '../core/protocol/tool-contract';
import type { DebuggerAdapter } from './debugger-adapter';

export interface CapturedScreenshot {
  width: number;
  height: number;
  mimeType: 'image/png' | 'image/jpeg';
  imageData: string;
}

export interface ScreenshotAdapter {
  /**
   * Implementations that cannot target a tab directly (e.g. captureVisibleTab) must reject an
   * inactive tab with `screenshot_unavailable` instead of capturing whatever is on screen.
   */
  capture(tab: TabInfo, format: ImageFormat, options?: ScreenshotCaptureOptions): Promise<CapturedScreenshot>;
}

export interface ScreenshotCaptureOptions {
  fullPage?: boolean;
  clip?: { x: number; y: number; width: number; height: number; scale?: number };
}

export class ChromeScreenshotAdapter implements ScreenshotAdapter {
  public constructor(private readonly debuggerAdapter?: DebuggerAdapter) {}

  public async capture(tab: TabInfo, format: ImageFormat, options: ScreenshotCaptureOptions = {}): Promise<CapturedScreenshot> {
    if (this.debuggerAdapter !== undefined) return this.captureWithDebugger(tab, format, options);
    if (!tab.active) {
      throw screenshotFailure('The requested tab is not active. Screenshot capture will not switch tabs.', true);
    }

    try {
      const imageData = await chrome.tabs.captureVisibleTab(tab.window_id, { format });
      const activeTabs = await chrome.tabs.query({ active: true, windowId: tab.window_id });
      if (activeTabs[0]?.id !== tab.tab_id) {
        throw screenshotFailure('The active tab changed during screenshot capture.', true);
      }
      const mimeType = format === 'png' ? 'image/png' : 'image/jpeg';
      const dimensions = readImageDimensions(imageData, format);
      return { ...dimensions, mimeType, imageData };
    } catch (error: unknown) {
      if (error instanceof ToolFailure) throw error;
      throw screenshotFailure('Chrome could not capture the visible tab.', true, { cause: String(error) });
    }
  }

  private async captureWithDebugger(
    tab: TabInfo,
    format: ImageFormat,
    options: ScreenshotCaptureOptions,
  ): Promise<CapturedScreenshot> {
    const metrics = await this.debuggerAdapter?.send(tab.tab_id, 'Page.getLayoutMetrics');
    const dimensions = getCdpDimensions(metrics, options);
    const clip = options.clip ?? (options.fullPage ? getContentClip(metrics) : undefined);
    const response = await this.debuggerAdapter?.send(tab.tab_id, 'Page.captureScreenshot', {
      format,
      fromSurface: true,
      captureBeyondViewport: options.fullPage === true || clip !== undefined,
      ...(clip === undefined ? {} : { clip: { ...clip, scale: clip.scale ?? 1 } }),
    });
    if (!isRecord(response) || typeof response.data !== 'string') {
      throw screenshotFailure('Chrome returned invalid CDP screenshot data.', true);
    }
    const imageData = `data:image/${format};base64,${response.data}`;
    const decodedDimensions = readImageDimensions(imageData, format);
    return {
      width: decodedDimensions.width || dimensions.width,
      height: decodedDimensions.height || dimensions.height,
      mimeType: format === 'png' ? 'image/png' : 'image/jpeg',
      imageData,
    };
  }
}

function getCdpDimensions(value: unknown, options: ScreenshotCaptureOptions): { width: number; height: number } {
  if (options.clip !== undefined) {
    const scale = options.clip.scale ?? 1;
    return { width: Math.round(options.clip.width * scale), height: Math.round(options.clip.height * scale) };
  }
  if (!isRecord(value)) return { width: 0, height: 0 };
  const area = options.fullPage ? value.cssContentSize : value.cssVisualViewport;
  if (!isRecord(area) || typeof area.width !== 'number' && typeof area.clientWidth !== 'number' ||
    typeof area.height !== 'number' && typeof area.clientHeight !== 'number') {
    return { width: 0, height: 0 };
  }
  return {
    width: Math.round(typeof area.width === 'number' ? area.width : area.clientWidth as number),
    height: Math.round(typeof area.height === 'number' ? area.height : area.clientHeight as number),
  };
}

function getContentClip(value: unknown): ScreenshotCaptureOptions['clip'] {
  if (!isRecord(value) || !isRecord(value.cssContentSize)) return undefined;
  const size = value.cssContentSize;
  if (typeof size.width !== 'number' || typeof size.height !== 'number') return undefined;
  return { x: 0, y: 0, width: size.width, height: size.height, scale: 1 };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function readImageDimensions(imageData: string, format: ImageFormat): { width: number; height: number } {
  const match = /^data:image\/(png|jpeg);base64,(.+)$/u.exec(imageData);
  if (match?.[1] === undefined || match[2] === undefined || match[1] !== format) {
    throw screenshotFailure('Chrome returned invalid screenshot data.', true);
  }
  const bytes = decodeBase64(match[2]);
  const dimensions = format === 'png' ? readPngDimensions(bytes) : readJpegDimensions(bytes);
  if (dimensions === null) {
    throw screenshotFailure('Chrome returned an unreadable screenshot.', true);
  }
  return dimensions;
}

function decodeBase64(value: string): Uint8Array {
  const binary = atob(value);
  return Uint8Array.from(binary, (character) => character.charCodeAt(0));
}

function readPngDimensions(bytes: Uint8Array): { width: number; height: number } | null {
  if (bytes.length < 24 || bytes[0] !== 0x89 || bytes[1] !== 0x50 || bytes[2] !== 0x4e || bytes[3] !== 0x47) {
    return null;
  }
  return { width: readUint32(bytes, 16), height: readUint32(bytes, 20) };
}

function readJpegDimensions(bytes: Uint8Array): { width: number; height: number } | null {
  if (bytes[0] !== 0xff || bytes[1] !== 0xd8) return null;
  let offset = 2;
  while (offset + 8 < bytes.length) {
    if (bytes[offset] !== 0xff) {
      offset += 1;
      continue;
    }
    const marker = bytes[offset + 1];
    if (marker === undefined) return null;
    if (isStartOfFrame(marker)) {
      return { height: readUint16(bytes, offset + 5), width: readUint16(bytes, offset + 7) };
    }
    const segmentLength = readUint16(bytes, offset + 2);
    if (segmentLength < 2) return null;
    offset += 2 + segmentLength;
  }
  return null;
}

function isStartOfFrame(marker: number): boolean {
  return marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc;
}

function readUint16(bytes: Uint8Array, offset: number): number {
  return ((bytes[offset] ?? 0) << 8) | (bytes[offset + 1] ?? 0);
}

function readUint32(bytes: Uint8Array, offset: number): number {
  return (((bytes[offset] ?? 0) << 24) >>> 0) +
    ((bytes[offset + 1] ?? 0) << 16) +
    ((bytes[offset + 2] ?? 0) << 8) +
    (bytes[offset + 3] ?? 0);
}

function screenshotFailure(message: string, retryable: boolean, details?: Record<string, unknown>): ToolFailure {
  return new ToolFailure(createToolError('screenshot_unavailable', message, retryable, details));
}
