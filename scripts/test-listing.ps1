$ErrorActionPreference='Stop'
$root=Split-Path -Parent $PSScriptRoot
$work=Join-Path $root ('.cache\listing-tests\'+[Guid]::NewGuid().ToString('N'))
New-Item -ItemType Directory -Path $work -Force | Out-Null
$compiler=Join-Path $env:WINDIR 'Microsoft.NET\Framework64\v4.0.30319\csc.exe'
$sources=@('ArchiveEngine.cs','ArchiveProcess.cs','ArchiveListing.cs','ArchiveMerge.cs','ArchiveFileSystem.cs','ArchiveFormats.cs','Json.cs','Edition.cs','Licensing.cs')|ForEach-Object {Join-Path $root ('native\'+$_)}
& $compiler '/nologo' '/target:exe' '/platform:x64' '/utf8output' ('/out:'+(Join-Path $work 'ListingTests.exe')) '/r:System.Core.dll' '/r:System.Security.dll' '/r:System.Net.Http.dll' '/r:System.Web.Extensions.dll' @sources (Join-Path $root 'tests\ListingTests.cs')
if($LASTEXITCODE -ne 0){throw 'Listing test compilation failed'}
Copy-Item -LiteralPath (Join-Path $root 'native\NZIP.exe.config') -Destination (Join-Path $work 'ListingTests.exe.config')
& (Join-Path $work 'ListingTests.exe')
if($LASTEXITCODE -ne 0){throw 'Listing tests failed'}
