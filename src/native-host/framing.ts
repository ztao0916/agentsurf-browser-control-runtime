const HEADER_SIZE = 4;
const MAX_MESSAGE_SIZE = 64 * 1024 * 1024;

export class NativeMessageReader {
  private buffer: Buffer<ArrayBufferLike> = Buffer.alloc(0);

  public constructor(private readonly onMessage: (message: unknown) => void) {}

  public push(chunk: Buffer): void {
    this.buffer = this.buffer.length === 0 ? chunk : Buffer.concat([this.buffer, chunk]);
    while (this.buffer.length >= HEADER_SIZE) {
      const length = this.buffer.readUInt32LE(0);
      if (length === 0 || length > MAX_MESSAGE_SIZE) {
        throw new Error(`Invalid Native Messaging message length: ${length}.`);
      }
      if (this.buffer.length < HEADER_SIZE + length) return;
      const payload = this.buffer.subarray(HEADER_SIZE, HEADER_SIZE + length);
      this.buffer = this.buffer.subarray(HEADER_SIZE + length);
      this.onMessage(JSON.parse(payload.toString('utf8')) as unknown);
    }
  }
}

export class NativeMessageWriter {
  public constructor(private readonly output: NodeJS.WritableStream) {}

  public send(message: unknown): void {
    const payload = Buffer.from(JSON.stringify(message), 'utf8');
    const header = Buffer.alloc(HEADER_SIZE);
    header.writeUInt32LE(payload.length, 0);
    this.output.write(Buffer.concat([header, payload]));
  }
}
