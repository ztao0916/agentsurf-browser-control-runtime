#!/usr/bin/env node

import { spawn } from 'node:child_process';
import { access } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { createInterface } from 'node:readline/promises';
import { fileURLToPath } from 'node:url';

const projectRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const options = parseArgs(process.argv.slice(2));
const npmCommand = process.platform === 'win32' ? 'npm.cmd' : 'npm';

if (options.help) {
  printUsage();
  process.exit(0);
}

if (Number(process.versions.node.split('.')[0]) < 20) {
  throw new Error('AgentSurf requires Node.js 20 or newer.');
}
if (process.platform !== 'win32' && process.platform !== 'darwin') {
  throw new Error('The setup command currently supports Windows and macOS.');
}
if (options.extensionId !== undefined && !isExtensionId(options.extensionId)) {
  throw new Error('Extension ID must be 32 lowercase letters from a to p.');
}

console.log('AgentSurf setup');
console.log('');
console.log('Step 1/4: installing dependencies');
await run(npmCommand, ['install']);

console.log('');
console.log('Step 2/4: building the extension and MCP server');
await run(npmCommand, ['run', 'build']);
await access(join(projectRoot, 'dist', 'manifest.json'));

console.log('');
console.log('Step 3/4: loading the Chrome extension');
console.log('  1. Open chrome://extensions');
console.log('  2. Turn on Developer mode');
console.log('  3. Click "Load unpacked" and select:');
console.log(`     ${join(projectRoot, 'dist')}`);
console.log('  4. Copy the AgentSurf extension ID shown by Chrome');

const terminal = process.stdin.isTTY && process.stdout.isTTY
  ? createInterface({ input: process.stdin, output: process.stdout })
  : null;

try {
  const extensionId = options.extensionId ?? await promptForExtensionId(terminal);

  console.log('');
  console.log('Step 4/4: registering the Native Host');
  await installNativeHost(extensionId, options.port);

  console.log('');
  console.log('Setup complete. Copy the MCP JSON printed above into your agent configuration.');
  console.log('Then reload AgentSurf in chrome://extensions and restart your MCP client.');

  if (terminal !== null) {
    await terminal.question('After AgentSurf shows "connected", press Enter to run the smoke test.');
    const smokeRequest = JSON.stringify({
      protocol_version: '1',
      request_id: 'setup-smoke',
      tool: 'browser.list_tabs',
      args: {},
    });
    try {
      await run(process.execPath, [join(projectRoot, 'scripts', 'call-tool.mjs'), smokeRequest]);
      console.log('Smoke test passed: AgentSurf can reach the current Chrome session.');
    } catch {
      console.error('');
      console.error('The Native Host is installed, but the smoke test did not complete.');
      console.error('Open the AgentSurf status page and make sure it shows "connected", then run:');
      console.error(`  node scripts/call-tool.mjs '${smokeRequest}'`);
      process.exitCode = 1;
    }
  } else {
    console.log('Non-interactive terminal: skipped the final smoke test.');
  }
} finally {
  terminal?.close();
}

function parseArgs(values) {
  let extensionId;
  let port = 8765;
  let help = false;

  for (let index = 0; index < values.length; index += 1) {
    const arg = values[index];
    if (arg === '--help' || arg === '-h') {
      help = true;
      continue;
    }
    if (arg === '--extension-id' || arg === '--port') {
      const value = values[index + 1];
      if (value === undefined || value.startsWith('--')) {
        throw new Error(`Missing value for ${arg}.`);
      }
      index += 1;
      if (arg === '--extension-id') extensionId = value;
      else {
        port = Number(value);
        if (!Number.isInteger(port) || port < 1 || port > 65535) {
          throw new Error('Port must be between 1 and 65535.');
        }
      }
      continue;
    }
    throw new Error(`Unknown option: ${arg}`);
  }

  return { extensionId, port, help };
}

function isExtensionId(value) {
  return /^[a-p]{32}$/.test(value);
}

async function promptForExtensionId(terminal) {
  if (terminal === null) {
    throw new Error('No interactive terminal. Re-run with --extension-id <extension-id>.');
  }
  while (true) {
    const value = (await terminal.question('Extension ID: ')).trim();
    if (isExtensionId(value)) return value;
    console.error('That does not look like a Chrome extension ID. Expected 32 lowercase letters from a to p.');
  }
}

async function installNativeHost(extensionId, port) {
  if (process.platform === 'win32') {
    await run('powershell', [
      '-NoProfile',
      '-ExecutionPolicy',
      'Bypass',
      '-File',
      join(projectRoot, 'scripts', 'install-native-host.ps1'),
      '-ExtensionId',
      extensionId,
      '-Port',
      String(port),
    ]);
    return;
  }

  await run(process.execPath, [
    join(projectRoot, 'scripts', 'install-native-host-macos.mjs'),
    extensionId,
    String(port),
  ]);
}

function printUsage() {
  console.log(
    'Usage:\n'
      + '  npm run setup\n'
      + '  npm run setup -- --extension-id <extension-id> [--port <port>]\n',
  );
}

function run(command, commandArgs) {
  const [executable, args] = command === 'npm.cmd'
    ? [process.execPath, [getNpmCliPath(), ...commandArgs]]
    : [command, commandArgs];

  return new Promise((resolvePromise, rejectPromise) => {
    const child = spawn(executable, args, { cwd: projectRoot, stdio: 'inherit' });
    child.once('error', rejectPromise);
    child.once('exit', (code, signal) => {
      if (code === 0) {
        resolvePromise();
        return;
      }
      const reason = signal === null ? `exit code ${code}` : `signal ${signal}`;
      rejectPromise(new Error(`${command} failed with ${reason}.`));
    });
  });
}

function getNpmCliPath() {
  return process.env.npm_execpath
    ?? join(dirname(process.execPath), 'node_modules', 'npm', 'bin', 'npm-cli.js');
}
