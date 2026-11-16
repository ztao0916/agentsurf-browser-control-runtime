import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { z } from 'zod';
import { getDefaultConfigPath, getRuntimeRoot } from '../native-host/config';
import type { RemoteAccessMode } from '../core/remote-policy';
import { constantTimeHashEqual, verifyOAuthAccessToken } from './remote-oauth';

const oauthConfigSchema = z.object({
  client_id: z.string().min(1),
  client_secret_hash: z.string().regex(/^[a-f0-9]{64}$/u),
  redirect_uris: z.array(z.string().url()).max(32).default([]),
}).strict();

const configSchema = z.object({
  version: z.literal(1),
  principal: z.string().uuid(),
  token_hash: z.string().regex(/^[a-f0-9]{64}$/u),
  port: z.number().int().min(0).max(65535),
  allowed_hosts: z.array(z.string().min(1)).min(1).max(16),
  allowed_origins: z.array(z.string().url()).max(16),
  bridge_config: z.string().min(1),
  access_mode: z.enum(['read-only', 'interactive']).optional().default('interactive'),
  public_url: z.string().url().optional(),
  oauth: oauthConfigSchema.optional(),
}).strict();

export type RemoteOAuthConfig = z.infer<typeof oauthConfigSchema>;
export type RemoteConfig = z.infer<typeof configSchema>;

export const tokenHash = (token: string): string => createHash('sha256').update(token).digest('hex');

export async function readRemoteConfig(path: string): Promise<RemoteConfig> {
  return configSchema.parse(JSON.parse(await readFile(path, 'utf8')) as unknown);
}

export function getDefaultRemoteConfigPath(): string {
  return join(getRuntimeRoot(), 'remote-config.json');
}

export function getDefaultRemoteSessionStorePath(): string {
  return join(getRuntimeRoot(), 'remote-sessions.json');
}

export function authenticates(header: string | undefined, config: RemoteConfig): boolean {
  if (!header?.startsWith('Bearer ') || header.length > 4096) return false;
  const candidate = header.slice(7);
  if (constantTimeHashEqual(candidate, config.token_hash)) return true;
  return verifyOAuthAccessToken(candidate, config);
}

function validatePublicUrl(publicUrl: string): string {
  const url = new URL(publicUrl);
  if (url.protocol !== 'https:' || url.username || url.password || url.search || url.hash) {
    throw new Error('Public URL must use HTTPS without credentials, query or fragment.');
  }
  return url.toString().replace(/\/+$/u, '');
}

export function validateRedirectUri(uri: string): string {
  const trimmed = uri.trim();
  const url = new URL(trimmed);
  if (url.hash) {
    throw new Error('Redirect URI must not contain a fragment (#).');
  }
  const isLoopback = ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname);
  if (url.protocol !== 'https:' && !(url.protocol === 'http:' && isLoopback)) {
    throw new Error('Redirect URI must use HTTPS (or http://localhost / http://127.0.0.1 for local testing).');
  }
  return trimmed;
}

export async function initializeRemoteConfig(
  path: string = getDefaultRemoteConfigPath(),
  publicUrl: string,
  bridgeConfig: string = getDefaultConfigPath(),
  port = 8767,
): Promise<string> {
  const normalizedPublicUrl = validatePublicUrl(publicUrl);
  const url = new URL(normalizedPublicUrl);
  const token = randomBytes(32).toString('base64url');
  const allowedOrigins = [url.origin];
  for (const origin of ['https://www.notion.so', 'https://gemini.google.com']) {
    if (!allowedOrigins.includes(origin)) allowedOrigins.push(origin);
  }
  const isLoopback = ['127.0.0.1', 'localhost', '[::1]'].includes(url.hostname.toLowerCase());
  const publicHost = isLoopback ? url.host : url.hostname;
  const config: RemoteConfig = configSchema.parse({
    version: 1, principal: randomUUID(), token_hash: tokenHash(token), port,
    allowed_hosts: [publicHost, `127.0.0.1:${port}`, `localhost:${port}`],
    allowed_origins: allowedOrigins, bridge_config: resolve(bridgeConfig), access_mode: 'read-only',
    public_url: normalizedPublicUrl,
  });
  await mkdir(dirname(resolve(path)), { recursive: true, mode: 0o700 });
  await writeFile(path, `${JSON.stringify(config, null, 2)}\n`, { mode: 0o600, flag: 'wx' });
  return token;
}

export async function initializeOAuthClient(
  path: string = getDefaultRemoteConfigPath(),
  options: { redirectUris?: string[]; publicUrl?: string; force?: boolean } = {},
): Promise<{ clientId: string; clientSecret: string; redirectUris: string[] }> {
  const config = await readRemoteConfig(path);
  if (config.oauth && !options.force) {
    throw new Error('OAuth client is already configured. Use add-oauth-redirect or rotate-oauth-secret (or pass --force to regenerate).');
  }
  const redirectUris = [...new Set((options.redirectUris ?? []).map(validateRedirectUri))];
  if (redirectUris.length > 32) {
    throw new Error('Too many redirect URIs (maximum 32).');
  }
  const clientId = `as_cid_${randomBytes(16).toString('base64url')}`;
  const clientSecret = `as_sec_${randomBytes(32).toString('base64url')}`;
  const publicUrl = options.publicUrl !== undefined
    ? validatePublicUrl(options.publicUrl)
    : config.public_url ?? config.allowed_origins.find(
      (origin) => origin !== 'https://www.notion.so' && origin !== 'https://gemini.google.com',
    );
  const allowedOrigins = [...config.allowed_origins];
  if (!allowedOrigins.includes('https://gemini.google.com') && allowedOrigins.length < 16) {
    allowedOrigins.push('https://gemini.google.com');
  }

  const nextConfig: RemoteConfig = configSchema.parse({
    ...config,
    allowed_origins: allowedOrigins,
    ...(publicUrl !== undefined ? { public_url: publicUrl } : {}),
    oauth: {
      client_id: clientId,
      client_secret_hash: tokenHash(clientSecret),
      redirect_uris: redirectUris,
    },
  });
  await writePrivateJson(path, nextConfig);
  return { clientId, clientSecret, redirectUris };
}

export async function addOAuthRedirectUri(
  path: string = getDefaultRemoteConfigPath(),
  redirectUri: string,
): Promise<string[]> {
  const config = await readRemoteConfig(path);
  if (!config.oauth) {
    throw new Error('OAuth client is not configured yet. Run init-oauth first.');
  }
  const normalized = validateRedirectUri(redirectUri);
  const redirectUris = config.oauth.redirect_uris.includes(normalized)
    ? config.oauth.redirect_uris
    : [...config.oauth.redirect_uris, normalized];
  const nextConfig: RemoteConfig = configSchema.parse({
    ...config,
    oauth: {
      ...config.oauth,
      redirect_uris: redirectUris,
    },
  });
  await writePrivateJson(path, nextConfig);
  return redirectUris;
}

export async function rotateOAuthSecret(
  path: string = getDefaultRemoteConfigPath(),
): Promise<{ clientId: string; clientSecret: string }> {
  const config = await readRemoteConfig(path);
  if (!config.oauth) {
    throw new Error('OAuth client is not configured yet. Run init-oauth first.');
  }
  const clientSecret = `as_sec_${randomBytes(32).toString('base64url')}`;
  const nextConfig: RemoteConfig = configSchema.parse({
    ...config,
    oauth: {
      ...config.oauth,
      client_secret_hash: tokenHash(clientSecret),
    },
  });
  await writePrivateJson(path, nextConfig);
  return { clientId: config.oauth.client_id, clientSecret };
}

export async function rotateRemoteToken(path: string): Promise<string> {
  const config = await readRemoteConfig(path);
  const token = randomBytes(32).toString('base64url');
  await writePrivateJson(path, { ...config, token_hash: tokenHash(token) });
  return token;
}

export async function setRemoteAccessMode(path: string, accessMode: RemoteAccessMode): Promise<void> {
  const config = await readRemoteConfig(path);
  await writePrivateJson(path, { ...config, access_mode: accessMode });
}

export async function writePrivateJson(path: string, value: unknown): Promise<void> {
  const temporary = `${path}.${randomUUID()}.tmp`;
  await writeFile(temporary, `${JSON.stringify(value)}\n`, { mode: 0o600, flag: 'wx' });
  await rename(temporary, path);
}
