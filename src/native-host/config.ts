import { randomBytes } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { homedir } from 'node:os';

export interface NativeHostConfig {
  port: number;
  token: string;
}

export function getDefaultConfigPath(): string {
  const localAppData = process.env.LOCALAPPDATA;
  const base = localAppData && localAppData.length > 0
    ? localAppData
    : join(homedir(), 'AppData', 'Local');
  return join(base, 'BrowserControlRuntime', 'config.json');
}

export async function loadOrCreateConfig(path = process.env.BROWSER_BRIDGE_CONFIG || getDefaultConfigPath()): Promise<NativeHostConfig> {
  try {
    const parsed = JSON.parse(await readFile(path, 'utf8')) as unknown;
    if (isNativeHostConfig(parsed)) return parsed;
    throw new Error(`Native Host config is invalid: ${path}`);
  } catch (error: unknown) {
    if (!isMissingFile(error)) throw error;
    const config: NativeHostConfig = {
      port: 8765,
      token: randomBytes(32).toString('hex'),
    };
    await mkdir(dirname(path), { recursive: true });
    await writeFile(path, `${JSON.stringify(config, null, 2)}\n`, { encoding: 'utf8', flag: 'wx' });
    return config;
  }
}

function isNativeHostConfig(value: unknown): value is NativeHostConfig {
  if (typeof value !== 'object' || value === null) return false;
  const record = value as Record<string, unknown>;
  return typeof record.port === 'number' && Number.isInteger(record.port) && record.port > 0 && record.port <= 65535 &&
    typeof record.token === 'string' && record.token.length >= 16;
}

function isMissingFile(error: unknown): boolean {
  return typeof error === 'object' && error !== null && 'code' in error && error.code === 'ENOENT';
}
