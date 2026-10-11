param([switch]$SkipCompile)
$ErrorActionPreference = 'Stop'
$projectRoot = Split-Path -Parent $PSScriptRoot
$version = (Get-Content -LiteralPath (Join-Path $projectRoot 'package.json') -Raw -Encoding UTF8 | ConvertFrom-Json).version
$outputRoot = Join-Path $projectRoot ('dist\NZIP-' + $version + '-win-x64')
New-Item -ItemType Directory -Path $outputRoot -Force | Out-Null
$compiler = Join-Path $env:WINDIR 'Microsoft.NET\Framework64\v4.0.30319\csc.exe'
$compilerArgs = @('/nologo','/target:winexe','/platform:x64','/optimize+','/utf8output',('/out:' + (Join-Path $outputRoot 'NZIP.exe')),('/win32icon:' + (Join-Path $projectRoot 'assets\icon.ico')),'/r:System.dll','/r:System.Core.dll','/r:System.Drawing.dll','/r:System.Windows.Forms.dll','/r:System.Web.Extensions.dll','/r:System.IO.Compression.dll','/r:System.IO.Compression.FileSystem.dll',('/win32manifest:' + (Join-Path $projectRoot 'native\NZIP.manifest')))
$sourceFiles = Get-ChildItem -LiteralPath (Join-Path $projectRoot 'native') -Filter '*.cs' | ForEach-Object FullName
if (-not $SkipCompile -or -not (Test-Path -LiteralPath (Join-Path $outputRoot 'NZIP.exe'))) {
    & $compiler @compilerArgs @sourceFiles
    if ($LASTEXITCODE -ne 0) { throw 'Native compilation failed' }
}
$engineOutput = Join-Path $outputRoot '7zip'
New-Item -ItemType Directory -Path $engineOutput -Force | Out-Null
Get-ChildItem -LiteralPath (Join-Path $projectRoot 'vendor\7zip') -File | Copy-Item -Destination $engineOutput -Force
$duplicateEngine = [System.IO.Path]::GetFullPath((Join-Path $engineOutput '7zip'))
$checkedOutput = [System.IO.Path]::GetFullPath($outputRoot).TrimEnd('\') + '\'
if (-not $duplicateEngine.StartsWith($checkedOutput, [System.StringComparison]::OrdinalIgnoreCase)) { throw 'Duplicate engine cleanup target escaped output directory' }
if (Test-Path -LiteralPath $duplicateEngine) { Remove-Item -LiteralPath $duplicateEngine -Recurse -Force }
Copy-Item -LiteralPath (Join-Path $projectRoot 'LICENSE'),(Join-Path $projectRoot 'THIRD_PARTY_NOTICES.md') -Destination $outputRoot -Force
Copy-Item -LiteralPath (Join-Path $projectRoot 'native\USAGE.txt') -Destination $outputRoot -Force
Write-Output ('Built ' + (Join-Path $outputRoot 'NZIP.exe'))
$packagePath = Join-Path $projectRoot ('dist\NZIP-' + $version + '-win-x64.zip')
$temporaryPackage = Join-Path $projectRoot ('dist\.nzip-package-' + [Guid]::NewGuid().ToString('N') + '.zip')
try {
    Compress-Archive -LiteralPath $outputRoot -DestinationPath $temporaryPackage -CompressionLevel Optimal
    Move-Item -LiteralPath $temporaryPackage -Destination $packagePath -Force
} finally {
    if (Test-Path -LiteralPath $temporaryPackage) { Remove-Item -LiteralPath $temporaryPackage -Force }
}
Write-Output ('Packaged ' + $packagePath)
