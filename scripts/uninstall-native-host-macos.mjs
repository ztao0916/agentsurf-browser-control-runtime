import { rm } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { getMessages } from './i18n.mjs';

const { uninstall: text } = await getMessages();

if (process.platform !== 'darwin') throw new Error(text.macOnly);
const supportDirectory = join(homedir(), 'Library', 'Application Support');
const browser = parseBrowser(process.argv.slice(2));
const browsers = browser === 'all'
  ? ['chrome', 'edge']
  : browser === 'legacy'
    ? ['chrome']
    : [browser];
const runtimeRoot = join(supportDirectory, 'BrowserControlRuntime');

for (const browserId of browsers) {
  const manifestDirectory = browserId === 'edge'
    ? join(supportDirectory, 'Microsoft Edge', 'NativeMessagingHosts')
    : join(supportDirectory, 'Google', 'Chrome', 'NativeMessagingHosts');
  await rm(join(manifestDirectory, 'com.browsercontrol.runtime.json'), { force: true });
  if (browser !== 'legacy') {
    await rm(join(runtimeRoot, browserId, 'native-host.sh'), { force: true });
    await rm(join(runtimeRoot, browserId, 'agentsurf-mcp.sh'), { force: true });
  }
}

if (browser === 'legacy') {
  await rm(join(runtimeRoot, 'native-host.sh'), { force: true });
  await rm(join(runtimeRoot, 'agentsurf-mcp.sh'), { force: true });
}
console.log(text.removed);
console.log(text.preserved);

function parseBrowser(values) {
  let browser = 'legacy';
  for (let index = 0; index < values.length; index += 1) {
    if (values[index] === '--legacy') {
      browser = 'legacy';
      continue;
    }
    if (values[index] !== '--browser') throw new Error('Usage: npm run native-host:uninstall:macos -- [--legacy | --browser chrome|edge|all]');
    const value = values[index + 1];
    if (value === undefined) throw new Error('Missing value for --browser.');
    browser = value;
    index += 1;
  }
  if (browser !== 'legacy' && browser !== 'chrome' && browser !== 'edge' && browser !== 'all') {
    throw new Error(`Unsupported browser: ${browser}. Expected chrome, edge, or all.`);
  }
  return browser;
}
