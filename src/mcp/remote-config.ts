import { createHash, randomBytes, randomUUID, timingSafeEqual } from 'node:crypto';
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { z } from 'zod';
import { getDefaultConfigPath, getRuntimeRoot } from '../native-host/config';
import type { RemoteAccessMode } from '../core/remote-policy';

const configSchema = z.object({
  version: z.literal(1),
  principal: z.string().uuid(),
  token_hash: z.string().regex(/^[a-f0-9]{64}$/u),
  port: z.number().int().min(0).max(65535),
  allowed_hosts: z.array(z.string().min(1)).min(1).max(16),
  allowed_origins: z.array(z.string().url()).max(16),
  bridge_config: z.string().min(1),
  access_mode: z.enum(['read-only', 'interactive']).optional().default('interactive'),
}).strict();

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
  return timingSafeEqual(Buffer.from(tokenHash(header.slice(7)), 'hex'), Buffer.from(config.token_hash, 'hex'));
}

export async function initializeRemoteConfig(
  path: string = getDefaultRemoteConfigPath(),
  publicUrl: string,
  bridgeConfig: string = getDefaultConfigPath(),
  port = 8767,
): Promise<string> {
  const url = new URL(publicUrl);
  if (url.protocol !== 'https:' || url.username || url.password || url.search || url.hash) throw new Error('Public URL must use HTTPS without credentials, query or fragment.');
  const token = randomBytes(32).toString('base64url');
  const allowedOrigins = [url.origin];
  if (!allowedOrigins.includes('https://www.notion.so')) {
    allowedOrigins.push('https://www.notion.so');
  }
  const config: RemoteConfig = configSchema.parse({
    version: 1, principal: randomUUID(), token_hash: tokenHash(token), port,
    allowed_hosts: [url.host, `127.0.0.1:${port}`, `localhost:${port}`],
    allowed_origins: allowedOrigins, bridge_config: resolve(bridgeConfig), access_mode: 'read-only',
  });
  await mkdir(dirname(resolve(path)), { recursive: true, mode: 0o700 });
  await writeFile(path, `${JSON.stringify(config, null, 2)}\n`, { mode: 0o600, flag: 'wx' });
  return token;
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
