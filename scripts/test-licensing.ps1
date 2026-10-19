$ErrorActionPreference='Stop'
$projectRoot=Split-Path -Parent $PSScriptRoot
$work=Join-Path $projectRoot ('.cache\license-tests\'+[Guid]::NewGuid().ToString('N'))
New-Item -ItemType Directory -Path $work -Force | Out-Null
$compiler=Join-Path $env:WINDIR 'Microsoft.NET\Framework64\v4.0.30319\csc.exe'
& $compiler '/nologo' '/target:exe' '/platform:x64' '/utf8output' ('/out:'+(Join-Path $work 'LicenseTests.exe')) '/r:System.Core.dll' '/r:System.Security.dll' '/r:System.Net.Http.dll' '/r:System.Web.Extensions.dll' (Join-Path $projectRoot 'native\ArchiveFileSystem.cs') (Join-Path $projectRoot 'native\Json.cs') (Join-Path $projectRoot 'native\Edition.cs') (Join-Path $projectRoot 'native\Licensing.cs') (Join-Path $projectRoot 'tests\LicenseTests.cs')
if ($LASTEXITCODE -ne 0) { throw 'License test compilation failed' }
Copy-Item -LiteralPath (Join-Path $projectRoot 'native\NZIP.exe.config') -Destination (Join-Path $work 'LicenseTests.exe.config')
& node (Join-Path $PSScriptRoot 'license-fixtures.mjs') $work
if ($LASTEXITCODE -ne 0) { throw 'License fixture generation failed' }
& (Join-Path $work 'LicenseTests.exe') (Join-Path $work 'fixture.json') (Join-Path $work 'cache')
if ($LASTEXITCODE -ne 0) { throw 'Native licensing tests failed' }
& node '--test' (Join-Path $projectRoot 'tests\licensing.test.mjs')
if ($LASTEXITCODE -ne 0) { throw 'License service tests failed' }
Write-Output ('License test fixtures: '+$work)
