using System;
using System.Diagnostics;
using System.IO;
using System.Text;
using System.Threading.Tasks;

namespace NZIP {
    internal static class ModernShell {
        public static bool HasSignature(){try{using(var package=System.IO.Compression.ZipFile.OpenRead(Path.Combine(AppDomain.CurrentDomain.BaseDirectory,"ModernShell.msix")))return package.GetEntry("AppxSignature.p7x")!=null;}catch(IOException){return false;}catch(InvalidDataException){return false;}}
        public static async Task Set(bool enabled){
            var root=AppDomain.CurrentDomain.BaseDirectory;var script=Path.Combine(root,"Register-ModernShell.ps1");if(!File.Exists(script))throw new ArchiveError("缺少 Windows 11 右键组件，请重新安装");
            string shell=Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.System),@"WindowsPowerShell\v1.0\powershell.exe");var args="-NoLogo -NoProfile -NonInteractive -WindowStyle Hidden -ExecutionPolicy Bypass -File "+ArchiveEngine.Quote(script)+" -Mode "+(enabled?"register":"unregister")+" -Product "+Edition.Id+" -Directory "+ArchiveEngine.Quote(root.TrimEnd('\\'));
            using(var process=new Process{StartInfo=new ProcessStartInfo(shell,args){UseShellExecute=false,CreateNoWindow=true,RedirectStandardOutput=true,RedirectStandardError=true,StandardErrorEncoding=Encoding.UTF8}}){process.Start();var output=process.StandardOutput.ReadToEndAsync();var error=process.StandardError.ReadToEndAsync();await Task.Run(()=>process.WaitForExit());await output;var detail=await error;if(process.ExitCode!=0)throw new ArchiveError("Windows 11 一级右键注册未完成："+detail);}
        }
    }
}
