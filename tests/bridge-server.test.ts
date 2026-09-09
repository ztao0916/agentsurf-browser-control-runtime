import { afterEach, describe, expect, it } from 'vitest';
import WebSocket, { type RawData } from 'ws';
import { BrowserBridgeServer } from '../src/bridge/server';

const TOKEN = 'test-token-with-at-least-16-characters';
const REQUEST = {
  protocol_version: '1',
  request_id: 'req_test',
  tool: 'browser.list_tabs',
  args: {},
};

let bridge: BrowserBridgeServer | undefined;
const sockets: WebSocket[] = [];

afterEach(async () => {
  for (const socket of sockets.splice(0)) socket.terminate();
  if (bridge !== undefined) await bridge.close();
  bridge = undefined;
});

describe('BrowserBridgeServer', () => {
  it('accepts normal WebSocket connections with the correct token', async () => {
    const port = await startBridge();
    const extension = await connectClient(port);
    const response = await authenticate(extension, 'extension', TOKEN);
    expect(response).toEqual({ type: 'auth_result', ok: true, role: 'extension' });
  });

  it('rejects an incorrect token', async () => {
    const port = await startBridge();
    const agent = await connectClient(port);
    const response = await authenticate(agent, 'agent', 'incorrect-token-with-16-characters');
    expect(response).toMatchObject({
      type: 'auth_result',
      ok: false,
      error: { code: 'authentication_failed' },
    });
  });

  it('rejects a Tool request before authentication', async () => {
    const port = await startBridge();
    const agent = await connectClient(port);
    const response = await sendAndReceive(agent, REQUEST);
    expect(response).toMatchObject({
      type: 'auth_result',
      ok: false,
      error: { code: 'authentication_failed' },
    });
  });

  it('routes Tool requests to the Extension and returns the matched response', async () => {
    const port = await startBridge();
    const extension = await authenticatedClient(port, 'extension');
    const agent = await authenticatedClient(port, 'agent');

    const extensionRequest = receiveMessage(extension);
    agent.send(JSON.stringify(REQUEST));
    expect(await extensionRequest).toEqual(REQUEST);

    extension.send(JSON.stringify({ request_id: 'req_test', ok: true, result: { tabs: [] } }));
    expect(await receiveMessage(agent)).toEqual({ request_id: 'req_test', ok: true, result: { tabs: [] } });
  });

  it('matches concurrent responses to the correct request_id', async () => {
    const port = await startBridge();
    const extension = await authenticatedClient(port, 'extension');
    const agent = await authenticatedClient(port, 'agent');
    const firstRequest = receiveMessage(extension);
    agent.send(JSON.stringify({ ...REQUEST, request_id: 'req_1' }));
    expect(await firstRequest).toMatchObject({ request_id: 'req_1' });
    const secondRequest = receiveMessage(extension);
    agent.send(JSON.stringify({ ...REQUEST, request_id: 'req_2' }));
    expect(await secondRequest).toMatchObject({ request_id: 'req_2' });

    const firstAgentResponse = receiveMessage(agent);
    extension.send(JSON.stringify({ request_id: 'req_2', ok: true, result: { order: 2 } }));
    expect(await firstAgentResponse).toMatchObject({ request_id: 'req_2', result: { order: 2 } });
    const secondAgentResponse = receiveMessage(agent);
    extension.send(JSON.stringify({ request_id: 'req_1', ok: true, result: { order: 1 } }));
    expect(await secondAgentResponse).toMatchObject({ request_id: 'req_1', result: { order: 1 } });
  });

  it('returns a structured timeout when the Extension does not respond', async () => {
    const port = await startBridge(20);
    await authenticatedClient(port, 'extension');
    const agent = await authenticatedClient(port, 'agent');
    const response = await sendAndReceive(agent, REQUEST);
    expect(response).toMatchObject({
      request_id: 'req_test',
      ok: false,
      error: { code: 'request_timeout', retryable: true },
    });
  });

  it('reports the Extension as unavailable after it disconnects', async () => {
    const port = await startBridge();
    const extension = await authenticatedClient(port, 'extension');
    const agent = await authenticatedClient(port, 'agent');
    const closed = waitForClose(extension);
    extension.close();
    await closed;
    const response = await sendAndReceive(agent, REQUEST);
    expect(response).toMatchObject({
      request_id: 'req_test',
      ok: false,
      error: { code: 'bridge_unavailable' },
    });
  });

  it('fails pending requests when the Extension disconnects', async () => {
    const port = await startBridge();
    const extension = await authenticatedClient(port, 'extension');
    const agent = await authenticatedClient(port, 'agent');
    const forwarded = receiveMessage(extension);
    agent.send(JSON.stringify(REQUEST));
    await forwarded;
    const responsePromise = receiveMessage(agent);
    extension.close();
    const response = await responsePromise;
    expect(response).toMatchObject({
      request_id: 'req_test',
      ok: false,
      error: { code: 'transport_disconnected', retryable: true },
    });
  });

  it('rejects malformed JSON with a structured error', async () => {
    const port = await startBridge();
    const agent = await authenticatedClient(port, 'agent');
    const response = await sendTextAndReceive(agent, '{not json');
    expect(response).toMatchObject({
      request_id: 'unknown',
      ok: false,
      error: { code: 'invalid_request' },
    });
  });

  it('returns a structured error for an unknown Tool', async () => {
    const port = await startBridge();
    await authenticatedClient(port, 'extension');
    const agent = await authenticatedClient(port, 'agent');
    const response = await sendAndReceive(agent, { ...REQUEST, tool: 'browser.unknown' });
    expect(response).toMatchObject({
      request_id: 'req_test',
      ok: false,
      error: { code: 'invalid_request' },
    });
  });
});

async function startBridge(requestTimeoutMs = 1_000): Promise<number> {
  bridge = new BrowserBridgeServer({ port: 0, token: TOKEN, requestTimeoutMs, log: () => undefined });
  return bridge.waitUntilListening();
}

async function connectClient(port: number): Promise<WebSocket> {
  const socket = new WebSocket(`ws://127.0.0.1:${port}`);
  sockets.push(socket);
  await new Promise<void>((resolve, reject) => {
    socket.once('open', resolve);
    socket.once('error', reject);
  });
  return socket;
}

async function authenticatedClient(port: number, role: 'extension' | 'agent'): Promise<WebSocket> {
  const socket = await connectClient(port);
  const response = await authenticate(socket, role, TOKEN);
  expect(response).toMatchObject({ type: 'auth_result', ok: true, role });
  return socket;
}

function authenticate(socket: WebSocket, role: 'extension' | 'agent', token: string): Promise<unknown> {
  return sendAndReceive(socket, { type: 'auth', role, token });
}

function sendAndReceive(socket: WebSocket, message: unknown): Promise<unknown> {
  return sendTextAndReceive(socket, JSON.stringify(message));
}

function sendTextAndReceive(socket: WebSocket, message: string): Promise<unknown> {
  const response = receiveMessage(socket);
  socket.send(message);
  return response;
}

function receiveMessage(socket: WebSocket): Promise<unknown> {
  return new Promise((resolve, reject) => {
    socket.once('message', (data) => {
      try {
        resolve(JSON.parse(rawDataToString(data)) as unknown);
      } catch (error: unknown) {
        reject(error instanceof Error ? error : new Error(String(error)));
      }
    });
    socket.once('error', reject);
  });
}

function waitForClose(socket: WebSocket): Promise<void> {
  return new Promise((resolve) => socket.once('close', () => resolve()));
}

function rawDataToString(data: RawData): string {
  if (Buffer.isBuffer(data)) return data.toString('utf8');
  if (data instanceof ArrayBuffer) return Buffer.from(data).toString('utf8');
  return Buffer.concat(data).toString('utf8');
}
