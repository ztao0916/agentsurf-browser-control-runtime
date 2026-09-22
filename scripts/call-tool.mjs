import WebSocket from 'ws';
import { readFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join } from 'node:path';

const config = await readLocalConfig();
const bridgeUrl = process.env.BROWSER_BRIDGE_URL || `ws://127.0.0.1:${config?.port ?? 8765}`;
const token = process.env.BROWSER_BRIDGE_TOKEN || config?.token;
const requestText = process.argv.slice(2).join(' ');

if (!token || !requestText) {
  console.error('Usage: set BROWSER_BRIDGE_TOKEN, then npm run bridge:call -- \'{"protocol_version":"1",...}\'');
  process.exit(1);
}

let request;
try {
  request = JSON.parse(requestText);
} catch {
  console.error('Tool request must be valid JSON.');
  process.exit(1);
}

const socket = new WebSocket(bridgeUrl);
socket.on('open', () => socket.send(JSON.stringify({ type: 'auth', role: 'agent', token })));
socket.on('message', (data) => {
  const message = JSON.parse(data.toString());
  if (message.type === 'auth_result' && message.ok) {
    socket.send(JSON.stringify(request));
    return;
  }
  if (message.request_id === request.request_id) {
    console.log(JSON.stringify(message, null, 2));
    socket.close();
  }
});
socket.on('error', (error) => {
  console.error(error.message);
  process.exitCode = 1;
});

async function readLocalConfig() {
  const root = process.platform === 'darwin'
    ? join(homedir(), 'Library', 'Application Support', 'BrowserControlRuntime')
    : join(process.env.LOCALAPPDATA || join(homedir(), 'AppData', 'Local'), 'BrowserControlRuntime');
  const candidates = process.env.BROWSER_BRIDGE_CONFIG
    ? [process.env.BROWSER_BRIDGE_CONFIG]
    : [join(root, 'config.json'), join(root, 'chrome', 'config.json')];
  for (const path of candidates) {
    try {
      const value = JSON.parse(await readFile(path, 'utf8'));
      if (typeof value?.port === 'number' && typeof value?.token === 'string') return value;
    } catch {
      // Try the next supported config location.
    }
  }
  return null;
}
