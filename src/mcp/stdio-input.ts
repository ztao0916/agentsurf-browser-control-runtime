import { PassThrough } from 'node:stream';
import type { Readable } from 'node:stream';

const UTF8_BOM = Buffer.from([0xef, 0xbb, 0xbf]);

/**
 * Chrome's Native Messaging host is launched through a .NET launcher, and on that path the MCP
 * client's first message reaches stdin with a leading UTF-8 BOM. The SDK splits stdin on newlines
 * and hands each line to `JSON.parse`, which rejects a BOM, so `initialize` was dropped without a
 * reply and the client waited on "connecting" forever. Nothing above us strips it: the servers that
 * do work in the same config are spawned without the launcher and never receive one.
 *
 * The BOM belongs to the first message only, so the decision is made on the first chunk and every
 * later chunk passes through untouched.
 */
export function stripLeadingBom(source: Readable): Readable {
  const output = new PassThrough();
  let first = true;
  source.on('data', (chunk: Buffer | string) => {
    const bytes = typeof chunk === 'string' ? Buffer.from(chunk, 'utf8') : chunk;
    if (first) {
      first = false;
      if (bytes.length >= UTF8_BOM.length && bytes.subarray(0, UTF8_BOM.length).equals(UTF8_BOM)) {
        output.write(bytes.subarray(UTF8_BOM.length));
        return;
      }
    }
    output.write(bytes);
  });
  source.on('end', () => output.end());
  source.on('error', (error: Error) => output.destroy(error));
  return output;
}
