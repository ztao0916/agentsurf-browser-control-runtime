#!/usr/bin/env node

import { installNativeHost } from './install-native-host';
import { startMcpServer } from './server';

async function main(): Promise<void> {
  const [command, ...args] = process.argv.slice(2);
  if (command === undefined) {
    await startMcpServer();
    return;
  }
  if (command === 'install-native-host') {
    await installNativeHost(args);
    return;
  }
  if (command === 'help' || command === '--help' || command === '-h') {
    printUsage();
    return;
  }

  process.stderr.write(`Unknown command: ${command}\n`);
  printUsage();
  process.exitCode = 1;
}

function printUsage(): void {
  process.stderr.write(
    'Usage:\n'
      + '  agentsurf-mcp\n'
      + '  agentsurf-mcp install-native-host --extension-id <extension-id> [--port <port>]\n',
  );
}

void main().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : String(error);
  process.stderr.write(`agentsurf-mcp: ${message}\n`);
  process.exitCode = 1;
});
