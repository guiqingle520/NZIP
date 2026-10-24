using System;
using System.Collections.Generic;
using System.Diagnostics;
using System.IO;
using System.Linq;
using System.Text;
using System.Threading;
using System.Threading.Tasks;

namespace NZIP {
    public sealed partial class ArchiveEngine {
        sealed class LogTail {
            readonly StringBuilder text=new StringBuilder();
            public void Append(char[] buffer,int offset,int count){text.Append(buffer,offset,count);if(text.Length>8192)text.Remove(0,text.Length-8192);}
            public override string ToString(){return text.ToString();}
        }
        sealed class TrackedReader:TextReader {
            readonly TextReader source;readonly LogTail tail;
            public TrackedReader(TextReader source,LogTail tail){this.source=source;this.tail=tail;}
            public override int Read(char[] buffer,int offset,int count){int n=source.Read(buffer,offset,count);tail.Append(buffer,offset,n);return n;}
        }
        string RunProcess(IEnumerable<string> args,string cwd,CancellationToken cancel,Action<int> progress,Action<TextReader> consume){
            cancel.ThrowIfCancellationRequested();
            var all=new[]{"-sccUTF-8","-bsp1"}.Concat(args);
            var info=new ProcessStartInfo(binary,String.Join(" ",all.Select(Quote))){UseShellExecute=false,CreateNoWindow=true,RedirectStandardInput=true,RedirectStandardOutput=true,RedirectStandardError=true,StandardOutputEncoding=Encoding.UTF8,StandardErrorEncoding=Encoding.UTF8};
            if(cwd!=null)info.WorkingDirectory=cwd;
            using(var process=new Process{StartInfo=info}){
                try{process.Start();}catch(Exception error){throw new ArchiveError("无法启动压缩引擎："+error.Message,"ENGINE_MISSING");}
                process.StandardInput.Close();var outputTail=new LogTail();var errorTail=new LogTail();Exception readError=null;
                var stdout=Task.Run(()=>{
                    try{
                        if(consume!=null){consume(new TrackedReader(process.StandardOutput,outputTail));return;}
                        var buffer=new char[8192];int n,digits=0,value=0,last=-1;
                        while((n=process.StandardOutput.Read(buffer,0,buffer.Length))>0){
                            cancel.ThrowIfCancellationRequested();outputTail.Append(buffer,0,n);
                            if(progress==null)continue;
                            for(int i=0;i<n;i++){
                                char c=buffer[i];if(c>='0'&&c<='9'){value=digits<3?value*10+c-'0':c-'0';digits=digits<3?digits+1:1;continue;}
                                if(c=='%'&&digits>0){int percent=Math.Min(99,value);if(percent!=last){last=percent;progress(percent);}}digits=0;value=0;
                            }
                        }
                    }catch(Exception error){readError=error;}
                });
                var stderr=Task.Run(()=>{var buffer=new char[4096];int n;while((n=process.StandardError.Read(buffer,0,buffer.Length))>0)errorTail.Append(buffer,0,n);});
                while(!process.WaitForExit(15))if(cancel.IsCancellationRequested||(stdout.IsCompleted&&readError!=null)){try{process.Kill();}catch(InvalidOperationException){}}
                stdout.GetAwaiter().GetResult();stderr.GetAwaiter().GetResult();cancel.ThrowIfCancellationRequested();
                var archiveError=readError as ArchiveError;
                if(archiveError!=null&&(archiveError.Code=="UNSAFE_PATH"||archiveError.Code=="LISTING_LIMIT"))throw archiveError;
                if(process.ExitCode!=0){
                    string detail=(errorTail.ToString()+outputTail.ToString()).ToLowerInvariant();
                    if(new[]{"wrong password","password is incorrect","enter password","encrypted archive"}.Any(detail.Contains))throw new ArchiveError("此压缩包需要正确的密码","PASSWORD_REQUIRED");
                    throw new ArchiveError(process.ExitCode==1?"压缩引擎报告警告，操作未提交，请检查权限或文件占用":detail.Contains("not enough space")?"磁盘空间不足":"操作失败，请检查密码、文件权限及压缩包是否完整");
                }
                if(readError!=null)throw readError;return outputTail.ToString();
            }
        }
    }
}
