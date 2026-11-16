#!/usr/bin/env node

import { getDefaultConfigPath } from '../native-host/config';
import { startHttpMcpServer } from './http-server';
import { installNativeHost } from './install-native-host';
import {
  addOAuthRedirectUri,
  getDefaultRemoteConfigPath,
  initializeOAuthClient,
  initializeRemoteConfig,
  readRemoteConfig,
  rotateOAuthSecret,
  rotateRemoteToken,
  setRemoteAccessMode,
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
  if (command === 'init-oauth') {
    await handleInitOAuth(args);
    return;
  }
  if (command === 'add-oauth-redirect') {
    await handleAddOAuthRedirect(args);
    return;
  }
  if (command === 'rotate-oauth-secret') {
    await handleRotateOAuthSecret(args);
    return;
  }
  if (command === 'rotate-remote-token') {
    await handleRotateToken(args);
    return;
  }
  if (command === 'set-remote-access') {
    await handleSetRemoteAccess(args);
    return;
  }
  if (command === 'doctor') {
    await handleDoctor(args);
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
  redirectUris: string[];
  uri?: string | undefined;
  force: boolean;
} {
  const result: {
    url?: string | undefined;
    config?: string | undefined;
    port?: number | undefined;
    bridgeConfig?: string | undefined;
    redirectUris: string[];
    uri?: string | undefined;
    force: boolean;
  } = { redirectUris: [], force: false };
  for (let i = 0; i < args.length; i += 1) {
    const arg = args[i];
    if (!arg) continue;
    if (arg === '--force') {
      result.force = true;
      continue;
    }
    const [flag, inlineVal] = arg.split('=', 2);
    const val = inlineVal ?? args[i + 1];
    if (inlineVal === undefined) i += 1;
    if (flag === '--url') result.url = val;
    else if (flag === '--config') result.config = val;
    else if (flag === '--port') result.port = Number(val);
    else if (flag === '--bridge-config') result.bridgeConfig = val;
    else if (flag === '--redirect-uri' && val) result.redirectUris.push(val);
    else if (flag === '--uri') result.uri = val;
    else throw new Error(`Unknown option: ${arg}`);
  }
  return result;
}

function parseDoctorArgs(args: string[]): { config?: string; url?: string } {
  const result: { config?: string; url?: string } = {};
  for (let i = 0; i < args.length; i += 1) {
    const arg = args[i];
    if (!arg) continue;
    const [flag, inlineValue] = arg.split('=', 2);
    const value = inlineValue ?? args[i + 1];
    if (inlineValue === undefined) i += 1;
    if (flag === '--config' && value) result.config = value;
    else if (flag === '--url' && value) result.url = value;
    else throw new Error(`Unknown option: ${arg}`);
  }
  return result;
}

async function handleInitRemote(args: string[]): Promise<void> {
  const options = parseRemoteArgs(args);
  if (!options.url) {
    throw new Error('Usage: agentsurf-mcp init-remote --url <public-https-url> [--config <path>] [--port <port>] [--redirect-uri <uri>]');
  }
  const configPath = options.config ?? getDefaultRemoteConfigPath();
  const port = options.port ?? 8767;
  const token = await initializeRemoteConfig(
    configPath,
    options.url,
    options.bridgeConfig ?? getDefaultConfigPath(),
    port,
  );
  const oauth = await initializeOAuthClient(configPath, {
    redirectUris: options.redirectUris,
    publicUrl: options.url,
  });
  const cleanUrl = options.url.replace(/\/+$/u, '');
  const wsUrl = cleanUrl.replace(/^http:/i, 'ws:').replace(/^https:/i, 'wss:');
  process.stdout.write(
    `AgentSurf Remote Gateway configuration created successfully.\n\n`
      + `  Config file:         ${configPath}\n`
      + `  Bearer Token:        ${token}\n`
      + `  OAuth Client ID:     ${oauth.clientId}\n`
      + `  OAuth Client Secret: ${oauth.clientSecret}\n`
      + `  OAuth Redirect URIs: ${oauth.redirectUris.length > 0 ? oauth.redirectUris.join(', ') : '(none yet — run add-oauth-redirect --uri <uri>)'}\n`
      + `  Public MCP URL:      ${cleanUrl}/mcp\n`
      + `  Access mode:         read-only (change with set-remote-access --mode interactive)\n`
      + `  Gateway WS URL:      ${wsUrl}/ws\n\n`
      + `Remote Client Setup (Bearer Token clients like Notion AI, Dify):\n`
      + `  1. Add MCP connection in your remote client or platform:\n`
      + `     - Server URL:     ${cleanUrl}/mcp\n`
      + `     - Authentication: Bearer Token\n`
      + `     - Token:          ${token}\n\n`
      + `Remote Client Setup (OAuth 2.0 clients like Gemini Web):\n`
      + `  1. Enter Server URL, Client ID and Client Secret above.\n`
      + `  2. Register the client's Redirect URI if not already added:\n`
      + `     agentsurf-mcp add-oauth-redirect --uri <redirect-uri>\n`
      + `  3. When prompted in the browser, enter the Bearer Token above to authorize.\n\n`
      + `Chrome Extension Setup (0 terminal commands needed!):\n`
      + `  1. Click AgentSurf extension in Chrome -> Choose 'Remote Gateway'\n`
      + `     - Gateway URL:    ${wsUrl}/ws\n`
      + `     - Pairing Token:  ${token}\n`
      + `     - Click 'Save & Connect'\n\n`
      + `Start the gateway server with:\n`
      + `  agentsurf-mcp start-gateway\n`,
  );
}

async function handleInitOAuth(args: string[]): Promise<void> {
  const options = parseRemoteArgs(args);
  const configPath = options.config ?? getDefaultRemoteConfigPath();
  const oauth = await initializeOAuthClient(configPath, {
    redirectUris: options.redirectUris,
    ...(options.url !== undefined ? { publicUrl: options.url } : {}),
    force: options.force,
  });
  process.stdout.write(
    `AgentSurf OAuth client configured successfully.\n\n`
      + `  Config file:         ${configPath}\n`
      + `  OAuth Client ID:     ${oauth.clientId}\n`
      + `  OAuth Client Secret: ${oauth.clientSecret}\n`
      + `  OAuth Redirect URIs: ${oauth.redirectUris.length > 0 ? oauth.redirectUris.join(', ') : '(none yet — run add-oauth-redirect --uri <uri>)'}\n\n`
      + `Note: Your existing Bearer Pairing Token is unchanged. Use it to approve OAuth login prompts.\n`,
  );
}

async function handleAddOAuthRedirect(args: string[]): Promise<void> {
  const options = parseRemoteArgs(args);
  const uri = options.uri ?? options.redirectUris[0];
  if (!uri) {
    throw new Error('Usage: agentsurf-mcp add-oauth-redirect --uri <redirect-uri> [--config <path>]');
  }
  const configPath = options.config ?? getDefaultRemoteConfigPath();
  const redirectUris = await addOAuthRedirectUri(configPath, uri);
  process.stdout.write(
    `OAuth redirect URI added.\n`
      + `  Config file:         ${configPath}\n`
      + `  OAuth Redirect URIs: ${redirectUris.join(', ')}\n`,
  );
}

async function handleRotateOAuthSecret(args: string[]): Promise<void> {
  const options = parseRemoteArgs(args);
  const configPath = options.config ?? getDefaultRemoteConfigPath();
  const rotated = await rotateOAuthSecret(configPath);
  process.stdout.write(
    `OAuth client secret rotated successfully.\n`
      + `  Config file:             ${configPath}\n`
      + `  OAuth Client ID:         ${rotated.clientId}\n`
      + `  New OAuth Client Secret: ${rotated.clientSecret}\n\n`
      + `Update the Client Secret in your OAuth MCP client (e.g. Gemini Web).\n`,
  );
}

async function handleSetRemoteAccess(args: string[]): Promise<void> {
  let mode: 'read-only' | 'interactive' | undefined;
  let configPath = getDefaultRemoteConfigPath();
  for (let i = 0; i < args.length; i += 1) {
    const arg = args[i];
    if (!arg) continue;
    const [flag, inlineValue] = arg.split('=', 2);
    const value = inlineValue ?? args[i + 1];
    if (inlineValue === undefined) i += 1;
    if (flag === '--mode' && (value === 'read-only' || value === 'interactive')) mode = value;
    else if (flag === '--config' && value) configPath = value;
    else throw new Error(`Usage: agentsurf-mcp set-remote-access --mode read-only|interactive [--config <path>]`);
  }
  if (!mode) throw new Error('Usage: agentsurf-mcp set-remote-access --mode read-only|interactive [--config <path>]');
  await setRemoteAccessMode(configPath, mode);
  process.stdout.write(`Remote access mode set to ${mode}. Restart the gateway to refresh the published MCP tools.\n`);
}

async function handleDoctor(args: string[]): Promise<void> {
  const options = parseDoctorArgs(args);
  const configPath = options.config ?? getDefaultRemoteConfigPath();
  let config;
  try {
    config = await readRemoteConfig(configPath);
    process.stdout.write(`PASS remote config: ${configPath}\n`);
    process.stdout.write(`INFO access mode: ${config.access_mode}\n`);
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error);
    process.stderr.write(`FAIL remote config: ${message}\n`);
    process.exitCode = 1;
    return;
  }

  const localUrl = `http://127.0.0.1:${config.port}/healthz`;
  let extensionConnected = false;
  try {
    const response = await fetch(localUrl, { signal: AbortSignal.timeout(5000) });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const health = await response.json() as { status?: string; extension_connected?: boolean };
    if (health.status !== 'ok') throw new Error('Unexpected health response');
    extensionConnected = health.extension_connected === true;
    process.stdout.write(`PASS local gateway health: ${localUrl}\n`);
    process.stdout.write(`${extensionConnected ? 'PASS' : 'WARN'} Chrome extension: ${extensionConnected ? 'connected' : 'not connected'}\n`);
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error);
    process.stderr.write(`FAIL local gateway health: ${message}\n`);
    process.exitCode = 1;
  }

  if (options.url) {
    let healthUrl: string;
    try {
      const url = new URL(options.url);
      if (!['http:', 'https:'].includes(url.protocol)) throw new Error('URL must use HTTP or HTTPS');
      healthUrl = `${url.origin}${url.pathname.replace(/\/+$/u, '')}/healthz`;
      const response = await fetch(healthUrl, { signal: AbortSignal.timeout(5000) });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      process.stdout.write(`PASS public gateway health: ${healthUrl}\n`);
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : String(error);
      process.stderr.write(`FAIL public gateway health: ${message}\n`);
      process.exitCode = 1;
    }
  }
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
      + '  agentsurf-mcp init-remote --url <public-https-url> [--config <path>] [--port <port>] [--redirect-uri <uri>]\n'
      + '  agentsurf-mcp init-oauth [--config <path>] [--url <public-https-url>] [--redirect-uri <uri>] [--force]\n'
      + '  agentsurf-mcp add-oauth-redirect --uri <redirect-uri> [--config <path>]\n'
      + '  agentsurf-mcp rotate-oauth-secret [--config <path>]\n'
      + '  agentsurf-mcp start-remote [--config <path>]\n'
      + '  agentsurf-mcp doctor [--config <path>] [--url <public-gateway-url>]\n'
      + '  agentsurf-mcp set-remote-access --mode read-only|interactive [--config <path>]\n'
      + '  agentsurf-mcp rotate-remote-token [--config <path>]\n',
  );
}

void main().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : String(error);
  process.stderr.write(`agentsurf-mcp: ${message}\n`);
  process.exitCode = 1;
});
