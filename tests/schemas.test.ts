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
});
