param(
  [Parameter(Mandatory = $true)]
  [ValidatePattern('^[a-p]{32}$')]
  [string]$ExtensionId,

  [ValidateRange(1, 65535)]
  [int]$Port = 8765
)

$ErrorActionPreference = 'Stop'
$projectRoot = Split-Path -Parent $PSScriptRoot
$hostScript = Join-Path $projectRoot 'dist\native-host\host.js'
if (-not (Test-Path -LiteralPath $hostScript)) {
  throw "Native Host build not found: $hostScript. Run npm run build first."
}

$nodePath = (Get-Command node -ErrorAction Stop).Source
$runtimeDirectory = Join-Path $env:LOCALAPPDATA 'BrowserControlRuntime'
$configPath = Join-Path $runtimeDirectory 'config.json'
$launcherPath = Join-Path $runtimeDirectory 'native-host.exe'
$legacyLauncherPath = Join-Path $runtimeDirectory 'native-host.cmd'
$manifestPath = Join-Path $runtimeDirectory 'com.browsercontrol.runtime.json'
New-Item -ItemType Directory -Path $runtimeDirectory -Force | Out-Null

$token = $null
if (Test-Path -LiteralPath $configPath) {
  $existingConfig = Get-Content -Raw -LiteralPath $configPath | ConvertFrom-Json
  if ($existingConfig.token -is [string] -and $existingConfig.token.Length -ge 16) {
    $token = $existingConfig.token
  }
}
if ($null -eq $token) {
  $bytes = New-Object byte[] 32
  $random = New-Object Security.Cryptography.RNGCryptoServiceProvider
  try {
    $random.GetBytes($bytes)
  } finally {
    $random.Dispose()
  }
  $token = [BitConverter]::ToString($bytes).Replace('-', '').ToLowerInvariant()
}

function Write-Utf8NoBomJson {
  param(
    [Parameter(Mandatory = $true)][string]$Path,
    [Parameter(Mandatory = $true)][object]$Value
  )
  $json = $Value | ConvertTo-Json -Depth 8
  [IO.File]::WriteAllText($Path, $json + [Environment]::NewLine, [Text.UTF8Encoding]::new($false))
}

Write-Utf8NoBomJson -Path $configPath -Value @{
  port = $Port
  token = $token
}

$escapedNodePath = $nodePath.Replace('\', '\\').Replace('"', '\"')
$escapedHostScript = $hostScript.Replace('\', '\\').Replace('"', '\"')
$escapedConfigPath = $configPath.Replace('\', '\\').Replace('"', '\"')
$launcherSource = @"
using System;
using System.Diagnostics;
using System.IO;
using System.Threading.Tasks;

internal static class NativeHostLauncher
{
    private const string NodePath = "$escapedNodePath";
    private const string HostScript = "$escapedHostScript";
    private const string ConfigPath = "$escapedConfigPath";

    public static int Main()
    {
        var startInfo = new ProcessStartInfo
        {
            FileName = NodePath,
            Arguments = "\"" + HostScript + "\"",
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
            var input = Console.OpenStandardInput().CopyToAsync(process.StandardInput.BaseStream)
                .ContinueWith(_ => process.StandardInput.Close());
            var output = process.StandardOutput.BaseStream.CopyToAsync(Console.OpenStandardOutput());
            var error = process.StandardError.BaseStream.CopyToAsync(Console.OpenStandardError());
            process.WaitForExit();
            Task.WaitAll(output, error);
            return process.ExitCode;
        }
    }
}
"@

if (Test-Path -LiteralPath $launcherPath) {
  Remove-Item -LiteralPath $launcherPath -Force
}
if (Test-Path -LiteralPath $legacyLauncherPath) {
  Remove-Item -LiteralPath $legacyLauncherPath -Force
}
Add-Type -TypeDefinition $launcherSource -Language CSharp -OutputAssembly $launcherPath -OutputType ConsoleApplication

Write-Utf8NoBomJson -Path $manifestPath -Value @{
  name = 'com.browsercontrol.runtime'
  description = 'AgentSurf native messaging host'
  path = $launcherPath
  type = 'stdio'
  allowed_origins = @("chrome-extension://$ExtensionId/")
}

$registryPath = 'HKCU:\Software\Google\Chrome\NativeMessagingHosts\com.browsercontrol.runtime'
New-Item -Path $registryPath -Force | Out-Null
Set-Item -Path $registryPath -Value $manifestPath

Write-Host "Native Host installed for extension $ExtensionId"
Write-Host "Manifest: $manifestPath"
Write-Host "Config:   $configPath"
Write-Host "Bridge:   ws://127.0.0.1:$Port"
