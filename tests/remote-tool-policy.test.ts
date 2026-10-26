import { describe, expect, it } from 'vitest';
import { buildRemoteToolSchemas } from '../src/mcp/tool-definitions';

describe('remote tool access modes', () => {
  it('keeps read-only tools and session lifecycle while hiding browser changes', () => {
    const tools = buildRemoteToolSchemas('read-only');
    expect(Object.keys(tools)).toContain('browser.start_session');
    expect(Object.keys(tools)).toContain('browser.end_session');
    expect(Object.keys(tools)).toContain('browser.get_operation');
    expect(Object.keys(tools)).toContain('browser.list_tabs');
    expect(Object.keys(tools)).toContain('browser.get_page_content');
    expect(Object.keys(tools)).not.toContain('browser.open');
    expect(Object.keys(tools)).not.toContain('browser.click');
    expect(Object.keys(tools)).not.toContain('browser.type');
  });

  it('keeps interactive tools available in interactive mode', () => {
    const tools = buildRemoteToolSchemas('interactive');
    expect(Object.keys(tools)).toContain('browser.open');
    expect(Object.keys(tools)).toContain('browser.click');
    expect(Object.keys(tools)).toContain('browser.type');
  });
});
