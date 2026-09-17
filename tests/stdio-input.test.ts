import { Readable } from 'node:stream';
import { describe, expect, it } from 'vitest';
import { stripLeadingBom } from '../src/mcp/stdio-input';

async function collect(stream: Readable): Promise<string> {
  const chunks: Buffer[] = [];
  for await (const chunk of stream) chunks.push(Buffer.from(chunk as Buffer));
  return Buffer.concat(chunks).toString('utf8');
}

describe('stripLeadingBom', () => {
  it('drops a BOM in front of the first message', async () => {
    const source = Readable.from([Buffer.from('\uFEFF{"jsonrpc":"2.0","id":1}\n', 'utf8')]);

    await expect(collect(stripLeadingBom(source))).resolves.toBe('{"jsonrpc":"2.0","id":1}\n');
  });

  it('passes a stream without a BOM through unchanged', async () => {
    const source = Readable.from([Buffer.from('{"jsonrpc":"2.0","id":1}\n', 'utf8')]);

    await expect(collect(stripLeadingBom(source))).resolves.toBe('{"jsonrpc":"2.0","id":1}\n');
  });

  it('keeps later chunks intact, including a BOM that is not the first byte', async () => {
    const source = Readable.from([
      Buffer.from('first\n', 'utf8'),
      Buffer.from('\uFEFFsecond\n', 'utf8'),
    ]);

    await expect(collect(stripLeadingBom(source))).resolves.toBe('first\n\uFEFFsecond\n');
  });
});
