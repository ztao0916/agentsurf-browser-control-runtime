import { BrowserBridgeServer } from '../bridge/server';
import { createToolError } from '../core/protocol/errors';
import {
  isNativePingMessage,
  isNativePongMessage,
  isNativeToolResponseMessage,
  isRecord,
  type HostToExtensionMessage,
} from '../transport/native-messaging-protocol';
import { loadOrCreateConfig } from './config';
import { NativeMessageReader, NativeMessageWriter } from './framing';

async function main(): Promise<void> {
  const config = await loadOrCreateConfig();
  const writer = new NativeMessageWriter(process.stdout);
  const send = (message: HostToExtensionMessage): void => writer.send(message);
  const bridge = new BrowserBridgeServer({
    port: config.port,
    token: config.token,
    log: (message) => process.stderr.write(`[browser-control-host] ${message}\n`),
  });
  const detachExtension = bridge.attachNativeExtension((request) => send({ type: 'tool_request', request }));
  const port = await bridge.waitUntilListening();

  const heartbeat = setInterval(() => send({ type: 'ping', timestamp: Date.now() }), 20_000);
  const reader = new NativeMessageReader((message) => {
    if (isRecord(message) && message.type === 'extension_hello' && message.protocol_version === '1') {
      send({
        type: 'host_ready',
        protocol_version: '1',
        bridge_url: `ws://127.0.0.1:${port}`,
        authentication_required: true,
      });
      return;
    }
    if (isNativeToolResponseMessage(message)) {
      bridge.receiveNativeExtensionResponse(message.response);
      return;
    }
    if (isNativePingMessage(message)) {
      send({ type: 'pong', timestamp: message.timestamp });
      return;
    }
    if (isNativePongMessage(message)) return;
    send({
      type: 'host_error',
      error: createToolError('invalid_request', 'Native Host received an unsupported message.', false),
    });
  });

  process.stdin.on('data', (chunk: Buffer) => {
    try {
      reader.push(chunk);
    } catch (error: unknown) {
      send({
        type: 'host_error',
        error: createToolError('invalid_request', error instanceof Error ? error.message : String(error), false),
      });
    }
  });
  process.stdin.on('end', () => {
    clearInterval(heartbeat);
    detachExtension();
    void bridge.close().finally(() => process.exit(0));
  });
}

void main().catch((error: unknown) => {
  new NativeMessageWriter(process.stdout).send({
    type: 'host_error',
    error: createToolError('bridge_unavailable', error instanceof Error ? error.message : String(error), true),
  });
  process.exitCode = 1;
});
