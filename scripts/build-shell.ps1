param([Parameter(Mandatory=$true)][string]$Output,[ValidateSet('NZIP','NZIPPaid','NZIPPaidPreview')][string]$Product='NZIP',[switch]$Test)
$ErrorActionPreference='Stop'
$root=Split-Path -Parent $PSScriptRoot
$vs='C:/Program Files (x86)/Microsoft Visual Studio/2022/BuildTools/VC/Tools/MSVC'
$tools=(Get-ChildItem -LiteralPath $vs -Directory | Sort-Object Name -Descending | Select-Object -First 1).FullName
$sdk='C:/Program Files (x86)/Windows Kits/10'
$sdkVersion=(Get-ChildItem -LiteralPath (Join-Path $sdk 'Include') -Directory | Sort-Object Name -Descending | Select-Object -First 1).Name
$work=Join-Path $root ('.cache/build-shell-'+$Product)
New-Item -ItemType Directory -Path $work -Force | Out-Null
$tail=switch($Product){'NZIP'{'0x01'}'NZIPPaid'{'0x02'}'NZIPPaidPreview'{'0x03'}}
$extensions=Get-Content -LiteralPath (Join-Path $root 'native/ArchiveFormats.cs') -Raw -Encoding UTF8
$array=[regex]::Match($extensions,'ReadExtensions\s*=\s*new\[\]\s*\{([^}]+)\}').Groups[1].Value
if(-not $array){$array=[regex]::Match($extensions,'ReadExtensions\s*=\s*\{([^}]+)\}').Groups[1].Value}
$known=[regex]::Matches($array,'"([a-zA-Z0-9]+)"')|ForEach-Object {'L".'+$_.Groups[1].Value+'"'}
if(@($known).Count -lt 20){throw 'Archive extension catalog could not be parsed'}
$header='#pragma once'+"`n"+'static const GUID NZIP_CLSID={0xc9156331,0x76ac,0x4a51,{0x93,0xa2,0x0d,0x57,0xc2,0xb3,0xc0,'+$tail+'}};'+"`n"+'#define NZIP_EXE L"'+$Product+'.exe"'+"`n"+'#define NZIP_LANGUAGE_KEY L"Software\\'+$Product+'"'+"`n"+'static const wchar_t* archiveExtensions[]={'+($known -join ',')+'};'
Set-Content -LiteralPath (Join-Path $work 'ShellConfig.h') -Value $header -Encoding UTF8
$args=@('/nologo','/LD','/MT','/O2','/W4','/EHsc','/guard:cf','/std:c++17','/utf-8','/DUNICODE','/D_UNICODE',('/I'+(Join-Path $tools 'include')),('/I'+$work))
foreach($part in @('ucrt','shared','um','winrt')){$args+='/I'+(Join-Path $sdk ('Include/'+$sdkVersion+'/'+$part))}
$args+=@((Join-Path $root 'shell/ExplorerCommand.cpp'),('/Fo'+(Join-Path $work 'ExplorerCommand.obj')),'/link','/EXPORT:DllGetClassObject,PRIVATE','/EXPORT:DllCanUnloadNow,PRIVATE',('/OUT:'+ $Output),('/IMPLIB:'+(Join-Path $work 'NzipShell.lib')),('/LIBPATH:'+(Join-Path $tools 'lib/x64')),('/LIBPATH:'+(Join-Path $sdk ('Lib/'+$sdkVersion+'/um/x64'))),('/LIBPATH:'+(Join-Path $sdk ('Lib/'+$sdkVersion+'/ucrt/x64'))),'ole32.lib','shell32.lib','shlwapi.lib','advapi32.lib','uuid.lib','/DYNAMICBASE','/NXCOMPAT','/GUARD:CF')
if($Test){$args=@($args|Where-Object {$_ -ne '/LD' -and $_ -notlike '/EXPORT:*' -and $_ -notlike '/IMPLIB:*' -and $_ -notlike '*ExplorerCommand.cpp'});$args=@((Join-Path $root 'shell/ShellTests.cpp'))+$args}
& (Join-Path $tools 'bin/Hostx64/x64/cl.exe') @args
if($LASTEXITCODE -ne 0){throw 'Explorer command compilation failed'}
