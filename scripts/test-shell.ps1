$ErrorActionPreference = 'Stop'
$projectRoot = Split-Path -Parent $PSScriptRoot
$output = Join-Path $projectRoot 'test-results\shell-tests.exe'
New-Item -ItemType Directory -Path (Split-Path -Parent $output) -Force | Out-Null
$compiler = Join-Path $env:WINDIR 'Microsoft.NET\Framework64\v4.0.30319\csc.exe'
& $compiler '/nologo' '/target:exe' '/platform:x64' '/utf8output' ('/out:'+$output) '/r:System.Core.dll' (Join-Path $projectRoot 'native\ArchiveFormats.cs') (Join-Path $projectRoot 'native\ShellIntegration.cs') (Join-Path $projectRoot 'tests\ShellIntegrationTests.cs')
if ($LASTEXITCODE -ne 0) { throw 'Shell test compilation failed' }
& $output
if ($LASTEXITCODE -ne 0) { throw 'Shell integration tests failed' }
