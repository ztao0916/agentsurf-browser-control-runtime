import { execFile } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { access, chmod, copyFile, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);
const HOST_NAME = 'com.browsercontrol.runtime';
type BrowserId = 'chrome' | 'edge';

const BROWSERS: Record<BrowserId, {
  label: string;
  defaultPort: number;
  windowsRegistry: string;
  macosManifestDirectory: string[];
}> = {
  chrome: {
    label: 'Chrome',
    defaultPort: 8765,
    windowsRegistry: 'Google\\Chrome',
    macosManifestDirectory: ['Google', 'Chrome', 'NativeMessagingHosts'],
  },
  edge: {
    label: 'Edge',
    defaultPort: 8766,
    windowsRegistry: 'Microsoft\\Edge',
    macosManifestDirectory: ['Microsoft Edge', 'NativeMessagingHosts'],
  },
};

interface InstallOptions {
  browser: BrowserId;
  extensionId: string;
  legacy: boolean;
  port: number;
}

export async function installNativeHost(args: string[]): Promise<void> {
  const options = parseArgs(args);
  // In the published package this file lives in dist/mcp/, next to dist/native-host/host.js.
  const packagedHostScript = join(dirname(fileURLToPath(import.meta.url)), '..', 'native-host', 'host.js');
  try {
    await access(packagedHostScript);
  } catch {
    throw new Error(`Native Host build not found: ${packagedHostScript}. Run npm run build first.`);
  }

  if (process.platform === 'win32') {
    await installOnWindows(options, packagedHostScript);
    return;
  }
  if (process.platform === 'darwin') {
    await installOnMacos(options, packagedHostScript);
    return;
  }
  throw new Error('install-native-host currently supports Windows and macOS only.');
}

function parseArgs(args: string[]): InstallOptions {
  let extensionId: string | undefined;
  let browser: BrowserId = 'chrome';
  let legacy = true;
  let port: number | undefined;
  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (arg === undefined) continue;
    const [flag, inlineValue] = arg.split('=', 2);
    const value = inlineValue ?? args[index + 1];
    if (inlineValue === undefined) index += 1;
    if (flag === '--extension-id') extensionId = value;
    else if (flag === '--browser') {
      if (value !== 'chrome' && value !== 'edge') {
        throw new Error('Browser must be chrome or edge.');
      }
      browser = value;
      legacy = false;
    }
    else if (flag === '--port') port = Number(value);
    else throw new Error(`Unknown option: ${arg}`);
  }
  if (extensionId === undefined || !/^[a-p]{32}$/.test(extensionId)) {
    throw new Error('Usage: agentsurf-mcp install-native-host --extension-id <extension-id> [--browser chrome|edge] [--port <port>]');
  }
  port ??= BROWSERS[browser].defaultPort;
  if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error('Port must be between 1 and 65535.');
  return { browser, extensionId, legacy, port };
}

async function ensureConfig(runtimeDirectory: string, port: number, legacyConfigPath?: string): Promise<string> {
  const configPath = join(runtimeDirectory, 'config.json');
  let token: string | undefined;
  try {
    const existing = JSON.parse(await readFile(configPath, 'utf8')) as unknown;
    if (typeof existing === 'object' && existing !== null && 'token' in existing) {
      const existingToken = existing.token;
      if (typeof existingToken === 'string' && existingToken.length >= 16) token = existingToken;
    }
  } catch (error: unknown) {
    if (!isMissingFile(error)) throw error;
  }
  if (token === undefined && legacyConfigPath !== undefined) {
    try {
      const existing = JSON.parse(await readFile(legacyConfigPath, 'utf8')) as unknown;
      if (typeof existing === 'object' && existing !== null && 'token' in existing) {
        const existingToken = existing.token;
        if (typeof existingToken === 'string' && existingToken.length >= 16) token = existingToken;
      }
    } catch (error: unknown) {
      if (!isMissingFile(error)) throw error;
    }
  }
  token ??= randomBytes(32).toString('hex');
  await writeFile(configPath, `${JSON.stringify({ port, token }, null, 2)}\n`, 'utf8');
  return configPath;
}

async function installOnWindows(options: InstallOptions, packagedHostScript: string): Promise<void> {
  const localAppData = process.env.LOCALAPPDATA;
  const runtimeRoot = join(
    localAppData && localAppData.length > 0 ? localAppData : join(homedir(), 'AppData', 'Local'),
    'BrowserControlRuntime',
  );
  const runtimeDirectory = options.legacy ? runtimeRoot : join(runtimeRoot, options.browser);
  await mkdir(runtimeDirectory, { recursive: true });
  const configPath = await ensureConfig(
    runtimeDirectory,
    options.port,
    !options.legacy && options.browser === 'chrome' ? join(runtimeRoot, 'config.json') : undefined,
  );
  const hostScript = join(runtimeDirectory, 'host.js');
  await copyFile(packagedHostScript, hostScript);

  const launcherPath = join(runtimeDirectory, 'native-host.exe');
  const launcherSourcePath = join(runtimeDirectory, 'native-host-launcher.cs');
  await rm(launcherPath, { force: true });
  await rm(join(runtimeDirectory, 'native-host.cmd'), { force: true });
  // BOM so the C# compiler reads non-ASCII paths correctly.
  await writeFile(launcherSourcePath, `\ufeff${windowsLauncherSource(process.execPath, hostScript, configPath)}`, 'utf8');
  try {
    await execFileAsync('powershell', [
      '-NoProfile',
      '-ExecutionPolicy',
      'Bypass',
      '-Command',
      `Add-Type -Path ${psQuote(launcherSourcePath)} -OutputAssembly ${psQuote(launcherPath)} -OutputType ConsoleApplication`,
    ]);
  } finally {
    await rm(launcherSourcePath, { force: true });
  }

  const manifestPath = join(runtimeDirectory, `${HOST_NAME}.json`);
  await writeFile(manifestPath, `${JSON.stringify(nativeHostManifest(launcherPath, options.extensionId, options.browser), null, 2)}\n`, 'utf8');
  await execFileAsync('reg', [
    'add',
    `HKCU\\Software\\${BROWSERS[options.browser].windowsRegistry}\\NativeMessagingHosts\\${HOST_NAME}`,
    '/ve',
    '/t',
    'REG_SZ',
    '/d',
    manifestPath,
    '/f',
  ]);

  printResult(options, manifestPath, configPath);
}

async function installOnMacos(options: InstallOptions, packagedHostScript: string): Promise<void> {
  const supportDirectory = join(homedir(), 'Library', 'Application Support');
  const runtimeRoot = join(supportDirectory, 'BrowserControlRuntime');
  const runtimeDirectory = options.legacy ? runtimeRoot : join(runtimeRoot, options.browser);
  const manifestDirectory = join(supportDirectory, ...BROWSERS[options.browser].macosManifestDirectory);
  await mkdir(runtimeDirectory, { recursive: true, mode: 0o700 });
  await mkdir(manifestDirectory, { recursive: true });
  const configPath = await ensureConfig(
    runtimeDirectory,
    options.port,
    !options.legacy && options.browser === 'chrome' ? join(runtimeRoot, 'config.json') : undefined,
  );
  await chmod(configPath, 0o600);
  const hostScript = join(runtimeDirectory, 'host.js');
  await copyFile(packagedHostScript, hostScript);

  const launcherPath = join(runtimeDirectory, 'native-host.sh');
  const quote = (value: string): string => `'${value.replaceAll("'", "'\\''")}'`;
  await writeFile(
    launcherPath,
    `#!/bin/sh\nexport BROWSER_BRIDGE_CONFIG=${quote(configPath)}\nexec ${quote(process.execPath)} ${quote(hostScript)}\n`,
    { mode: 0o700 },
  );
  await chmod(launcherPath, 0o700);

  const manifestPath = join(manifestDirectory, `${HOST_NAME}.json`);
  await writeFile(manifestPath, `${JSON.stringify(nativeHostManifest(launcherPath, options.extensionId, options.browser), null, 2)}\n`, 'utf8');

  printResult(options, manifestPath, configPath);
}

function nativeHostManifest(launcherPath: string, extensionId: string, browser: BrowserId): Record<string, unknown> {
  return {
    name: HOST_NAME,
    description: `AgentSurf native messaging host for ${BROWSERS[browser].label}`,
    path: launcherPath,
    type: 'stdio',
    allowed_origins: [`chrome-extension://${extensionId}/`],
  };
}

function printResult(options: InstallOptions, manifestPath: string, configPath: string): void {
  console.log(`${BROWSERS[options.browser].label} Native Host installed for extension ${options.extensionId}`);
  console.log(`Manifest: ${manifestPath}`);
  console.log(`Config:   ${configPath}`);
  console.log(`Bridge:   ws://127.0.0.1:${options.port}`);
  console.log(`Reload the AgentSurf extension in ${BROWSERS[options.browser].label}. Re-run this command after upgrading the npm package.`);
}

function windowsLauncherSource(nodePath: string, hostScript: string, configPath: string): string {
  const escape = (value: string): string => value.replaceAll('\\', '\\\\').replaceAll('"', '\\"');
  return `using System;
using System.Diagnostics;
using System.IO;
using System.Threading.Tasks;

internal static class NativeHostLauncher
{
    private const string NodePath = "${escape(nodePath)}";
    private const string HostScript = "${escape(hostScript)}";
    private const string ConfigPath = "${escape(configPath)}";

    private static void Forward(Stream source, Stream destination)
    {
        var buffer = new byte[8192];
        int count;
        while ((count = source.Read(buffer, 0, buffer.Length)) > 0)
        {
            destination.Write(buffer, 0, count);
            // Native Messaging exchanges small frames while pipes stay open.
            destination.Flush();
        }
    }

    public static int Main()
    {
        var startInfo = new ProcessStartInfo
        {
            FileName = NodePath,
            Arguments = "\\"" + HostScript + "\\"",
            UseShellExecute = false,
            CreateNoWindow = true,
            RedirectStandardInput = true,
            RedirectStandardOutput = true,
            RedirectStandardError = true
        };
        startInfo.EnvironmentVariables["BROWSER_BRIDGE_CONFIG"] = ConfigPath;
        using (var process = Process.Start(startInfo))
        {
            if (process == null) return 1;
            Task.Run(() =>
            {
                try { Forward(Console.OpenStandardInput(), process.StandardInput.BaseStream); }
                finally { process.StandardInput.Close(); }
            });
            var output = Task.Run(() => Forward(process.StandardOutput.BaseStream, Console.OpenStandardOutput()));
            var error = Task.Run(() => Forward(process.StandardError.BaseStream, Console.OpenStandardError()));
            process.WaitForExit();
            Task.WaitAll(output, error);
            return process.ExitCode;
        }
    }
}
`;
}

function psQuote(value: string): string {
  return `'${value.replaceAll("'", "''")}'`;
}

function isMissingFile(error: unknown): boolean {
  return typeof error === 'object' && error !== null && 'code' in error && error.code === 'ENOENT';
}
