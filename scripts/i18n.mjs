import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);

const messages = {
  en: {
    setup: {
      title: 'AgentSurf setup',
      installingDependencies: 'Step 1/4: installing dependencies',
      building: 'Step 2/4: building the extension and MCP server',
      loadingExtension: 'Step 3/4: loading the Chrome extension',
      openExtensions: '  1. Open chrome://extensions',
      enableDeveloperMode: '  2. Turn on Developer mode',
      loadUnpacked: '  3. Click "Load unpacked" and select:',
      copyExtensionId: '  4. Copy the AgentSurf extension ID shown by Chrome',
      extensionIdPrompt: 'Extension ID: ',
      invalidExtensionId: 'That does not look like a Chrome extension ID. Expected 32 lowercase letters from a to p.',
      nodeVersion: 'AgentSurf requires Node.js 20 or newer.',
      unsupportedPlatform: 'The setup command currently supports Windows and macOS.',
      noInteractiveTerminal: 'No interactive terminal. Re-run with --extension-id <extension-id>.',
      registeringNativeHost: 'Step 4/4: registering the Native Host',
      complete: 'Setup complete. Copy the MCP JSON printed above into your agent configuration.',
      reload: 'Then reload AgentSurf in chrome://extensions and restart your MCP client.',
      missingOptionValue: (option) => `Missing value for ${option}.`,
      invalidPort: 'Port must be between 1 and 65535.',
      unknownOption: (option) => `Unknown option: ${option}.`,
      commandFailed: (command, reason) => `${command} failed with ${reason}.`,
      usage: [
        'Usage:',
        '  npm run setup',
        '  npm run setup -- --extension-id <extension-id> [--port <port>]',
      ],
    },
    nativeHost: {
      macOnly: 'This installer is for macOS only.',
      usage: 'Usage: npm run native-host:install:macos -- <extension-id> [port]',
      invalidPort: 'Port must be between 1 and 65535.',
      invalidToken: (path) => `Invalid token in existing configuration: ${path}`,
      launcherCheckFailed: (path, detail) => (
        `MCP launcher self-check failed: ${path} (${detail}). Check the Node and script paths.`
      ),
      installed: (extensionId) => `Native Host installed for Chrome extension ${extensionId}`,
      manifest: (path) => `Manifest: ${path}`,
      config: (path) => `Config: ${path}`,
      bridge: (port) => `Bridge: ws://127.0.0.1:${port}`,
      reload: 'Reload AgentSurf in Chrome. Reinstall after moving the project or changing the Node installation path.',
      mcpConfig: 'Add this to your MCP client configuration:',
    },
    uninstall: {
      macOnly: 'This uninstaller is for macOS only.',
      removed: 'AgentSurf Native Host registration and launcher removed.',
      preserved: 'Local configuration was preserved in ~/Library/Application Support/BrowserControlRuntime.',
    },
  },
  zh: {
    setup: {
      title: 'AgentSurf 安装向导',
      installingDependencies: '第 1/4 步：安装依赖',
      building: '第 2/4 步：构建扩展和 MCP Server',
      loadingExtension: '第 3/4 步：加载 Chrome 扩展',
      openExtensions: '  1. 打开 chrome://extensions',
      enableDeveloperMode: '  2. 开启“开发者模式” / Developer mode',
      loadUnpacked: '  3. 点击“加载已解压的扩展程序” / Load unpacked，然后选择：',
      copyExtensionId: '  4. 复制 Chrome 显示的 AgentSurf 扩展 ID',
      extensionIdPrompt: '扩展 ID：',
      invalidExtensionId: '这不是有效的 Chrome 扩展 ID。应为 32 个 a–p 的小写字母。',
      nodeVersion: 'AgentSurf 需要 Node.js 20 或更高版本。',
      unsupportedPlatform: '安装命令目前仅支持 Windows 和 macOS。',
      noInteractiveTerminal: '当前终端不支持交互。请使用 npm run setup -- --extension-id <extension-id> 重新运行。',
      registeringNativeHost: '第 4/4 步：注册 Native Host',
      complete: '安装完成。请把上面打印的 MCP JSON 加入 Agent 配置。',
      reload: '然后在 chrome://extensions 中重新加载 AgentSurf，并重启 MCP 客户端。',
      missingOptionValue: (option) => `参数 ${option} 缺少值。`,
      invalidPort: '端口必须在 1 到 65535 之间。',
      unknownOption: (option) => `未知参数：${option}。`,
      commandFailed: (command, reason) => `${command} 执行失败（${reason}）。`,
      usage: [
        '用法：',
        '  npm run setup',
        '  npm run setup -- --extension-id <extension-id> [--port <port>]',
      ],
    },
    nativeHost: {
      macOnly: '此安装程序仅支持 macOS。',
      usage: '用法：npm run native-host:install:macos -- <extension-id> [port]',
      invalidPort: '端口必须在 1 到 65535 之间。',
      invalidToken: (path) => `现有配置中的 token 无效：${path}`,
      launcherCheckFailed: (path, detail) => (
        `MCP 启动器自检失败：${path}（${detail}）。请检查 Node 和脚本路径。`
      ),
      installed: (extensionId) => `Native Host 已安装，Chrome 扩展 ID：${extensionId}`,
      manifest: (path) => `清单文件：${path}`,
      config: (path) => `配置文件：${path}`,
      bridge: (port) => `Bridge：ws://127.0.0.1:${port}`,
      reload: '请在 Chrome 中重新加载 AgentSurf。移动项目目录或更换 Node 安装路径后，需要重新执行安装。',
      mcpConfig: '将以下内容加入你的 MCP 客户端配置：',
    },
    uninstall: {
      macOnly: '此卸载程序仅支持 macOS。',
      removed: 'AgentSurf Native Host 注册和启动器已移除。',
      preserved: '本地配置保留在 ~/Library/Application Support/BrowserControlRuntime。',
    },
  },
};

export async function getMessages() {
  return messages[resolveLanguage(await detectSystemLocale())];
}

export function getMessagesForLocale(locale) {
  return messages[resolveLanguage(locale)];
}

function resolveLanguage(locale) {
  return typeof locale === 'string' && locale.toLowerCase().startsWith('zh') ? 'zh' : 'en';
}

async function detectSystemLocale() {
  if (process.platform === 'darwin') {
    const locale = await readMacLocale();
    if (locale) return locale;
  }
  if (process.platform === 'win32') {
    const locale = await readWindowsLocale();
    if (locale) return locale;
  }

  return firstNonEmpty(
    process.env.LC_ALL,
    process.env.LC_MESSAGES,
    process.env.LANG,
    process.env.LANGUAGE,
    Intl.DateTimeFormat().resolvedOptions().locale,
  );
}

async function readMacLocale() {
  const languages = await readCommand('defaults', ['read', '-g', 'AppleLanguages']);
  const language = languages
    ?.split('\n')
    .map((line) => line.trim().replaceAll(/[",()]/g, ''))
    .find((line) => /^[a-z]{2,3}(?:[-_][a-z0-9]+)*$/i.test(line));
  if (language) return language;

  return readCommand('defaults', ['read', '-g', 'AppleLocale']);
}

async function readWindowsLocale() {
  return readCommand('powershell', [
    '-NoProfile',
    '-NonInteractive',
    '-Command',
    '[System.Globalization.CultureInfo]::CurrentUICulture.Name',
  ]);
}

async function readCommand(command, args) {
  try {
    const { stdout } = await execFileAsync(command, args);
    return stdout.trim() || null;
  } catch {
    return null;
  }
}

function firstNonEmpty(...values) {
  return values.find((value) => typeof value === 'string' && value.trim() !== '') ?? 'en';
}
