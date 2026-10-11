using System;
using System.IO;
using System.Linq;
using System.Runtime.InteropServices;
using System.Threading;

namespace NZIP {
    using J=System.Collections.Generic.Dictionary<string,object>;
    public static class ArchiveScanner {
        [DllImport("amsi.dll",CharSet=CharSet.Unicode)]static extern int AmsiInitialize(string name,out IntPtr context);
        [DllImport("amsi.dll")]static extern void AmsiUninitialize(IntPtr context);
        [DllImport("amsi.dll",CharSet=CharSet.Unicode)]static extern int AmsiScanBuffer(IntPtr context,byte[] buffer,uint length,string name,IntPtr session,out int result);
        public static J Scan(ArchiveEngine engine,J payload,CancellationToken cancel,Action<int> progress=null) {
            using(LicenseGate.Enter())return ScanCore(engine,payload,cancel,progress);
        }
        static J ScanCore(ArchiveEngine engine,J payload,CancellationToken cancel,Action<int> progress) {
            cancel.ThrowIfCancellationRequested();
            IntPtr context=IntPtr.Zero;
            try {
                if(AmsiInitialize("NZIP",out context)!=0||context==IntPtr.Zero)throw new ArchiveError("系统杀毒扫描不可用，请检查支持 AMSI 的杀毒软件是否已启用","SCAN_UNAVAILABLE");
                var archive=Json.Str(payload,"archive");var password=Json.Str(payload,"password");int codePage=(int)Json.Num(payload,"codePage");
                var data=engine.List(archive,password,cancel,null,codePage);var entries=Json.Array(Json.Get(data,"entries")).Select(Json.Map).Where(e=>!Json.Bool(e,"isDirectory")).ToArray();
                if(Json.Num(data,"totalSize")>512L*1024*1024||entries.Length>10000||entries.Any(e=>Json.Num(e,"size")>64L*1024*1024))throw new ArchiveError("扫描超出限制：总计 512 MB、10,000 个文件，单文件 64 MB；未完成扫描","SCAN_LIMIT");
                using(var staging=new TempFolder(Path.GetTempPath(),"nzip-scan-")) {
                    var destination=Path.Combine(staging.Path,"contents");
                    engine.Extract(Json.Obj("archive",archive,"password",password,"codePage",codePage,"destination",destination),cancel);
                    var files=Directory.GetFiles(destination,"*",SearchOption.AllDirectories);long total=0;int count=0;
                    foreach(var file in files){cancel.ThrowIfCancellationRequested();long length=new FileInfo(file).Length;total=checked(total+length);if(length>64L*1024*1024||total>512L*1024*1024)throw new ArchiveError("实际解压内容超出扫描限制；未完成扫描","SCAN_LIMIT");
                        int result;var bytes=File.ReadAllBytes(file);int hr=AmsiScanBuffer(context,bytes.Length==0?new byte[1]:bytes,(uint)Math.Max(1,bytes.Length),Path.GetFileName(archive)+"/"+file.Substring(destination.Length+1),IntPtr.Zero,out result);
                        if(hr!=0)throw new ArchiveError("系统杀毒引擎未完成扫描（0x"+hr.ToString("X8")+"），请检查杀毒软件状态","SCAN_UNAVAILABLE");
                        if(result>=32768||result>=16384&&result<=20479)throw new ArchiveError("系统杀毒引擎检测到威胁或策略阻止："+file.Substring(destination.Length+1)+"。请勿打开该文件。","THREAT_DETECTED");
                        count++;if(progress!=null)progress(files.Length==0?99:count*99/files.Length);
                    }
                    return Json.Obj("message","扫描完成，系统杀毒引擎未报告威胁（"+count+" 个文件）；嵌套压缩包未递归展开，结果不代表绝对安全","files",count);
                }
            }catch(DllNotFoundException){throw new ArchiveError("此系统不支持 AMSI 杀毒扫描","SCAN_UNAVAILABLE");}
            finally{if(context!=IntPtr.Zero)AmsiUninitialize(context);}
        }
    }
}
