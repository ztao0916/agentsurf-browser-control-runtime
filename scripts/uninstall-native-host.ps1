param(
  [ValidateSet('legacy', 'chrome', 'edge', 'all')]
  [string]$Browser = 'legacy'
)

$ErrorActionPreference = 'Stop'
. (Join-Path $PSScriptRoot 'i18n.ps1')
$text = Get-AgentSurfText

$legacy = $Browser -eq 'legacy'
$browsers = if ($Browser -eq 'all') {
  @('chrome', 'edge')
} elseif ($Browser -eq 'edge') {
  @('edge')
} else {
  @('chrome')
}
$runtimeRoot = Join-Path $env:LOCALAPPDATA 'BrowserControlRuntime'
foreach ($browserId in $browsers) {
  $registryPath = if ($browserId -eq 'edge') {
    'HKCU:\Software\Microsoft\Edge\NativeMessagingHosts\com.browsercontrol.runtime'
  } else {
    'HKCU:\Software\Google\Chrome\NativeMessagingHosts\com.browsercontrol.runtime'
  }
  if (Test-Path -LiteralPath $registryPath) {
    Remove-Item -LiteralPath $registryPath -Force
  }

  $runtimeDirectory = if ($legacy) { $runtimeRoot } else { Join-Path $runtimeRoot $browserId }
  $launchers = if ($legacy) {
    @('native-host.exe', 'native-host.cmd', 'agentsurf-mcp.exe', 'agentsurf-mcp.cmd')
  } else {
    @('native-host.exe', 'agentsurf-mcp.exe')
  }
  foreach ($launcher in $launchers) {
    $launcherPath = Join-Path $runtimeDirectory $launcher
    if (Test-Path -LiteralPath $launcherPath) {
      Remove-Item -LiteralPath $launcherPath -Force
    }
  }
}
Write-Host $text.UninstallRemoved
Write-Host $text.UninstallPreserved
