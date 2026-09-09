$ErrorActionPreference = 'Stop'
$registryPath = 'HKCU:\Software\Google\Chrome\NativeMessagingHosts\com.browsercontrol.runtime'
if (Test-Path -LiteralPath $registryPath) {
  Remove-Item -LiteralPath $registryPath -Force
}
$runtimeDirectory = Join-Path $env:LOCALAPPDATA 'BrowserControlRuntime'
foreach ($launcher in @('native-host.exe', 'native-host.cmd')) {
  $launcherPath = Join-Path $runtimeDirectory $launcher
  if (Test-Path -LiteralPath $launcherPath) {
    Remove-Item -LiteralPath $launcherPath -Force
  }
}
Write-Host 'Browser Control Runtime Native Host registration removed.'
Write-Host 'Local configuration was preserved in %LOCALAPPDATA%\BrowserControlRuntime.'
