import { randomBytes } from 'node:crypto';
import { access, chmod, mkdir, readFile, writeFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

if (process.platform !== 'darwin') throw new Error('This installer is for macOS only.');
const [extensionId, portValue = '8765', ...extra] = process.argv.slice(2);
if (!/^[a-p]{32}$/.test(extensionId ?? '') || extra.length > 0) {
  throw new Error('Usage: npm run native-host:install:macos -- <extension-id> [port]');
}
const port = Number(portValue);
if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error('Port must be between 1 and 65535.');

const projectRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const hostScript = join(projectRoot, 'dist', 'native-host', 'host.js');
await access(hostScript);
const runtimeDirectory = join(homedir(), 'Library', 'Application Support', 'BrowserControlRuntime');
const configPath = join(runtimeDirectory, 'config.json');
const launcherPath = join(runtimeDirectory, 'native-host.sh');
const manifestDirectory = join(homedir(), 'Library', 'Application Support', 'Google', 'Chrome', 'NativeMessagingHosts');
const manifestPath = join(manifestDirectory, 'com.browsercontrol.runtime.json');

let token;
try {
  const config = JSON.parse(await readFile(configPath, 'utf8'));
  if (typeof config.token !== 'string' || config.token.length < 16) {
    throw new Error(`Invalid token in existing configuration: ${configPath}`);
  }
  token = config.token;
} catch (error) {
  if (error.code !== 'ENOENT') throw error;
  token = randomBytes(32).toString('hex');
}

await mkdir(runtimeDirectory, { recursive: true, mode: 0o700 });
await mkdir(manifestDirectory, { recursive: true });
await writeFile(configPath, `${JSON.stringify({ port, token }, null, 2)}\n`, { mode: 0o600 });
await chmod(configPath, 0o600);

// Quote absolute paths: GUI-launched Chrome does not inherit the terminal's Node PATH.
const quote = (value) => `'${value.replaceAll("'", "'\\''")}'`;
await writeFile(launcherPath, `#!/bin/sh\nexport BROWSER_BRIDGE_CONFIG=${quote(configPath)}\nexec ${quote(process.execPath)} ${quote(hostScript)}\n`, { mode: 0o700 });
await chmod(launcherPath, 0o700);
await writeFile(manifestPath, `${JSON.stringify({
  name: 'com.browsercontrol.runtime',
  description: 'AgentSurf native messaging host',
  path: launcherPath,
  type: 'stdio',
  allowed_origins: [`chrome-extension://${extensionId}/`],
}, null, 2)}\n`);

console.log(`Native Host installed for Chrome extension ${extensionId}`);
console.log(`Manifest: ${manifestPath}`);
console.log(`Config: ${configPath}`);
console.log(`Bridge: ws://127.0.0.1:${port}`);
console.log('Reload AgentSurf in Chrome. Reinstall after moving the project or changing the Node installation path.');
