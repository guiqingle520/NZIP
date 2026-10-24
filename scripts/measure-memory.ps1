param([Parameter(Mandatory=$true)][string]$Executable,[Parameter(Mandatory=$true)][string]$Request,[Parameter(Mandatory=$true)][string]$Response,[Parameter(Mandatory=$true)][string]$Report)
$ErrorActionPreference='Stop'
Add-Type -TypeDefinition @'
using System;
using System.Collections.Generic;
using System.Runtime.InteropServices;
public static class NzipProcessTree {
    [StructLayout(LayoutKind.Sequential,CharSet=CharSet.Unicode)]struct Entry {
        public uint size,usage,id;public UIntPtr heap;public uint module,threads,parent;public int priority;public uint flags;
        [MarshalAs(UnmanagedType.ByValTStr,SizeConst=260)]public string name;
    }
    [DllImport("kernel32.dll")]static extern IntPtr CreateToolhelp32Snapshot(uint flags,uint id);
    [DllImport("kernel32.dll",CharSet=CharSet.Unicode)]static extern bool Process32First(IntPtr snapshot,ref Entry entry);
    [DllImport("kernel32.dll",CharSet=CharSet.Unicode)]static extern bool Process32Next(IntPtr snapshot,ref Entry entry);
    [DllImport("kernel32.dll")]static extern bool CloseHandle(IntPtr handle);
    public static int[] Children(int parent){
        var result=new List<int>();var snapshot=CreateToolhelp32Snapshot(2,0);if(snapshot==new IntPtr(-1))return result.ToArray();
        try{var entry=new Entry();entry.size=(uint)Marshal.SizeOf(entry);if(Process32First(snapshot,ref entry))do{if(entry.parent==parent)result.Add((int)entry.id);}while(Process32Next(snapshot,ref entry));}finally{CloseHandle(snapshot);}return result.ToArray();
    }
}
'@
$info=New-Object Diagnostics.ProcessStartInfo
$info.FileName=[IO.Path]::GetFullPath($Executable)
$info.Arguments='--engine-rpc'
$info.UseShellExecute=$false
$info.CreateNoWindow=$true
$info.RedirectStandardInput=$true
$info.RedirectStandardOutput=$true
$info.RedirectStandardError=$true
$info.StandardOutputEncoding=[Text.Encoding]::UTF8
$info.StandardErrorEncoding=[Text.Encoding]::UTF8
$process=New-Object Diagnostics.Process
$process.StartInfo=$info
$stream=[IO.File]::Create([IO.Path]::GetFullPath($Response))
$clock=[Diagnostics.Stopwatch]::StartNew()
$samples=0
$peakPrivate=0L;$peakWorking=0L;$peakEnginePrivate=0L;$peakCombinedPrivate=0L
try {
    if(-not $process.Start()){throw 'Could not start NZIP'}
    $copy=$process.StandardOutput.BaseStream.CopyToAsync($stream)
    $errors=$process.StandardError.ReadToEndAsync()
    $requestBytes=[Text.Encoding]::UTF8.GetBytes([IO.File]::ReadAllText([IO.Path]::GetFullPath($Request)))
    $process.StandardInput.BaseStream.Write($requestBytes,0,$requestBytes.Length)
    $process.StandardInput.Close()
    do {
        try {
            $process.Refresh();$private=$process.PrivateMemorySize64;$working=$process.WorkingSet64
            $enginePrivate=0L
            foreach($childId in [NzipProcessTree]::Children($process.Id)) {
                try {$child=[Diagnostics.Process]::GetProcessById($childId);try {$enginePrivate+=$child.PrivateMemorySize64}finally{$child.Dispose()}}catch [ArgumentException]{}catch [InvalidOperationException]{}
            }
            $peakPrivate=[Math]::Max($peakPrivate,$private);$peakWorking=[Math]::Max($peakWorking,$working)
            $peakEnginePrivate=[Math]::Max($peakEnginePrivate,$enginePrivate);$peakCombinedPrivate=[Math]::Max($peakCombinedPrivate,$private+$enginePrivate);$samples++
        }catch [InvalidOperationException]{}
        if($clock.Elapsed.TotalMinutes -gt 5){$process.Kill();throw 'NZIP memory benchmark timed out'}
    }while(-not $process.WaitForExit(25))
    $copy.GetAwaiter().GetResult();$stream.Flush()
    $result=[ordered]@{executable=$info.FileName;exitCode=$process.ExitCode;durationMs=$clock.ElapsedMilliseconds;samples=$samples;peakPrivateBytes=$peakPrivate;peakWorkingSetBytes=$peakWorking;peakEnginePrivateBytes=$peakEnginePrivate;peakCombinedPrivateBytes=$peakCombinedPrivate;stderr=$errors.GetAwaiter().GetResult()}
    [IO.File]::WriteAllText([IO.Path]::GetFullPath($Report),($result|ConvertTo-Json), (New-Object Text.UTF8Encoding $false))
}finally{$stream.Dispose();$process.Dispose()}
