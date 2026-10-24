param([ValidateSet('Free','Paid')][string]$Edition='Free',[string]$PublicConfig,[switch]$Preview)
$ErrorActionPreference = 'Stop'
$projectRoot = Split-Path -Parent $PSScriptRoot
$package = Get-Content -LiteralPath (Join-Path $projectRoot 'package.json') -Raw -Encoding UTF8 | ConvertFrom-Json
$version = $package.version
$product = 'NZIP'
if ($Edition -eq 'Paid') { $version='0.7.4'; $product=if ($Preview) { 'NZIPPaidPreview' } else { 'NZIPPaid' } }
$appExe = Join-Path $projectRoot ('dist\' + $product + '-' + $version + '-win-x64\' + $product + '.exe')
$needsCompile = -not (Test-Path -LiteralPath $appExe)
if (-not $needsCompile) {
    $exeTime = (Get-Item -LiteralPath $appExe).LastWriteTimeUtc
    $needsCompile = @(Get-ChildItem -LiteralPath (Join-Path $projectRoot 'native') -Filter '*.cs' | Where-Object { $_.LastWriteTimeUtc -gt $exeTime }).Count -gt 0
}
if ($Edition -eq 'Paid') { & (Join-Path $PSScriptRoot 'build-native.ps1') -Edition Paid -PublicConfig $PublicConfig -Preview:$Preview }
elseif ($needsCompile) { & (Join-Path $PSScriptRoot 'build-native.ps1') }
else { & (Join-Path $PSScriptRoot 'build-native.ps1') -SkipCompile }
$work = if ($Edition -eq 'Free') { Join-Path $projectRoot '.cache\installer' } else { Join-Path $projectRoot ('.cache\installer-' + $product) }
New-Item -ItemType Directory -Path $work -Force | Out-Null
$wixRoot = if ($env:NZIP_WIX_DIR) { $env:NZIP_WIX_DIR } else { Join-Path $projectRoot '.cache\wix314' }
if (-not (Test-Path -LiteralPath (Join-Path $wixRoot 'candle.exe'))) {
    $download = Join-Path $projectRoot '.cache\wix314-binaries.zip'
    if (-not (Test-Path -LiteralPath $download)) {
        & curl.exe '-L' '--fail' '--retry' '1' 'https://github.com/wixtoolset/wix3/releases/download/wix3141rtm/wix314-binaries.zip' '-o' $download
        if ($LASTEXITCODE -ne 0) { throw 'WiX download failed' }
    }
    Expand-Archive -LiteralPath $download -DestinationPath $wixRoot -Force
}
& node (Join-Path $PSScriptRoot 'generate-shell-registry.js')
if ($LASTEXITCODE -ne 0) { throw 'Shell registry catalog generation failed' }
Copy-Item -LiteralPath (Join-Path $projectRoot 'installer\shell-registry.json') -Destination (Join-Path $work 'shell-registry.json') -Force
& node (Join-Path $PSScriptRoot 'generate-msi.js') $product
if ($LASTEXITCODE -ne 0) { throw 'MSI source generation failed' }
& (Join-Path $wixRoot 'candle.exe') '-nologo' '-arch' 'x64' '-ext' (Join-Path $wixRoot 'WixUIExtension.dll') '-out' (Join-Path $work 'NZIP.wixobj') (Join-Path $work 'NZIP.wxs')
if ($LASTEXITCODE -ne 0) { throw 'MSI compilation failed' }
$output = Join-Path $projectRoot ('dist\' + $product + '-' + $version + '-Setup-x64.msi')
& (Join-Path $wixRoot 'light.exe') '-nologo' '-cultures:zh-CN' '-loc' (Join-Path $work 'NZIP.wxl') '-ext' (Join-Path $wixRoot 'WixUIExtension.dll') '-out' $output (Join-Path $work 'NZIP.wixobj')
if ($LASTEXITCODE -ne 0) { throw 'MSI linking or validation failed' }
Write-Output ('Installer: ' + $output)
