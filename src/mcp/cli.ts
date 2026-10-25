#!/usr/bin/env node

import { getDefaultConfigPath } from '../native-host/config';
import { startHttpMcpServer } from './http-server';
import { installNativeHost } from './install-native-host';
import {
  getDefaultRemoteConfigPath,
  initializeRemoteConfig,
  rotateRemoteToken,
} from './remote-config';
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
  if (command === 'start-remote' || command === 'start-gateway') {
    await handleStartRemote(args);
    return;
  }
  if (command === 'init-remote' || command === 'init-gateway') {
    await handleInitRemote(args);
    return;
  }
  if (command === 'rotate-remote-token') {
    await handleRotateToken(args);
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

function parseRemoteArgs(args: string[]): {
  url?: string | undefined;
  config?: string | undefined;
  port?: number | undefined;
  bridgeConfig?: string | undefined;
} {
  const result: { url?: string | undefined; config?: string | undefined; port?: number | undefined; bridgeConfig?: string | undefined } = {};
  for (let i = 0; i < args.length; i += 1) {
    const arg = args[i];
    if (!arg) continue;
    const [flag, inlineVal] = arg.split('=', 2);
    const val = inlineVal ?? args[i + 1];
    if (inlineVal === undefined) i += 1;
    if (flag === '--url') result.url = val;
    else if (flag === '--config') result.config = val;
    else if (flag === '--port') result.port = Number(val);
    else if (flag === '--bridge-config') result.bridgeConfig = val;
    else throw new Error(`Unknown option: ${arg}`);
  }
  return result;
}

async function handleInitRemote(args: string[]): Promise<void> {
  const options = parseRemoteArgs(args);
  if (!options.url) {
    throw new Error('Usage: agentsurf-mcp init-remote --url <public-https-url> [--config <path>] [--port <port>]');
  }
  const configPath = options.config ?? getDefaultRemoteConfigPath();
  const port = options.port ?? 8767;
  const token = await initializeRemoteConfig(
    configPath,
    options.url,
    options.bridgeConfig ?? getDefaultConfigPath(),
    port,
  );
  const cleanUrl = options.url.replace(/\/+$/u, '');
  const wsUrl = cleanUrl.replace(/^http:/i, 'ws:').replace(/^https:/i, 'wss:');
  process.stdout.write(
    `AgentSurf Remote Gateway configuration created successfully.\n\n`
      + `  Config file:    ${configPath}\n`
      + `  Bearer Token:   ${token}\n`
      + `  Public MCP URL: ${cleanUrl}/mcp\n`
      + `  Gateway WS URL: ${wsUrl}/ws\n\n`
      + `Remote Client Setup (e.g. Notion AI, Custom Agent, Dify):\n`
      + `  1. Add MCP connection in your remote client or platform:\n`
      + `     - Server URL:     ${cleanUrl}/mcp\n`
      + `     - Authentication: Bearer Token\n`
      + `     - Token:          ${token}\n\n`
      + `Chrome Extension Setup (0 terminal commands needed!):\n`
      + `  2. Click AgentSurf extension in Chrome -> Choose 'Remote Gateway'\n`
      + `     - Gateway URL:    ${wsUrl}/ws\n`
      + `     - Pairing Token:  ${token}\n`
      + `     - Click 'Save & Connect'\n\n`
      + `Start the gateway server with:\n`
      + `  agentsurf-mcp start-gateway\n`,
  );
}

async function handleStartRemote(args: string[]): Promise<void> {
  const options = parseRemoteArgs(args);
  const handle = await startHttpMcpServer({
    ...(options.config !== undefined ? { configPath: options.config } : {}),
  });
  process.stderr.write(`AgentSurf Remote HTTP MCP server listening on 127.0.0.1:${handle.port}\n`);
  const shutdown = async (): Promise<void> => {
    process.stderr.write('Stopping AgentSurf Remote HTTP MCP server...\n');
    await handle.close();
    process.exit(0);
  };
  process.once('SIGINT', () => void shutdown());
  process.once('SIGTERM', () => void shutdown());
}

async function handleRotateToken(args: string[]): Promise<void> {
  const options = parseRemoteArgs(args);
  const configPath = options.config ?? getDefaultRemoteConfigPath();
  const token = await rotateRemoteToken(configPath);
  process.stdout.write(
    `Bearer token rotated successfully.\n`
      + `  Config file:      ${configPath}\n`
      + `  New Bearer Token: ${token}\n\n`
      + `Update the token in Notion AI / Custom Agent connections.\n`,
  );
}

function printUsage(): void {
  process.stderr.write(
    'Usage:\n'
      + '  agentsurf-mcp\n'
      + '  agentsurf-mcp install-native-host --extension-id <extension-id> [--browser chrome|edge] [--port <port>]\n'
      + '  agentsurf-mcp init-remote --url <public-https-url> [--config <path>] [--port <port>]\n'
      + '  agentsurf-mcp start-remote [--config <path>]\n'
      + '  agentsurf-mcp rotate-remote-token [--config <path>]\n',
  );
}

void main().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : String(error);
  process.stderr.write(`agentsurf-mcp: ${message}\n`);
  process.exitCode = 1;
});
