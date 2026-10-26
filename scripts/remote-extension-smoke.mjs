import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtemp, rm } from 'node:fs/promises';
import http from 'node:http';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';
import { spawn } from 'node:child_process';

const root = resolve(fileURLToPath(new URL('..', import.meta.url)));
const temp = await mkdtemp(join(tmpdir(), 'agentsurf-e2e-'));
const configPath = join(temp, 'remote-config.json');
const userDataDir = join(temp, 'chrome-profile');
let gateway;
let browserContext;
let fixture;

async function freePort() {
  const server = http.createServer();
  await new Promise((resolvePromise) => server.listen(0, '127.0.0.1', resolvePromise));
  const address = server.address();
  await new Promise((resolvePromise) => server.close(resolvePromise));
  return address.port;
}

async function waitForHealth(port) {
  for (let attempt = 0; attempt < 50; attempt += 1) {
    try {
      const response = await fetch(`http://127.0.0.1:${port}/healthz`);
      if (response.ok) return;
    } catch { /* Gateway is still starting. */ }
    await delay(200);
  }
  throw new Error('Remote gateway did not become healthy.');
}

async function mcpRequest(port, token, sessionId, id, method, params = {}) {
  const response = await fetch(`http://127.0.0.1:${port}/mcp`, {
    method: 'POST',
    headers: {
      host: `127.0.0.1:${port}`,
      authorization: `Bearer ${token}`,
      'content-type': 'application/json',
      accept: 'application/json, text/event-stream',
      ...(sessionId ? { 'mcp-session-id': sessionId } : {}),
    },
    body: JSON.stringify({ jsonrpc: '2.0', id, method, params }),
  });
  assert.equal(response.status, 200, `${method} returned HTTP ${response.status}`);
  return { data: await response.json(), sessionId: response.headers.get('mcp-session-id') ?? sessionId };
}

function parseToolText(result) {
  assert.equal(result.isError, undefined, result.content?.[0]?.text ?? 'MCP tool failed');
  const text = result.content?.find((item) => item.type === 'text')?.text;
  assert.ok(text, 'Tool returned no text result');
  return JSON.parse(text);
}

try {
  const fixturePort = await freePort();
  fixture = http.createServer((_request, response) => {
    response.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
    response.end('<!doctype html><button id="action">Click fixture</button><p id="result">waiting</p><script>document.querySelector("#action").addEventListener("click",()=>document.querySelector("#result").textContent="clicked")</script>');
  });
  await new Promise((resolvePromise) => fixture.listen(fixturePort, '127.0.0.1', resolvePromise));

  const gatewayPort = await freePort();
  const cli = join(root, 'dist', 'mcp', 'cli.js');
  const initOutput = execFileSync(process.execPath, [
    cli, 'init-remote', '--url', 'https://gateway.test', '--config', configPath, '--port', String(gatewayPort),
  ], { cwd: root, encoding: 'utf8' });
  const token = initOutput.match(/Bearer Token:\s+([^\s]+)/u)?.[1];
  assert.ok(token, 'Gateway token was not created');
  execFileSync(process.execPath, [cli, 'set-remote-access', '--mode', 'interactive', '--config', configPath], { cwd: root, stdio: 'ignore' });

  gateway = spawn(process.execPath, [cli, 'start-remote', '--config', configPath], { cwd: root, stdio: 'ignore' });
  await waitForHealth(gatewayPort);

  browserContext = await chromium.launchPersistentContext(userDataDir, {
    channel: 'chromium',
    headless: true,
    args: [`--disable-extensions-except=${join(root, 'dist')}`, `--load-extension=${join(root, 'dist')}`, '--no-sandbox'],
  });
  const serviceWorker = browserContext.serviceWorkers()[0]
    ?? await browserContext.waitForEvent('serviceworker', { timeout: 15_000 });
  const extensionId = new URL(serviceWorker.url()).host;
  const extensionPage = await browserContext.newPage();
  await extensionPage.goto(`chrome-extension://${extensionId}/debug.html`);
  await extensionPage.evaluate(async ({ url, pairingToken }) => {
    const result = await chrome.runtime.sendMessage({
      kind: 'transport-control', action: 'set-mode', mode: 'remote', gatewayUrl: url, gatewayToken: pairingToken,
    });
    if (!result?.ok) throw new Error('Could not configure the extension for the test gateway.');
  }, { url: `ws://127.0.0.1:${gatewayPort}/ws`, pairingToken: token });

  await waitForHealth(gatewayPort);
  for (let attempt = 0; attempt < 50; attempt += 1) {
    const health = await (await fetch(`http://127.0.0.1:${gatewayPort}/healthz`)).json();
    if (health.extension_connected) break;
    await delay(200);
  }
  const connected = await (await fetch(`http://127.0.0.1:${gatewayPort}/healthz`)).json();
  assert.equal(connected.extension_connected, true, 'Chrome extension did not connect to the gateway');
  const diagnostic = execFileSync(process.execPath, [cli, 'doctor', '--config', configPath, '--url', `http://127.0.0.1:${gatewayPort}`], {
    cwd: root,
    encoding: 'utf8',
  });
  assert.match(diagnostic, /PASS local gateway health/u);
  assert.match(diagnostic, /PASS Chrome extension: connected/u);
  assert.match(diagnostic, /PASS public gateway health/u);
  assert.ok(!diagnostic.includes(token), 'Doctor output must not reveal the gateway token');

  const initialized = await mcpRequest(gatewayPort, token, undefined, 1, 'initialize', {
    protocolVersion: '2024-11-05', capabilities: {}, clientInfo: { name: 'agentsurf-e2e', version: '1.0.0' },
  });
  assert.ok(initialized.sessionId, 'MCP session was not initialized');
  let id = 2;
  const callTool = async (name, args) => {
    const response = await mcpRequest(gatewayPort, token, initialized.sessionId, id++, 'tools/call', { name, arguments: args });
    return parseToolText(response.data.result);
  };

  const started = await callTool('browser_start_session', { name: 'local extension smoke test' });
  const sessionId = started.session?.session_id;
  assert.ok(sessionId, 'Remote browser task did not return its session id');
  await callTool('browser_open', { session_id: sessionId, url: `http://127.0.0.1:${fixturePort}/` });
  const tabsResult = await callTool('browser_list_tabs', { session_id: sessionId });
  const tab = tabsResult.tabs?.find((entry) => entry.url === `http://127.0.0.1:${fixturePort}/`);
  assert.ok(tab?.tab_id, 'The local fixture tab was not found');
  const snapshot = await callTool('browser_get_interactives', { session_id: sessionId, tab_id: tab.tab_id, tag: 'button' });
  const button = snapshot.snapshot?.elements?.find((element) => element.text.includes('Click fixture'));
  assert.ok(button?.element_id, 'The fixture button was not returned by the extension');
  await callTool('browser_click', { session_id: sessionId, tab_id: tab.tab_id, element_id: button.element_id });
  const content = await callTool('browser_get_page_content', { session_id: sessionId, tab_id: tab.tab_id });
  assert.match(content.text, /clicked/u, 'Click did not update the local fixture');
  const ended = await callTool('browser_end_session', { session_id: sessionId });
  assert.equal(ended.ended, true, 'Remote browser task did not end cleanly');

  process.stdout.write('Remote extension smoke passed: connect, read, click local fixture, end session.\n');
} finally {
  await browserContext?.close().catch(() => undefined);
  await new Promise((resolvePromise) => {
    if (!gateway || gateway.exitCode !== null) return resolvePromise();
    gateway.once('exit', () => resolvePromise());
    gateway.kill('SIGTERM');
    setTimeout(() => resolvePromise(), 2_000).unref();
  });
  if (fixture?.listening) await new Promise((resolvePromise) => fixture.close(() => resolvePromise()));
  await rm(temp, { recursive: true, force: true });
}
