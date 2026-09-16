import { describe, expect, it } from 'vitest';
import { ToolFailure } from '../src/core/protocol/errors';
import { parseToolRequest } from '../src/core/protocol/schemas';

describe('tool contract schemas', () => {
  it('parses a list tabs request', () => {
    const request = parseToolRequest({
      kind: 'tool-request',
      protocol_version: '1',
      request_id: 'request-1',
      tool: 'browser.list_tabs',
      args: {},
    });

    expect(request.tool).toBe('browser.list_tabs');
    expect(request.args).toEqual({});
  });

  it('rejects unsupported tools', () => {
    expect(() =>
      parseToolRequest({
        kind: 'tool-request',
        protocol_version: '1',
        request_id: 'request-1',
        tool: 'browser.unknown',
        args: {},
      }),
    ).toThrow(ToolFailure);
  });

  it('parses download and file input requests', () => {
    expect(parseToolRequest({
      kind: 'tool-request',
      protocol_version: '1',
      request_id: 'downloads',
      tool: 'browser.list_downloads',
      args: { tab_id: 42 },
    }).args).toEqual({ tab_id: 42 });
    expect(parseToolRequest({
      kind: 'tool-request',
      protocol_version: '1',
      request_id: 'files',
      tool: 'browser.set_files',
      args: { tab_id: 42, element_id: 'opaque', files: ['C:/tmp/file.txt'] },
    }).args).toEqual({ tab_id: 42, element_id: 'opaque', files: ['C:/tmp/file.txt'] });
  });

  it('parses a get interactives request', () => {
    const request = parseToolRequest({
      kind: 'tool-request',
      protocol_version: '1',
      request_id: 'request-2',
      tool: 'browser.get_interactives',
      args: { tab_id: 42 },
    });

    expect(request.tool).toBe('browser.get_interactives');
    expect(request.args).toEqual({ tab_id: 42 });
  });

  it('parses click, type, and scroll arguments', () => {
    expect(
      parseToolRequest({
        kind: 'tool-request',
        protocol_version: '1',
        request_id: 'click',
        tool: 'browser.click',
        args: { tab_id: 1, element_id: 'opaque' },
      }).args,
    ).toEqual({ tab_id: 1, element_id: 'opaque' });
    expect(
      parseToolRequest({
        kind: 'tool-request',
        protocol_version: '1',
        request_id: 'type',
        tool: 'browser.type',
        args: { tab_id: 1, element_id: 'opaque', text: '' },
      }).args,
    ).toEqual({ tab_id: 1, element_id: 'opaque', text: '' });
    expect(
      parseToolRequest({
        kind: 'tool-request',
        protocol_version: '1',
        request_id: 'scroll',
        tool: 'browser.scroll',
        args: { tab_id: 1, delta_x: 0, delta_y: 500 },
      }).args,
    ).toEqual({ tab_id: 1, delta_x: 0, delta_y: 500 });
  });

  it('defaults screenshot format when omitted and accepts jpeg', () => {
    const png = parseToolRequest({
      kind: 'tool-request',
      protocol_version: '1',
      request_id: 'screenshot-png',
      tool: 'browser.screenshot',
      args: { tab_id: 1 },
    });
    const jpeg = parseToolRequest({
      kind: 'tool-request',
      protocol_version: '1',
      request_id: 'screenshot-jpeg',
      tool: 'browser.screenshot',
      args: { tab_id: 1, image_format: 'jpeg' },
    });
    expect(png.args).toEqual({ tab_id: 1 });
    expect(jpeg.args).toEqual({ tab_id: 1, image_format: 'jpeg' });
  });

  it('rejects a non-http URL only at runtime, preserving a valid request shape', () => {
    const request = parseToolRequest({
      kind: 'tool-request',
      protocol_version: '1',
      request_id: 'request-1',
      tool: 'browser.open',
      args: { url: 'javascript:alert(1)' },
    });

    expect(request.args).toEqual({ url: 'javascript:alert(1)' });
  });

  it('parses modifier keys and rejects unsupported modifiers', () => {
    expect(parseToolRequest({
      kind: 'tool-request',
      protocol_version: '1',
      request_id: 'press',
      tool: 'browser.press',
      args: { tab_id: 1, element_id: 'opaque', key: 'a', modifiers: ['Control'] },
    }).args).toEqual({ tab_id: 1, element_id: 'opaque', key: 'a', modifiers: ['Control'] });

    expect(parseToolRequest({
      kind: 'tool-request',
      protocol_version: '1',
      request_id: 'press-key',
      tool: 'browser.press_key',
      args: { tab_id: 1, key: 'Enter' },
    }).args).toEqual({ tab_id: 1, key: 'Enter' });

    expect(parseToolRequest({
      kind: 'tool-request',
      protocol_version: '1',
      request_id: 'click-at',
      tool: 'browser.click_at',
      args: { tab_id: 1, x: 10, y: 20, modifiers: ['Shift'] },
    }).args).toEqual({ tab_id: 1, x: 10, y: 20, modifiers: ['Shift'] });

    expect(() => parseToolRequest({
      kind: 'tool-request',
      protocol_version: '1',
      request_id: 'click',
      tool: 'browser.click',
      args: { tab_id: 1, element_id: 'opaque', modifiers: ['Hyper'] },
    })).toThrow(ToolFailure);
  });

  it('parses select_text and requires text for a text selection', () => {
    expect(parseToolRequest({
      kind: 'tool-request',
      protocol_version: '1',
      request_id: 'select-text',
      tool: 'browser.select_text',
      args: { tab_id: 1, element_id: 'opaque', text: 'hello' },
    }).args).toEqual({ tab_id: 1, element_id: 'opaque', text: 'hello', selection_type: 'text' });

    expect(parseToolRequest({
      kind: 'tool-request',
      protocol_version: '1',
      request_id: 'cursor',
      tool: 'browser.select_text',
      args: { tab_id: 1, element_id: 'opaque', selection_type: 'cursor_after' },
    }).args).toEqual({ tab_id: 1, element_id: 'opaque', selection_type: 'cursor_after' });

    expect(() => parseToolRequest({
      kind: 'tool-request',
      protocol_version: '1',
      request_id: 'missing-text',
      tool: 'browser.select_text',
      args: { tab_id: 1, element_id: 'opaque' },
    })).toThrow(ToolFailure);
  });

  it('parses frame targeting and omits frame_id when it is not given', () => {
    expect(parseToolRequest({
      kind: 'tool-request',
      protocol_version: '1',
      request_id: 'frames',
      tool: 'browser.get_frames',
      args: { tab_id: 3 },
    }).args).toEqual({ tab_id: 3 });

    // Frame 0 is the top document, so it must survive parsing as an explicit value.
    expect(parseToolRequest({
      kind: 'tool-request',
      protocol_version: '1',
      request_id: 'frame-zero',
      tool: 'browser.get_interactives',
      args: { tab_id: 3, frame_id: 0 },
    }).args).toEqual({ tab_id: 3, frame_id: 0 });

    expect(parseToolRequest({
      kind: 'tool-request',
      protocol_version: '1',
      request_id: 'frame-iframe',
      tool: 'browser.click',
      args: { tab_id: 3, element_id: 'opaque', frame_id: 9 },
    }).args).toEqual({ tab_id: 3, element_id: 'opaque', frame_id: 9 });

    expect(parseToolRequest({
      kind: 'tool-request',
      protocol_version: '1',
      request_id: 'frame-default',
      tool: 'browser.get_interactives',
      args: { tab_id: 3 },
    }).args).toEqual({ tab_id: 3 });

    expect(() => parseToolRequest({
      kind: 'tool-request',
      protocol_version: '1',
      request_id: 'frame-negative',
      tool: 'browser.get_interactives',
      args: { tab_id: 3, frame_id: -1 },
    })).toThrow(ToolFailure);
  });

  it('parses element filters and rejects a non-positive limit', () => {
    expect(parseToolRequest({
      kind: 'tool-request',
      protocol_version: '1',
      request_id: 'filters',
      tool: 'browser.get_interactives',
      args: { tab_id: 3, limit: 20, visible_only: true, tag: 'button', name_contains: 'save' },
    }).args).toEqual({ tab_id: 3, limit: 20, visible_only: true, tag: 'button', name_contains: 'save' });

    // No filters means the runtime keeps its own default instead of inventing fields.
    expect(parseToolRequest({
      kind: 'tool-request',
      protocol_version: '1',
      request_id: 'no-filters',
      tool: 'browser.get_interactives',
      args: { tab_id: 3 },
    }).args).toEqual({ tab_id: 3 });

    expect(() => parseToolRequest({
      kind: 'tool-request',
      protocol_version: '1',
      request_id: 'bad-limit',
      tool: 'browser.get_interactives',
      args: { tab_id: 3, limit: 0 },
    })).toThrow(ToolFailure);
  });
});
