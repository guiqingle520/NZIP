param([switch]$WithUi, [switch]$ValidateOnly, [switch]$Elevated, [string]$ReportPath)
$ErrorActionPreference = 'Stop'
$identity = [Security.Principal.WindowsIdentity]::GetCurrent()
$principal = New-Object Security.Principal.WindowsPrincipal($identity)
$isAdmin = $principal.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)
$identity.Dispose()
if (-not $isAdmin -and -not $ValidateOnly) {
    if ($Elevated) { throw 'Installer regression requires administrator privileges' }
    $report = Join-Path (Split-Path -Parent $PSScriptRoot) ('test-results\installer-elevated-' + [Guid]::NewGuid().ToString('N') + '.log')
    New-Item -ItemType Directory -Path (Split-Path -Parent $report) -Force | Out-Null
    $arguments = @('-NoProfile', '-File', ('"' + $PSCommandPath + '"'), '-Elevated', '-ReportPath', ('"' + $report + '"'))
    if ($WithUi) { $arguments += '-WithUi' }
    $child = Start-Process -FilePath (Join-Path $PSHOME 'powershell.exe') -ArgumentList $arguments -Verb RunAs -WindowStyle Hidden -PassThru -Wait
    if (Test-Path -LiteralPath $report) { Get-Content -LiteralPath $report }
    exit $child.ExitCode
}
if ($ReportPath) { Start-Transcript -LiteralPath $ReportPath -Force | Out-Null }
trap { Write-Error $_ -ErrorAction Continue; if ($ReportPath) { Stop-Transcript | Out-Null }; exit 1 }
$root = Split-Path -Parent $PSScriptRoot
$version = (Get-Content -LiteralPath (Join-Path $root 'package.json') -Raw -Encoding UTF8 | ConvertFrom-Json).version
$token = [Guid]::NewGuid().ToString('N')
$work = Join-Path $root ('test-results\msi-location\' + $token)
$destination = Join-Path $work '原安装目录 有空格\NZIP'
$registryKey = 'Software\NZIP\InstallerTests\' + $token
$upgradeCode = [Guid]::NewGuid().ToString().ToUpperInvariant()
$wix = if ($env:NZIP_WIX_DIR) { $env:NZIP_WIX_DIR } else { Join-Path $root '.cache\wix314' }
$installer = New-Object -ComObject WindowsInstaller.Installer
New-Item -ItemType Directory -Path $work -Force | Out-Null

function Assert($condition, $message) { if (-not $condition) { throw $message } }
function FileHash($path) {
    $sha = [Security.Cryptography.SHA256]::Create()
    try { [BitConverter]::ToString($sha.ComputeHash([IO.File]::ReadAllBytes($path))) }
    finally { $sha.Dispose() }
}
function Read-MsiRows($database, $query, $columns) {
    $view = $database.OpenView($query)
    $view.Execute() | Out-Null
    while ($record = $view.Fetch()) {
        $row = @(); for ($i = 1; $i -le $columns; $i++) { $row += $record.StringData($i) }
        [PSCustomObject]@{ A = $row[0]; B = $row[1]; C = $(if ($columns -gt 2) { $row[2] } else { '' }) }
    }
    $view.Close() | Out-Null
}
function Invoke-Msi($arguments, $name) {
    $log = Join-Path $work ($name + '.log')
    $process = Start-Process -FilePath (Join-Path $env:WINDIR 'System32\msiexec.exe') -ArgumentList ($arguments + @('/qn', '/norestart', '/l*v', ('"' + $log + '"'))) -WindowStyle Hidden -Wait -PassThru
    Assert ($process.ExitCode -in @(0, 3010)) ('MSI failed: ' + $name + ', exit ' + $process.ExitCode + '; see ' + $log)
    $contents = Get-Content -LiteralPath $log -Raw
    Assert ($contents -notmatch '(?im)(?:error|错误|Note: 1:)\s*:?\s*1926\b|Return value 3\.') ('MSI log contains an installation error: ' + $name + '; see ' + $log)
}
function Assert-Payload {
    $original = Join-Path $root ('dist\NZIP-' + $version + '-win-x64')
    $files = Get-ChildItem -LiteralPath $original -File -Recurse
    foreach ($file in $files) {
        $relative = $file.FullName.Substring($original.Length + 1)
        $installed = Join-Path $destination $relative
        Assert (Test-Path -LiteralPath $installed) ('Missing installed file: ' + $relative)
        Assert ((FileHash $installed) -eq (FileHash $file.FullName)) ('Installed file differs: ' + $relative)
    }
    $saved = (Get-ItemProperty -LiteralPath ('HKCU:\' + $registryKey)).Directory
    Assert ($saved.TrimEnd('\') -eq $destination.TrimEnd('\')) ('Wrong saved location: ' + $saved)
}

# Build fixtures from the release source. Only product/component identities,
# test-owned registry keys and the fallback directory name are isolated.
# This exercises the release's actual search, sequencing and upgrade logic
# without upgrading or uninstalling the user's NZIP installation.
$source = Get-Content -LiteralPath (Join-Path $root '.cache\installer\NZIP.wxs') -Raw -Encoding UTF8
$source = $source.Replace('Software\NZIP\Installer', $registryKey)
$source = $source.Replace('06765602-7035-4ED7-9DCB-80F02E0E5626', $upgradeCode)
$source = $source.Replace('Name="Programs"', ('Name="NZIP-Test-' + $token + '"'))
$source = [regex]::Replace($source, '(<Component\b[^>]* Guid=")[0-9a-fA-F-]+(")', { param($m) $m.Groups[1].Value + [Guid]::NewGuid().ToString() + $m.Groups[2].Value })
$products = @()
foreach ($index in 0..2) {
    $code = '{' + [Guid]::NewGuid().ToString().ToUpperInvariant() + '}'
    $fixtureVersion = if ($index -eq 0) { '0.2.9' } else { $version }
    $fixture = [regex]::Replace($source, '(<Product Id=")[^"]+', { param($m) $m.Groups[1].Value + $code.Trim('{}') })
    $fixture = $fixture.Replace(('Version="' + $version + '"'), ('Version="' + $fixtureVersion + '"'))
    $fixture = $fixture.Replace((Get-Content -LiteralPath (Join-Path $root '.cache\installer\msi-info.json') -Raw | ConvertFrom-Json).productCode, $code)
    $wxs = Join-Path $work ($index.ToString() + '.wxs')
    $obj = Join-Path $work ($index.ToString() + '.wixobj')
    $msi = Join-Path $work ($index.ToString() + '.msi')
    [IO.File]::WriteAllText($wxs, $fixture, [Text.UTF8Encoding]::new($false))
    & (Join-Path $wix 'candle.exe') -nologo -arch x64 -ext (Join-Path $wix 'WixUIExtension.dll') -out $obj $wxs
    Assert ($LASTEXITCODE -eq 0) 'Fixture compilation failed'
    & (Join-Path $wix 'light.exe') -nologo -cultures:zh-CN -loc (Join-Path $root '.cache\installer\NZIP.wxl') -ext (Join-Path $wix 'WixUIExtension.dll') -out $msi $obj
    Assert ($LASTEXITCODE -eq 0) 'Fixture linking failed'
    $products += [PSCustomObject]@{ Code = $code; File = $msi }
}

# Confirm the compiled UI uses the detection message and applies directory
# selection before costing in both interactive and unattended sequences.
$summary = $installer.SummaryInformation($products[1].File, 0)
Assert (($summary.Property(15) -band 8) -eq 0) 'MSI incorrectly declares limited privileges'
[Runtime.InteropServices.Marshal]::FinalReleaseComObject($summary) | Out-Null
$db = $installer.OpenDatabase($products[1].File, 0)
$properties = @(Read-MsiRows $db 'SELECT `Property`, `Value` FROM `Property`' 2)
Assert (@($properties | Where-Object { $_.A -eq 'ALLUSERS' -and $_.B }).Count -eq 0) 'MSI must retain per-user installation context'
foreach ($table in @('InstallUISequence', 'InstallExecuteSequence')) {
    $rows = @(Read-MsiRows $db ('SELECT `Action`, `Sequence` FROM `' + $table + '`') 2)
    $search = [int]($rows | Where-Object { $_.A -eq 'AppSearch' }).B
    $reuse = [int]($rows | Where-Object { $_.A -eq 'UsePreviousInstallFolder' }).B
    $cost = [int]($rows | Where-Object { $_.A -eq 'CostFinalize' }).B
    Assert ($search -lt $reuse -and $reuse -lt $cost) ('Wrong directory search sequence: ' + $table)
}
$controls = @(Read-MsiRows $db 'SELECT `Dialog_`, `Control`, `Text` FROM `Control`' 3)
foreach ($dialog in @('WelcomeDlg', 'MaintenanceWelcomeDlg')) {
    Assert (@($controls | Where-Object { $_.A -eq $dialog -and $_.C -eq '[NZIP_INSTALL_MESSAGE]' }).Count -eq 1) ('Missing installation detection message: ' + $dialog)
}
[Runtime.InteropServices.Marshal]::FinalReleaseComObject($db) | Out-Null

if ($ValidateOnly) {
    Write-Output 'PASS: MSI requires elevation; retains per-user context; directory detection sequencing and messages verified.'
    Write-Output ('Validated fixtures: ' + $work)
    if ($ReportPath) { Stop-Transcript | Out-Null }
    exit 0
}
$keep = Join-Path $destination '用户文件-请勿删除.txt'
try {
    Invoke-Msi @('/i', ('"' + $products[0].File + '"'), 'ADDLOCAL=CoreFiles', ('INSTALLFOLDER="' + $destination + '"')) 'first-install'
    Assert-Payload
    if ($WithUi) {
        $originalNativeExe = $env:NZIP_NATIVE_EXE
        try { $env:NZIP_NATIVE_EXE = Join-Path $destination 'NZIP.exe'; & node (Join-Path $root 'scripts\smoke-native.js') --native; Assert ($LASTEXITCODE -eq 0) 'Installed UI verification failed' }
        finally { $env:NZIP_NATIVE_EXE = $originalNativeExe }
    }
    [IO.File]::WriteAllText($keep, 'preserve me')
    Invoke-Msi @('/i', ('"' + $products[0].File + '"'), 'REINSTALL=ALL', 'REINSTALLMODE=vomus') 'same-package-repair'
    Assert-Payload
    foreach ($index in 1..2) {
        Invoke-Msi @('/i', ('"' + $products[$index].File + '"'), 'ADDLOCAL=CoreFiles') ('upgrade-' + $index)
        Assert-Payload
        Assert ($installer.ProductState($products[$index - 1].Code) -eq -1) 'Old product remains installed after upgrade'
        Assert ($installer.ProductState($products[$index].Code) -eq 5) 'New product is not installed'
        Assert ([IO.File]::ReadAllText($keep) -eq 'preserve me') 'Upgrade removed user file'
        $log = Get-Content -LiteralPath (Join-Path $work ('upgrade-' + $index + '.log')) -Raw
        Assert ($log.Contains('检测到已安装的 NZIP')) 'Existing installation was not detected'
    }
    Invoke-Msi @('/x', $products[2].Code) 'uninstall'
    Assert (@(Get-ChildItem -LiteralPath $destination -Force).Count -eq 1) 'Uninstall left installed files'
    Assert ([IO.File]::ReadAllText($keep) -eq 'preserve me') 'Uninstall removed user file'
    Assert (-not (Get-ItemProperty -LiteralPath ('HKCU:\' + $registryKey) -Name Directory -ErrorAction SilentlyContinue)) 'Uninstall left directory registration'
    Write-Output 'PASS: custom Chinese/space path; repeat install/repair; older-version upgrade; same-version replacement; both UI and silent sequences; user-file preservation.'
    Write-Output ('Logs: ' + $work)
} finally {
    foreach ($product in $products) {
        if ($installer.ProductState($product.Code) -eq 5) { Invoke-Msi @('/x', $product.Code) 'cleanup' }
    }
}

if ($ReportPath) { Stop-Transcript | Out-Null }
