param([Parameter(Mandatory=$true)][string]$Output)
$ErrorActionPreference='Stop'
$root=Split-Path -Parent $PSScriptRoot
$work=Join-Path $root '.cache/build-sfx'
New-Item -ItemType Directory -Path $work -Force | Out-Null
foreach($name in @('7z.exe','7z.dll')){
    $inputStream=[IO.File]::OpenRead((Join-Path $root ('vendor/7zip/'+$name)))
    $outputStream=[IO.File]::Create((Join-Path $work ($name+'.gz')))
    try{$gzip=New-Object IO.Compression.GZipStream($outputStream,[IO.Compression.CompressionMode]::Compress);try{$inputStream.CopyTo($gzip)}finally{$gzip.Dispose()}}finally{$inputStream.Dispose();$outputStream.Dispose()}
}
$sources=@('ArchiveEngine.cs','ArchiveProcess.cs','ArchiveListing.cs','ArchiveMerge.cs','ArchiveFileSystem.cs','ArchiveFormats.cs','Json.cs')|ForEach-Object {Join-Path $root ('native/'+$_)}
$compiler=Join-Path $env:WINDIR 'Microsoft.NET/Framework64/v4.0.30319/csc.exe'
& $compiler /nologo /target:winexe /platform:x64 /optimize+ /utf8output ('/out:'+ $Output) '/r:System.Core.dll' '/r:System.Drawing.dll' '/r:System.Windows.Forms.dll' '/r:System.Web.Extensions.dll' '/r:System.Security.dll' '/r:System.Net.Http.dll' '/r:System.IO.Compression.dll' ('/win32manifest:'+(Join-Path $root 'native/NZIP.manifest')) ('/resource:'+(Join-Path $work '7z.exe.gz')+',7z.exe.gz') ('/resource:'+(Join-Path $work '7z.dll.gz')+',7z.dll.gz') ('/resource:'+(Join-Path $root 'LICENSE')+',NZIP-LICENSE') ('/resource:'+(Join-Path $root 'vendor/7zip/License.txt')+',7ZIP-LICENSE') ('/resource:'+(Join-Path $root 'vendor/7zip/COPYING.LESSER.txt')+',7ZIP-LGPL') @sources (Join-Path $root 'sfx/SfxProgram.cs') (Join-Path $root 'sfx/SfxGate.cs')
if($LASTEXITCODE -ne 0){throw 'SFX compilation failed'}
