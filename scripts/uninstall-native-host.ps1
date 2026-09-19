$ErrorActionPreference = 'Stop'
. (Join-Path $PSScriptRoot 'i18n.ps1')
$text = Get-AgentSurfText
$registryPath = 'HKCU:\Software\Google\Chrome\NativeMessagingHosts\com.browsercontrol.runtime'
if (Test-Path -LiteralPath $registryPath) {
  Remove-Item -LiteralPath $registryPath -Force
}
$runtimeDirectory = Join-Path $env:LOCALAPPDATA 'BrowserControlRuntime'
foreach ($launcher in @('native-host.exe', 'native-host.cmd', 'agentsurf-mcp.exe', 'agentsurf-mcp.cmd')) {
  $launcherPath = Join-Path $runtimeDirectory $launcher
  if (Test-Path -LiteralPath $launcherPath) {
    Remove-Item -LiteralPath $launcherPath -Force
  }
}
Write-Host $text.UninstallRemoved
Write-Host $text.UninstallPreserved
