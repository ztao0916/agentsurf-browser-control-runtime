import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ChromeScreenshotAdapter } from '../src/chrome/screenshot-adapter';
import { ToolFailure } from '../src/core/protocol/errors';
import type { TabInfo } from '../src/core/protocol/tool-contract';

const tab: TabInfo = {
  tab_id: 12,
  window_id: 4,
  url: 'https://example.com',
  title: 'Example',
  active: true,
  status: 'complete',
  incognito: false,
  group_id: null,
};

beforeEach(() => {
  vi.unstubAllGlobals();
});

describe('ChromeScreenshotAdapter', () => {
  it('captures PNG data with the correct mime type and dimensions', async () => {
    const captureVisibleTab = vi.fn().mockResolvedValue(createPngDataUrl(640, 480));
    stubChrome(captureVisibleTab);
    const result = await new ChromeScreenshotAdapter().capture(tab, 'png');
    expect(captureVisibleTab).toHaveBeenCalledWith(4, { format: 'png' });
    expect(result).toMatchObject({ width: 640, height: 480, mimeType: 'image/png' });
    expect(result.imageData).toMatch(/^data:image\/png;base64,/u);
  });

  it('reads JPEG dimensions and mime type', async () => {
    const captureVisibleTab = vi.fn().mockResolvedValue(createJpegDataUrl(800, 600));
    stubChrome(captureVisibleTab);
    const result = await new ChromeScreenshotAdapter().capture(tab, 'jpeg');
    expect(result).toMatchObject({ width: 800, height: 600, mimeType: 'image/jpeg' });
  });

  it('returns screenshot_unavailable when Chrome capture fails', async () => {
    stubChrome(vi.fn().mockRejectedValue(new Error('capture failed')));
    await expectToolError(new ChromeScreenshotAdapter().capture(tab, 'png'), 'screenshot_unavailable');
  });

  it('does not switch or capture an inactive tab', async () => {
    const captureVisibleTab = vi.fn();
    stubChrome(captureVisibleTab);
    await expectToolError(new ChromeScreenshotAdapter().capture({ ...tab, active: false }, 'png'), 'screenshot_unavailable');
    expect(captureVisibleTab).not.toHaveBeenCalled();
  });
});

function stubChrome(captureVisibleTab: ReturnType<typeof vi.fn>): void {
  vi.stubGlobal('chrome', {
    tabs: {
      captureVisibleTab,
      query: vi.fn().mockResolvedValue([{ id: tab.tab_id }]),
    },
  });
}

function createPngDataUrl(width: number, height: number): string {
  const bytes = new Uint8Array(24);
  bytes.set([0x89, 0x50, 0x4e, 0x47], 0);
  writeUint32(bytes, 16, width);
  writeUint32(bytes, 20, height);
  return toDataUrl('image/png', bytes);
}

function createJpegDataUrl(width: number, height: number): string {
  const bytes = new Uint8Array([0xff, 0xd8, 0xff, 0xc0, 0x00, 0x11, 0x08, 0, 0, 0, 0, 0x03]);
  writeUint16(bytes, 7, height);
  writeUint16(bytes, 9, width);
  return toDataUrl('image/jpeg', bytes);
}

function writeUint16(bytes: Uint8Array, offset: number, value: number): void {
  bytes[offset] = (value >>> 8) & 0xff;
  bytes[offset + 1] = value & 0xff;
}

function writeUint32(bytes: Uint8Array, offset: number, value: number): void {
  bytes[offset] = (value >>> 24) & 0xff;
  bytes[offset + 1] = (value >>> 16) & 0xff;
  bytes[offset + 2] = (value >>> 8) & 0xff;
  bytes[offset + 3] = value & 0xff;
}

function toDataUrl(mimeType: string, bytes: Uint8Array): string {
  return `data:${mimeType};base64,${Buffer.from(bytes).toString('base64')}`;
}

async function expectToolError(promise: Promise<unknown>, code: string): Promise<void> {
  try {
    await promise;
    throw new Error('Expected promise to reject.');
  } catch (error: unknown) {
    expect(error).toBeInstanceOf(ToolFailure);
    if (error instanceof ToolFailure) expect(error.toolError.code).toBe(code);
  }
}
