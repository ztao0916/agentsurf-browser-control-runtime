import { rm } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { getMessages } from './i18n.mjs';

const { uninstall: text } = await getMessages();

if (process.platform !== 'darwin') throw new Error(text.macOnly);
const supportDirectory = join(homedir(), 'Library', 'Application Support');
await rm(join(supportDirectory, 'Google', 'Chrome', 'NativeMessagingHosts', 'com.browsercontrol.runtime.json'), { force: true });
await rm(join(supportDirectory, 'BrowserControlRuntime', 'native-host.sh'), { force: true });
await rm(join(supportDirectory, 'BrowserControlRuntime', 'agentsurf-mcp.sh'), { force: true });
console.log(text.removed);
console.log(text.preserved);
