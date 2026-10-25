param([Parameter(Mandatory=$true)][string]$OutputDirectory,[ValidateSet('NZIP','NZIPPaid','NZIPPaidPreview')][string]$Product='NZIP',[string]$Version='0.7.0',[string]$Publisher='CN=NZIP',[string]$CertificateThumbprint)
$ErrorActionPreference='Stop'
$root=Split-Path -Parent $PSScriptRoot
$work=Join-Path $root ('.cache/modern-package-'+$Product)
New-Item -ItemType Directory -Path (Join-Path $work 'Assets') -Force | Out-Null
$clsid=switch($Product){'NZIP'{'C9156331-76AC-4A51-93A2-0D57C2B3C001'}'NZIPPaid'{'C9156331-76AC-4A51-93A2-0D57C2B3C002'}'NZIPPaidPreview'{'C9156331-76AC-4A51-93A2-0D57C2B3C003'}}
$safePublisher=[Security.SecurityElement]::Escape($Publisher)
$manifest=@"
<?xml version="1.0" encoding="utf-8"?>
<Package xmlns="http://schemas.microsoft.com/appx/manifest/foundation/windows10" xmlns:uap="http://schemas.microsoft.com/appx/manifest/uap/windows10" xmlns:uap10="http://schemas.microsoft.com/appx/manifest/uap/windows10/10" xmlns:desktop4="http://schemas.microsoft.com/appx/manifest/desktop/windows10/4" xmlns:desktop5="http://schemas.microsoft.com/appx/manifest/desktop/windows10/5" xmlns:com="http://schemas.microsoft.com/appx/manifest/com/windows10" xmlns:rescap="http://schemas.microsoft.com/appx/manifest/foundation/windows10/restrictedcapabilities" IgnorableNamespaces="uap uap10 desktop4 desktop5 com rescap">
 <Identity Name="$Product.Shell" Publisher="$safePublisher" Version="$Version.0" ProcessorArchitecture="x64"/>
 <Properties><DisplayName>$Product</DisplayName><PublisherDisplayName>NZIP</PublisherDisplayName><Logo>Assets\Logo.png</Logo><uap10:AllowExternalContent>true</uap10:AllowExternalContent></Properties>
 <Resources><Resource Language="zh-CN"/><Resource Language="zh-TW"/><Resource Language="en-US"/></Resources>
 <Dependencies><TargetDeviceFamily Name="Windows.Desktop" MinVersion="10.0.22000.0" MaxVersionTested="10.0.26200.0"/></Dependencies>
 <Capabilities><rescap:Capability Name="runFullTrust"/><rescap:Capability Name="unvirtualizedResources"/></Capabilities>
 <Applications><Application Id="App" Executable="$Product.exe" uap10:RuntimeBehavior="win32App" uap10:TrustLevel="mediumIL">
 <uap:VisualElements DisplayName="$Product" Description="NZIP archive commands" BackgroundColor="transparent" Square150x150Logo="Assets\Logo.png" Square44x44Logo="Assets\SmallLogo.png" AppListEntry="none"/>
 <Extensions><com:Extension Category="windows.comServer"><com:ComServer><com:SurrogateServer DisplayName="$Product"><com:Class Id="$clsid" Path="NzipShell.dll" ThreadingModel="STA"/></com:SurrogateServer></com:ComServer></com:Extension>
 <desktop4:Extension Category="windows.fileExplorerContextMenus"><desktop4:FileExplorerContextMenus><desktop5:ItemType Type="*"><desktop5:Verb Id="NZIP" Clsid="$clsid"/></desktop5:ItemType><desktop5:ItemType Type="Directory"><desktop5:Verb Id="NZIPFolder" Clsid="$clsid"/></desktop5:ItemType></desktop4:FileExplorerContextMenus></desktop4:Extension></Extensions>
 </Application></Applications>
</Package>
"@
Set-Content -LiteralPath (Join-Path $work 'AppxManifest.xml') -Value $manifest -Encoding UTF8
Add-Type -AssemblyName System.Drawing
$icon=New-Object Drawing.Icon((Join-Path $root 'assets/icon.ico'))
try{foreach($pair in @(@('Logo.png',150),@('SmallLogo.png',44))){$bitmap=New-Object Drawing.Bitmap($pair[1],$pair[1]);try{$graphics=[Drawing.Graphics]::FromImage($bitmap);try{$graphics.Clear([Drawing.Color]::Transparent);$graphics.DrawIcon($icon,(New-Object Drawing.Rectangle(0,0,$pair[1],$pair[1])))}finally{$graphics.Dispose()};$bitmap.Save((Join-Path $work ('Assets/'+$pair[0])),[Drawing.Imaging.ImageFormat]::Png)}finally{$bitmap.Dispose()}}}finally{$icon.Dispose()}
Copy-Item -LiteralPath (Join-Path $OutputDirectory 'NzipShell.dll') -Destination (Join-Path $work 'NzipShell.dll') -Force
$sdk='C:/Program Files (x86)/Windows Kits/10/bin'
$tool=(Get-ChildItem -LiteralPath $sdk -Directory|Sort-Object Name -Descending|Where-Object {Test-Path -LiteralPath (Join-Path $_.FullName 'x64/makeappx.exe')}|Select-Object -First 1).FullName
$package=Join-Path $OutputDirectory 'ModernShell.msix'
# Sparse manifests reference the external EXE; /nv is required by Microsoft's sparse-package instructions.
& (Join-Path $tool 'x64/makeappx.exe') pack /o /d $work /nv /p $package
if($LASTEXITCODE -ne 0){throw 'Sparse package build failed'}
if($CertificateThumbprint){& (Join-Path $tool 'x64/signtool.exe') sign /fd SHA256 /sha1 $CertificateThumbprint $package;if($LASTEXITCODE -ne 0){throw 'Sparse package signing failed'}}
Copy-Item -LiteralPath (Join-Path $root 'shell/Register-ModernShell.ps1') -Destination (Join-Path $OutputDirectory 'Register-ModernShell.ps1') -Force
Write-Output ('Modern context package: '+$package+'; signed='+[bool]$CertificateThumbprint)
