#!/usr/bin/env node

import { spawn } from 'node:child_process';
import { access } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { createInterface } from 'node:readline/promises';
import { fileURLToPath } from 'node:url';
import { getMessages } from './i18n.mjs';

const projectRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const { setup: text } = await getMessages();
const browsers = {
  legacy: { id: 'legacy', browser: 'chrome', legacy: true, label: 'Chrome', defaultPort: 8765, mcpName: 'agentsurf' },
  chrome: { id: 'chrome', browser: 'chrome', legacy: false, label: 'Chrome', defaultPort: 8765, mcpName: 'agentsurf-chrome' },
  edge: { id: 'edge', browser: 'edge', legacy: false, label: 'Edge', defaultPort: 8766, mcpName: 'agentsurf-edge' },
};
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
for (const target of selectedTargets(options)) {
  const extensionsUrl = target.browser === 'edge' ? 'edge://extensions' : 'chrome://extensions';
  console.log('');
  console.log(text.browserHeading(target.label));
  console.log(text.openExtensions(extensionsUrl));
  console.log(text.enableDeveloperMode);
  console.log(text.loadUnpacked);
  console.log(`     ${join(projectRoot, 'dist')}`);
  console.log(text.copyExtensionId(target.label));
}

const terminal = process.stdin.isTTY && process.stdout.isTTY
  ? createInterface({ input: process.stdin, output: process.stdout })
  : null;

try {
  const installations = [];
  for (const target of selectedTargets(options)) {
    const extensionId = options.extensionIds[target.id]
      ?? await promptForExtensionId(terminal, text, target.label);
    installations.push({
      target,
      extensionId,
      port: options.ports[target.id] ?? target.defaultPort,
    });
  }

  console.log('');
  console.log(text.registeringNativeHost);
  for (const installation of installations) {
    await installNativeHost(installation, text);
  }

  console.log('');
  console.log(text.complete);
  console.log(text.reload);
} finally {
  terminal?.close();
}

function parseArgs(values, text) {
  let browser = 'chrome';
  let browserProvided = false;
  let extensionId;
  let port;
  let help = false;
  const extensionIds = {};
  const ports = {};

  for (let index = 0; index < values.length; index += 1) {
    const arg = values[index];
    if (arg === '--help' || arg === '-h') {
      help = true;
      continue;
    }
    if (arg === '--browser'
      || arg === '--extension-id'
      || arg === '--chrome-extension-id'
      || arg === '--edge-extension-id'
      || arg === '--port'
      || arg === '--chrome-port'
      || arg === '--edge-port') {
      const value = values[index + 1];
      if (value === undefined || value.startsWith('--')) {
        throw new Error(text.missingOptionValue(arg));
      }
      index += 1;
      if (arg === '--browser') {
        browser = value;
        browserProvided = true;
        if (browser !== 'chrome' && browser !== 'edge' && browser !== 'all') {
          throw new Error(text.invalidBrowser(value));
        }
      } else if (arg === '--extension-id') {
        extensionId = value;
      } else if (arg === '--chrome-extension-id') {
        extensionIds.chrome = value;
      } else if (arg === '--edge-extension-id') {
        extensionIds.edge = value;
      } else {
        const parsedPort = Number(value);
        if (!Number.isInteger(parsedPort) || parsedPort < 1 || parsedPort > 65535) {
          throw new Error(text.invalidPort);
        }
        if (arg === '--port') port = parsedPort;
        else if (arg === '--chrome-port') ports.chrome = parsedPort;
        else ports.edge = parsedPort;
      }
      continue;
    }
    throw new Error(text.unknownOption(arg));
  }

  if (extensionId !== undefined) {
    if (browser === 'all') throw new Error(text.browserSpecificOption('--extension-id', '--chrome-extension-id or --edge-extension-id'));
    extensionIds[browserProvided ? browser : 'legacy'] = extensionId;
  }
  if (port !== undefined) {
    if (browser === 'all') throw new Error(text.browserSpecificOption('--port', '--chrome-port or --edge-port'));
    ports[browserProvided ? browser : 'legacy'] = port;
  }
  for (const value of Object.values(extensionIds)) {
    if (!isExtensionId(value)) throw new Error(text.invalidExtensionId);
  }

  const parsed = { browser, browserProvided, extensionIds, ports, help };
  const selectedIds = selectedTargets(parsed).map((target) => target.id);
  for (const id of Object.keys(extensionIds)) {
    if (!selectedIds.includes(id)) throw new Error(text.unknownOption(`--${id}-extension-id`));
  }
  for (const id of Object.keys(ports)) {
    if (!selectedIds.includes(id)) throw new Error(text.unknownOption(`--${id}-port`));
  }
  return parsed;
}

function isExtensionId(value) {
  return /^[a-p]{32}$/.test(value);
}

async function promptForExtensionId(terminal, text, browserLabel) {
  if (terminal === null) {
    throw new Error(text.noInteractiveTerminal);
  }
  while (true) {
    const value = (await terminal.question(text.extensionIdPrompt(browserLabel))).trim();
    if (isExtensionId(value)) return value;
    console.error(text.invalidExtensionId);
  }
}

function selectedTargets(options) {
  if (!options.browserProvided) return [browsers.legacy];
  if (options.browser === 'all') return [browsers.chrome, browsers.edge];
  return [browsers[options.browser]];
}

async function installNativeHost({ target, extensionId, port }, text) {
  if (process.platform === 'win32') {
    const args = [
      '-NoProfile',
      '-ExecutionPolicy',
      'Bypass',
      '-File',
      join(projectRoot, 'scripts', 'install-native-host.ps1'),
      '-Browser',
      target.browser,
      '-ExtensionId',
      extensionId,
      '-Port',
      String(port),
      ...(target.legacy ? [] : ['-MultiBrowser']),
    ];
    await run('powershell', args);
    return;
  }

  const args = [
    join(projectRoot, 'scripts', 'install-native-host-macos.mjs'),
    '--extension-id',
    extensionId,
    '--port',
    String(port),
    ...(target.legacy ? ['--legacy'] : ['--browser', target.browser]),
  ];
  await run(process.execPath, args);
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
