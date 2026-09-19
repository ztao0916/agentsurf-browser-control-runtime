#!/usr/bin/env node

import { spawn } from 'node:child_process';
import { access } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { createInterface } from 'node:readline/promises';
import { fileURLToPath } from 'node:url';
import { getMessages } from './i18n.mjs';

const projectRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const { setup: text } = await getMessages();
const options = parseArgs(process.argv.slice(2), text);
const npmCommand = process.platform === 'win32' ? 'npm.cmd' : 'npm';

if (options.help) {
  printUsage(text);
  process.exit(0);
}

if (Number(process.versions.node.split('.')[0]) < 20) {
  throw new Error(text.nodeVersion);
}
if (process.platform !== 'win32' && process.platform !== 'darwin') {
  throw new Error(text.unsupportedPlatform);
}
if (options.extensionId !== undefined && !isExtensionId(options.extensionId)) {
  throw new Error(text.invalidExtensionId);
}

console.log(text.title);
console.log('');
console.log(text.installingDependencies);
await run(npmCommand, ['install']);

console.log('');
console.log(text.building);
await run(npmCommand, ['run', 'build']);
await access(join(projectRoot, 'dist', 'manifest.json'));

console.log('');
console.log(text.loadingExtension);
console.log(text.openExtensions);
console.log(text.enableDeveloperMode);
console.log(text.loadUnpacked);
console.log(`     ${join(projectRoot, 'dist')}`);
console.log(text.copyExtensionId);

const terminal = process.stdin.isTTY && process.stdout.isTTY
  ? createInterface({ input: process.stdin, output: process.stdout })
  : null;

try {
  const extensionId = options.extensionId ?? await promptForExtensionId(terminal, text);

  console.log('');
  console.log(text.registeringNativeHost);
  await installNativeHost(extensionId, options.port, text);

  console.log('');
  console.log(text.complete);
  console.log(text.reload);
} finally {
  terminal?.close();
}

function parseArgs(values, text) {
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
        throw new Error(text.missingOptionValue(arg));
      }
      index += 1;
      if (arg === '--extension-id') extensionId = value;
      else {
        port = Number(value);
        if (!Number.isInteger(port) || port < 1 || port > 65535) {
          throw new Error(text.invalidPort);
        }
      }
      continue;
    }
    throw new Error(text.unknownOption(arg));
  }

  return { extensionId, port, help };
}

function isExtensionId(value) {
  return /^[a-p]{32}$/.test(value);
}

async function promptForExtensionId(terminal, text) {
  if (terminal === null) {
    throw new Error(text.noInteractiveTerminal);
  }
  while (true) {
    const value = (await terminal.question(text.extensionIdPrompt)).trim();
    if (isExtensionId(value)) return value;
    console.error(text.invalidExtensionId);
  }
}

async function installNativeHost(extensionId, port, text) {
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

function printUsage(text) {
  console.log(`${text.usage.join('\n')}\n`);
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
      rejectPromise(new Error(text.commandFailed(command, reason)));
    });
  });
}

function getNpmCliPath() {
  return process.env.npm_execpath
    ?? join(dirname(process.execPath), 'node_modules', 'npm', 'bin', 'npm-cli.js');
}
