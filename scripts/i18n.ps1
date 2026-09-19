function Get-AgentSurfLanguage {
  $cultureName = [System.Globalization.CultureInfo]::CurrentUICulture.Name
  if ($cultureName -like 'zh*') {
    return 'zh'
  }
  return 'en'
}

function Get-AgentSurfText {
  if ((Get-AgentSurfLanguage) -eq 'zh') {
    return @{
      NativeHostBuildMissing = '未找到 Native Host 构建产物：{0}。请先运行 npm run build。'
      NativeHostReplaceLocked = '无法替换 {0}，因为正在运行的 Native Host 锁定了该文件。请在 chrome://extensions 中停用 AgentSurf（或关闭 Chrome），等待几秒后重新执行安装命令。'
      McpBuildMissing = '未找到 MCP Server 构建产物：{0}。请先运行 npm run build。'
      McpLauncherBuildFailed = '无法构建 MCP 启动器（{0}）：{1}'
      McpLauncherSelfCheckFailed = 'MCP 启动器自检失败：{0}（退出码 {1}）。请检查 Node 和脚本路径。'
      Installed = 'Native Host 已安装，Chrome 扩展 ID：{0}'
      Manifest = '清单文件：{0}'
      Config = '配置文件：{0}'
      Bridge = 'Bridge：ws://127.0.0.1:{0}'
      Reload = '请在 Chrome 中重新加载 AgentSurf。移动项目目录或更换 Node 安装路径后，需要重新执行安装。'
      McpConfig = '将以下内容加入你的 MCP 客户端配置：'
      UninstallRemoved = 'AgentSurf Native Host 注册和启动器已移除。'
      UninstallPreserved = '本地配置保留在 %LOCALAPPDATA%\BrowserControlRuntime。'
    }
  }

  return @{
    NativeHostBuildMissing = 'Native Host build not found: {0}. Run npm run build first.'
    NativeHostReplaceLocked = 'Cannot replace {0} because the running native host keeps the file locked. Disable AgentSurf in chrome://extensions (or close Chrome), wait a second, then run this command again.'
    McpBuildMissing = 'MCP server build not found: {0}. Run npm run build first.'
    McpLauncherBuildFailed = 'Cannot build the MCP launcher at {0}: {1}'
    McpLauncherSelfCheckFailed = 'MCP launcher self-check failed: {0} (exit {1}). Check the Node and script paths.'
    Installed = 'Native Host installed for extension {0}'
    Manifest = 'Manifest: {0}'
    Config = 'Config:   {0}'
    Bridge = 'Bridge:   ws://127.0.0.1:{0}'
    Reload = 'Reload AgentSurf in Chrome. Reinstall after moving the project or changing the Node installation path.'
    McpConfig = 'Add this to your MCP client configuration:'
    UninstallRemoved = 'Browser Control Runtime Native Host registration removed.'
    UninstallPreserved = 'Local configuration was preserved in %LOCALAPPDATA%\BrowserControlRuntime.'
  }
}
