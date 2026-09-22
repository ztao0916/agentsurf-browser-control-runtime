param(
  [ValidateSet('chrome', 'edge')]
  [string]$Browser = 'chrome',

  [switch]$MultiBrowser,

  [Parameter(Mandatory = $true)]
  [ValidatePattern('^[a-p]{32}$')]
  [string]$ExtensionId,

  [ValidateRange(0, 65535)]
  [int]$Port = 0
)

$ErrorActionPreference = 'Stop'
$projectRoot = Split-Path -Parent $PSScriptRoot
. (Join-Path $PSScriptRoot 'i18n.ps1')
$text = Get-AgentSurfText
$legacy = -not $MultiBrowser -and $Browser -eq 'chrome'
if ($Port -eq 0) {
  $Port = if ($Browser -eq 'edge') { 8766 } else { 8765 }
}
$browserLabel = if ($Browser -eq 'edge') { 'Edge' } else { 'Chrome' }
$mcpName = if ($legacy) { 'agentsurf' } else { "agentsurf-$Browser" }
$hostScript = Join-Path $projectRoot 'dist\native-host\host.js'
if (-not (Test-Path -LiteralPath $hostScript)) {
  throw ($text.NativeHostBuildMissing -f $hostScript)
}

$nodePath = (Get-Command node -ErrorAction Stop).Source
$runtimeRoot = Join-Path $env:LOCALAPPDATA 'BrowserControlRuntime'
$runtimeDirectory = if ($legacy) { $runtimeRoot } else { Join-Path $runtimeRoot $Browser }
$configPath = Join-Path $runtimeDirectory 'config.json'
$legacyConfigPath = if ($legacy) { $null } else { Join-Path $runtimeRoot 'config.json' }
$launcherPath = Join-Path $runtimeDirectory 'native-host.exe'
$legacyLauncherPath = if ($legacy) { Join-Path $runtimeRoot 'native-host.cmd' } else { $null }
$manifestPath = Join-Path $runtimeDirectory 'com.browsercontrol.runtime.json'
New-Item -ItemType Directory -Path $runtimeDirectory -Force | Out-Null

$token = $null
$existingConfigPath = if (Test-Path -LiteralPath $configPath) {
  $configPath
} elseif ($null -ne $legacyConfigPath -and $Browser -eq 'chrome' -and (Test-Path -LiteralPath $legacyConfigPath)) {
  $legacyConfigPath
} else {
  $null
}
if ($null -ne $existingConfigPath) {
  $existingConfig = Get-Content -Raw -LiteralPath $existingConfigPath | ConvertFrom-Json
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
"@

if ($null -ne $legacyLauncherPath -and (Test-Path -LiteralPath $legacyLauncherPath)) {
  Remove-Item -LiteralPath $legacyLauncherPath -Force
}
try {
  if (Test-Path -LiteralPath $launcherPath) {
    Remove-Item -LiteralPath $launcherPath -Force
  }
  Add-Type -TypeDefinition $launcherSource -Language CSharp -OutputAssembly $launcherPath -OutputType ConsoleApplication
} catch {
  throw ($text.NativeHostReplaceLocked -f $launcherPath)
}

Write-Utf8NoBomJson -Path $manifestPath -Value @{
  name = 'com.browsercontrol.runtime'
  description = "AgentSurf native messaging host for $browserLabel"
  path = $launcherPath
  type = 'stdio'
  allowed_origins = @("chrome-extension://$ExtensionId/")
}

# An MCP client spawns its server with an unpredictable working directory (and GUI clients often see
# a narrow PATH), so give it one stable absolute entry point. A compiled launcher is used instead of
# a .cmd because Node refuses to spawn .cmd/.bat without a shell since 20.12, while a real executable
# works from every client. This file is regenerated by every install, which is also what a moved
# project or a switched Node version needs anyway.
$mcpScript = Join-Path $projectRoot 'dist\mcp\cli.js'
if (-not (Test-Path -LiteralPath $mcpScript)) {
  throw ($text.McpBuildMissing -f $mcpScript)
}
$mcpLauncherPath = Join-Path $runtimeDirectory 'agentsurf-mcp.exe'
$escapedMcpScript = $mcpScript.Replace('\', '\\').Replace('"', '\"')
$mcpLauncherSource = @"
using System;
using System.Diagnostics;
using System.IO;
using System.Linq;
using System.Threading.Tasks;

internal static class McpServerLauncher
{
    private const string NodePath = "$escapedNodePath";
    private const string McpScript = "$escapedMcpScript";
    private const string ConfigPath = "$($configPath.Replace('\', '\\').Replace('"', '\"'))";

    private static string Quote(string value)
    {
        return value.Contains(' ') ? "\"" + value + "\"" : value;
    }

    private static void Forward(Stream source, Stream destination)
    {
        var buffer = new byte[8192];
        int count;
        while ((count = source.Read(buffer, 0, buffer.Length)) > 0)
        {
            destination.Write(buffer, 0, count);
            // MCP exchanges one JSON message per line while the pipes stay open.
            destination.Flush();
        }
    }

    public static int Main(string[] args)
    {
        // Pipes must be forwarded explicitly: without redirection Windows only inherits a console,
        // not the parent's pipe handles, and the JSON-RPC channel would go nowhere.
        var startInfo = new ProcessStartInfo
        {
            FileName = NodePath,
            Arguments = string.Join(" ", new[] { McpScript }.Concat(args).Select(Quote)),
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
"@
try {
  if (Test-Path -LiteralPath $mcpLauncherPath) {
    Remove-Item -LiteralPath $mcpLauncherPath -Force
  }
  Add-Type -TypeDefinition $mcpLauncherSource -Language CSharp -OutputAssembly $mcpLauncherPath -OutputType ConsoleApplication
} catch {
  throw ($text.McpLauncherBuildFailed -f $mcpLauncherPath, $_.Exception.Message)
}

# Fail the install instead of shipping a launcher that cannot start the server. The CLI prints its
# usage on stderr, and PowerShell turns a native command's stderr into a terminating error while
# ErrorActionPreference is Stop, so relax that preference for the probe and trust the exit code.
$probePreference = $ErrorActionPreference
$ErrorActionPreference = 'Continue'
& $mcpLauncherPath help 2>&1 | Out-Null
$probeExitCode = $LASTEXITCODE
$ErrorActionPreference = $probePreference
if ($probeExitCode -ne 0) {
  throw ($text.McpLauncherSelfCheckFailed -f $mcpLauncherPath, $probeExitCode)
}

$registryPath = if ($Browser -eq 'edge') {
  'HKCU:\Software\Microsoft\Edge\NativeMessagingHosts\com.browsercontrol.runtime'
} else {
  'HKCU:\Software\Google\Chrome\NativeMessagingHosts\com.browsercontrol.runtime'
}
New-Item -Path $registryPath -Force | Out-Null
Set-Item -Path $registryPath -Value $manifestPath

Write-Host ($text.Installed -f $browserLabel, $ExtensionId)
Write-Host ($text.Manifest -f $manifestPath)
Write-Host ($text.Config -f $configPath)
Write-Host ($text.Bridge -f $Port)
Write-Host ($text.Reload -f $browserLabel)
Write-Host ''
Write-Host ($text.McpConfig -f $browserLabel)
Write-Host ''
Write-Host (@"
{
  "mcpServers": {
    "$mcpName": {
      "command": "$($mcpLauncherPath.Replace('\', '/'))"
    }
  }
}
"@)
