import { rm } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join } from 'node:path';

if (process.platform !== 'darwin') throw new Error('This uninstaller is for macOS only.');
const supportDirectory = join(homedir(), 'Library', 'Application Support');
await rm(join(supportDirectory, 'Google', 'Chrome', 'NativeMessagingHosts', 'com.browsercontrol.runtime.json'), { force: true });
await rm(join(supportDirectory, 'BrowserControlRuntime', 'native-host.sh'), { force: true });
console.log('AgentSurf Native Host registration and launcher removed.');
console.log('Local configuration was preserved in ~/Library/Application Support/BrowserControlRuntime.');
