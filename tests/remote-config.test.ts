import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  authenticates,
  initializeRemoteConfig,
  readRemoteConfig,
  rotateRemoteToken,
  tokenHash,
} from '../src/mcp/remote-config';

describe('remote-config', () => {
  let tempDir: string;
  let configPath: string;
  let bridgeConfigPath: string;

  beforeEach(async () => {
    tempDir = await mkdtemp(join(tmpdir(), 'agentsurf-remote-config-test-'));
    configPath = join(tempDir, 'remote-config.json');
    bridgeConfigPath = join(tempDir, 'bridge-config.json');
  });

  afterEach(async () => {
    await rm(tempDir, { recursive: true, force: true });
  });

  it('rejects invalid public URLs', async () => {
    await expect(initializeRemoteConfig(configPath, 'http://example.com', bridgeConfigPath))
      .rejects.toThrow('Public URL must use HTTPS');
    await expect(initializeRemoteConfig(configPath, 'https://user:pass@example.com', bridgeConfigPath))
      .rejects.toThrow('Public URL must use HTTPS without credentials');
    await expect(initializeRemoteConfig(configPath, 'https://example.com?query=1', bridgeConfigPath))
      .rejects.toThrow('Public URL must use HTTPS without credentials, query or fragment');
    await expect(initializeRemoteConfig(configPath, 'https://example.com#fragment', bridgeConfigPath))
      .rejects.toThrow('Public URL must use HTTPS without credentials, query or fragment');
  });

  it('initializes a valid remote configuration and returns the Bearer token', async () => {
    const token = await initializeRemoteConfig(
      configPath,
      'https://tunnel.example.com',
      bridgeConfigPath,
      8767,
    );

    expect(typeof token).toBe('string');
    expect(token.length).toBeGreaterThanOrEqual(40);

    const config = await readRemoteConfig(configPath);
    expect(config.version).toBe(1);
    expect(config.port).toBe(8767);
    expect(config.token_hash).toBe(tokenHash(token));
    expect(config.allowed_hosts).toContain('tunnel.example.com');
    expect(config.allowed_hosts).toContain('127.0.0.1:8767');
    expect(config.allowed_origins).toContain('https://tunnel.example.com');
    expect(config.allowed_origins).toContain('https://www.notion.so');

    // Authenticates with the generated token
    expect(authenticates(`Bearer ${token}`, config)).toBe(true);
    expect(authenticates(`Bearer wrong-token`, config)).toBe(false);
    expect(authenticates(undefined, config)).toBe(false);
    expect(authenticates(`Basic ${token}`, config)).toBe(false);
  });

  it('rotates remote token and updates file', async () => {
    const originalToken = await initializeRemoteConfig(
      configPath,
      'https://tunnel.example.com',
      bridgeConfigPath,
    );

    const originalConfig = await readRemoteConfig(configPath);
    expect(authenticates(`Bearer ${originalToken}`, originalConfig)).toBe(true);

    const newToken = await rotateRemoteToken(configPath);
    expect(newToken).not.toBe(originalToken);

    const updatedConfig = await readRemoteConfig(configPath);
    expect(authenticates(`Bearer ${newToken}`, updatedConfig)).toBe(true);
    expect(authenticates(`Bearer ${originalToken}`, updatedConfig)).toBe(false);
  });
});
