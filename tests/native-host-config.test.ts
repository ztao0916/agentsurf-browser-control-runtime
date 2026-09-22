import { homedir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { getDefaultConfigPath } from '../src/native-host/config';

describe('Native Host config paths', () => {
  it('keeps the legacy root config as the default', () => {
    const runtimeRoot = process.platform === 'darwin'
      ? join(homedir(), 'Library', 'Application Support', 'BrowserControlRuntime')
      : join(process.env.LOCALAPPDATA || join(homedir(), 'AppData', 'Local'), 'BrowserControlRuntime');

    expect(getDefaultConfigPath()).toBe(join(runtimeRoot, 'config.json'));
  });
});
