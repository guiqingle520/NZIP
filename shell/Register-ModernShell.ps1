param([ValidateSet('register','unregister')][string]$Mode='register',[ValidateSet('NZIP','NZIPPaid','NZIPPaidPreview')][string]$Product='NZIP',[Parameter(Mandatory=$true)][string]$Directory)
$ErrorActionPreference='Stop'
[Console]::OutputEncoding=New-Object Text.UTF8Encoding $false
$Directory=[IO.Path]::GetFullPath($Directory)
$name=$Product+'.Shell'
if($Mode -eq 'unregister'){
    $owner=Get-ItemProperty -LiteralPath ('HKCU:/Software/'+$Product) -Name ShellExecutable -ErrorAction SilentlyContinue
    if(-not $owner -or $owner.ShellExecutable -ne (Join-Path $Directory ($Product+'.exe'))){exit 0}
    Get-AppxPackage -Name $name | Where-Object {$_.Name -eq $name} | Remove-AppxPackage -ErrorAction Stop
    $key='HKCU:/Software/'+$Product
    if(Test-Path -LiteralPath $key){Remove-ItemProperty -LiteralPath $key -Name ShellExecutable -ErrorAction SilentlyContinue}
    exit 0
}
$package=Join-Path $Directory 'ModernShell.msix'
Add-Type -AssemblyName System.IO.Compression.FileSystem
$zip=[IO.Compression.ZipFile]::OpenRead($package)
try{if(-not $zip.GetEntry('AppxSignature.p7x')){throw 'Windows 11 一级右键包尚未签名，请使用发行方已签名的安装包。'}}finally{$zip.Dispose()}
# Windows deployment validates the package signature and trust. Never install certificates or weaken policy here.
Add-AppxPackage -Path $package -ExternalLocation $Directory -ErrorAction Stop
$key='HKCU:/Software/'+$Product
New-Item -Path $key -Force | Out-Null
Set-ItemProperty -LiteralPath $key -Name ShellExecutable -Value (Join-Path $Directory ($Product+'.exe'))
