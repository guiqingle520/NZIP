param([switch]$SkipCompile,[ValidateSet('Free','Paid')][string]$Edition='Free',[string]$PublicConfig,[switch]$Preview)
$ErrorActionPreference = 'Stop'
$projectRoot = Split-Path -Parent $PSScriptRoot
$version = (Get-Content -LiteralPath (Join-Path $projectRoot 'package.json') -Raw -Encoding UTF8 | ConvertFrom-Json).version
$product = 'NZIP'
$trustSource = $null
if ($Edition -eq 'Paid') {
    $version = '0.7.2'
    $product = if ($Preview) { 'NZIPPaidPreview' } else { 'NZIPPaid' }
    if (-not $PublicConfig) { throw 'Paid build requires -PublicConfig <client-public.json>; private keys are never bundled.' }
    $trust = Get-Content -LiteralPath $PublicConfig -Raw -Encoding UTF8 | ConvertFrom-Json
    if (@($trust.keys).Count -lt 1) { throw 'At least one trusted public key is required.' }
    if (-not $Preview) {
        $serviceUri = $null
        if (-not [Uri]::TryCreate($trust.endpoint,[UriKind]::Absolute,[ref]$serviceUri) -or $serviceUri.Scheme -ne 'https' -or $serviceUri.AbsolutePath -ne '/' -or $serviceUri.Query -or $serviceUri.Fragment -or $serviceUri.UserInfo -or $serviceUri.Host -match '(^localhost$|\.invalid$|\.example$|^example\.|^127\.|^0\.)') { throw 'Production build requires an actual HTTPS origin (no path, credentials or query).' }
        if (@($trust.keys | Where-Object { $_.keyId -match '(?i)(test|dev|preview)' }).Count -gt 0) { throw 'Test signing keys are not allowed in a production build.' }
    }
    foreach ($key in $trust.keys) {
        if ($key.keyId -notmatch '^[A-Za-z0-9-]{1,100}$' -or $key.modulus -notmatch '^[A-Za-z0-9_-]{512,}$' -or $key.exponent -notmatch '^[A-Za-z0-9_-]+$') { throw 'Invalid RSA public key configuration.' }
    }
    if (@($trust.keys | Select-Object -ExpandProperty keyId | Select-Object -Unique).Count -ne @($trust.keys).Count) { throw 'Duplicate keyId in public configuration.' }
    $generated = Join-Path $projectRoot ('.cache\build-' + $product)
    New-Item -ItemType Directory -Path $generated -Force | Out-Null
    $trustSource = Join-Path $generated 'PaidConfig.cs'
    $publicOnly = @{ endpoint=[string]$trust.endpoint; keys=@($trust.keys | ForEach-Object { @{ keyId=[string]$_.keyId; modulus=[string]$_.modulus; exponent=[string]$_.exponent } }) } | ConvertTo-Json -Depth 5 -Compress
    $literal = $publicOnly.Replace('"','""')
    $endpointLiteral = ([string]$trust.endpoint).Replace('"','""')
    Set-Content -LiteralPath $trustSource -Encoding UTF8 -Value ('namespace NZIP { internal static class PaidConfig { public const string Endpoint=@"' + $endpointLiteral + '"; public const string PublicConfig=@"' + $literal + '"; } }')
}
$outputRoot = Join-Path $projectRoot ('dist\' + $product + '-' + $version + '-win-x64')
New-Item -ItemType Directory -Path $outputRoot -Force | Out-Null
$compiler = Join-Path $env:WINDIR 'Microsoft.NET\Framework64\v4.0.30319\csc.exe'
$compilerArgs = @('/nologo','/target:winexe','/platform:x64','/optimize+','/utf8output',('/out:' + (Join-Path $outputRoot ($product+'.exe'))),('/win32icon:' + (Join-Path $projectRoot 'assets\icon.ico')),'/r:System.dll','/r:System.Core.dll','/r:System.Drawing.dll','/r:System.Windows.Forms.dll','/r:System.Web.Extensions.dll','/r:System.Security.dll','/r:System.Net.Http.dll','/r:System.IO.Compression.dll','/r:System.IO.Compression.FileSystem.dll',('/win32manifest:' + (Join-Path $projectRoot 'native\NZIP.manifest')))
$sourceFiles = Get-ChildItem -LiteralPath (Join-Path $projectRoot 'native') -Filter '*.cs' | ForEach-Object FullName
if ($Edition -eq 'Paid') { $compilerArgs += '/define:NZIP_PAID'; if ($Preview) { $compilerArgs += '/define:NZIP_PREVIEW' }; $sourceFiles += $trustSource }
if ($Edition -eq 'Paid') {
    $paidManifest = Join-Path $generated 'NZIP.manifest'
    $manifestText = (Get-Content -LiteralPath (Join-Path $projectRoot 'native\NZIP.manifest') -Raw -Encoding UTF8).Replace('name="NZIP"',('name="'+$product+'"')).Replace('version="0.6.3.0"','version="0.7.2.0"')
    Set-Content -LiteralPath $paidManifest -Encoding UTF8 -Value $manifestText
    $compilerArgs = @($compilerArgs | Where-Object { -not $_.StartsWith('/win32manifest:') }) + ('/win32manifest:'+$paidManifest)
}
if ($Edition -eq 'Paid' -or -not $SkipCompile -or -not (Test-Path -LiteralPath (Join-Path $outputRoot ($product+'.exe')))) {
    & $compiler @compilerArgs @sourceFiles
    if ($LASTEXITCODE -ne 0) { throw 'Native compilation failed' }
}
Copy-Item -LiteralPath (Join-Path $projectRoot 'native\NZIP.exe.config') -Destination (Join-Path $outputRoot ($product+'.exe.config')) -Force
$engineOutput = Join-Path $outputRoot '7zip'
New-Item -ItemType Directory -Path $engineOutput -Force | Out-Null
Get-ChildItem -LiteralPath (Join-Path $projectRoot 'vendor\7zip') -File | Copy-Item -Destination $engineOutput -Force
$duplicateEngine = [System.IO.Path]::GetFullPath((Join-Path $engineOutput '7zip'))
$checkedOutput = [System.IO.Path]::GetFullPath($outputRoot).TrimEnd('\') + '\'
if (-not $duplicateEngine.StartsWith($checkedOutput, [System.StringComparison]::OrdinalIgnoreCase)) { throw 'Duplicate engine cleanup target escaped output directory' }
if (Test-Path -LiteralPath $duplicateEngine) { Remove-Item -LiteralPath $duplicateEngine -Recurse -Force }
Copy-Item -LiteralPath (Join-Path $projectRoot 'LICENSE'),(Join-Path $projectRoot 'THIRD_PARTY_NOTICES.md') -Destination $outputRoot -Force
Copy-Item -LiteralPath (Join-Path $projectRoot 'native\USAGE.txt') -Destination $outputRoot -Force
if ($Edition -eq 'Paid') { Copy-Item -LiteralPath (Join-Path $projectRoot 'docs\commercial\COMMERCIAL-TERMS-DRAFT.txt'),(Join-Path $projectRoot 'LICENSES.md') -Destination $outputRoot -Force; Add-Content -LiteralPath (Join-Path $outputRoot 'USAGE.txt') -Encoding UTF8 -Value (Get-Content -LiteralPath (Join-Path $projectRoot 'native\USAGE-PAID.txt') -Raw -Encoding UTF8) }
if ($Edition -eq 'Paid') {
    $allowedFiles = @(($product+'.exe'),($product+'.exe.config'),'LICENSE','LICENSES.md','THIRD_PARTY_NOTICES.md','USAGE.txt','COMMERCIAL-TERMS-DRAFT.txt') + @(Get-ChildItem -LiteralPath (Join-Path $projectRoot 'vendor\7zip') -File | ForEach-Object { '7zip\'+$_.Name })
    foreach ($file in Get-ChildItem -LiteralPath $outputRoot -Recurse -File) {
        $relative = $file.FullName.Substring($outputRoot.Length+1)
        if ($relative -notin $allowedFiles) { throw ('Unexpected file in paid output; refusing to package: '+$relative) }
    }
}
Write-Output ('Built ' + (Join-Path $outputRoot ($product+'.exe')))
$packagePath = Join-Path $projectRoot ('dist\' + $product + '-' + $version + '-win-x64.zip')
$temporaryPackage = Join-Path $projectRoot ('dist\.nzip-package-' + [Guid]::NewGuid().ToString('N') + '.zip')
try {
    Compress-Archive -LiteralPath $outputRoot -DestinationPath $temporaryPackage -CompressionLevel Optimal
    Move-Item -LiteralPath $temporaryPackage -Destination $packagePath -Force
} finally {
    if (Test-Path -LiteralPath $temporaryPackage) { Remove-Item -LiteralPath $temporaryPackage -Force }
}
Write-Output ('Packaged ' + $packagePath)
