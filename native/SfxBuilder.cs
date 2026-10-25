using System;
using System.Collections.Generic;
using System.IO;
using System.Text;
using System.Threading;
using File=NZIP.ArchiveFile;
using Directory=NZIP.ArchiveDirectory;

namespace NZIP {
    using J=Dictionary<string,object>;
    public static class SfxBuilder {
        public static readonly byte[] Marker=Encoding.ASCII.GetBytes("NZIP-SFX-0000001");
        public static J Build(ArchiveEngine engine,J p,CancellationToken cancel,Action<int> progress=null){using(LicenseGate.Enter()){
            string destination=Json.Absolute(Json.Str(p,"destination"));if(!destination.EndsWith(".exe",StringComparison.OrdinalIgnoreCase))throw new ArchiveError("自解压文件必须使用 .exe 扩展名");ArchiveEngine.CheckOutputPath(destination);if(File.Exists(destination)||Directory.Exists(destination))throw new ArchiveError("输出文件已存在","DEST_EXISTS");
            string module=Path.Combine(AppDomain.CurrentDomain.BaseDirectory,"NzipSfx.bin");if(!File.Exists(module))throw new ArchiveError("缺少自解压模块，请重新安装 NZIP");
            using(var work=new TempFolder(Path.GetDirectoryName(destination),".nzip-sfx-")){
                string archive=Json.Str(p,"archive");if(Json.Strings(p,"sources").Length>0){var payload=new J(p);payload["destination"]=Path.Combine(work.Path,"data.7z");payload["format"]="7z";payload["volume"]="";archive=Json.Str(engine.Create(payload,cancel,progress),"path");}
                else {archive=Json.Absolute(archive);var data=engine.List(archive,Json.Str(p,"password"),cancel);if(!Json.Str(data,"type").Equals("7z",StringComparison.OrdinalIgnoreCase))throw new ArchiveError("转换为自解压仅支持 7Z，请先创建 7Z 压缩包");engine.Test(archive,Json.Str(p,"password"),cancel);}
                string output=Path.Combine(work.Path,"output.exe");using(var target=new FileStream(ArchivePath.Native(output),FileMode.CreateNew,FileAccess.Write,FileShare.None)){
                    using(var input=File.OpenRead(module))Copy(input,target,cancel);long length;using(var input=File.OpenRead(archive)){length=input.Length;Copy(input,target,cancel);}var writer=new BinaryWriter(target);writer.Write(length);writer.Write(Marker);writer.Flush();
                }
                cancel.ThrowIfCancellationRequested();File.Move(output,destination);return Json.Obj("path",destination,"outputs",new[]{destination},"message","自解压文件已创建");
            }
        }}
        static void Copy(Stream input,Stream output,CancellationToken cancel){var buffer=new byte[65536];int count;while((count=input.Read(buffer,0,buffer.Length))>0){cancel.ThrowIfCancellationRequested();output.Write(buffer,0,count);}}
    }
}
