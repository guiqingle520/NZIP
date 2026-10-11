using System;
using System.Collections.Generic;
using System.Diagnostics;
using System.Drawing;
using System.IO;
using System.IO.Pipes;
using System.Linq;
using System.Runtime.InteropServices;
using System.Security.Cryptography;
using System.Text;
using System.Threading;
using System.Threading.Tasks;
using System.Windows.Forms;



namespace NZIP {
    using J=Dictionary<string,object>;
    static class Program {
        [DllImport("user32.dll")]static extern bool SetProcessDpiAwarenessContext(IntPtr value);
        [STAThread]static int Main(string[] args){
            AppContext.SetSwitch("Switch.System.IO.UseLegacyPathHandling",false);AppContext.SetSwitch("Switch.System.IO.BlockLongPaths",false);
            if(args.Contains("--register-shell")||args.Contains("--unregister-shell")){
                try{if(args.Contains("--register-shell"))ShellIntegration.Register(Application.ExecutablePath,!args.Contains("--no-context-menu"));else ShellIntegration.Unregister(Application.ExecutablePath);return 0;}catch(Exception){return 1;}
            }
            if(args.Contains("--check-runtime"))return 0;
            if(Edition.Paid&&(args.Contains("--license-import")||args.Contains("--license-status"))){
                Console.SetOut(new StreamWriter(Console.OpenStandardOutput(),new UTF8Encoding(false)){AutoFlush=true});
                try{if(args.Contains("--license-import")){int index=Array.IndexOf(args,"--license-import");if(index+1>=args.Length)throw new ArchiveError("缺少授权文件路径");var file=new FileInfo(args[index+1]);if(file.Length>16384)throw new ArchiveError("授权文件过大");LicenseRuntime.Current.Import(File.ReadAllText(file.FullName,new UTF8Encoding(false,true)));}Console.WriteLine(Json.Encode(Json.Obj("ok",true,"license",LicenseRuntime.Current.Status())));return 0;}catch(Exception error){Console.WriteLine(Json.Encode(ArchiveError.Failure(error)));return 1;}
            }
            if(args.Contains("--engine-rpc")){
                Console.SetIn(new StreamReader(Console.OpenStandardInput(),new UTF8Encoding(false)));
                Console.SetOut(new StreamWriter(Console.OpenStandardOutput(),new UTF8Encoding(false)){AutoFlush=true});
                try{var p=Json.Decode(Console.In.ReadToEnd());var payload=Json.Map(Json.Get(p,"payload"));var binary=Environment.GetEnvironmentVariable("NZIP_7Z_PATH")??Path.Combine(AppDomain.CurrentDomain.BaseDirectory,"7zip","7z.exe");var e=new ArchiveEngine(binary);var token=Json.Bool(p,"cancel")?new CancellationToken(true):CancellationToken.None;J data;
                    switch(Json.Str(p,"operation")){case "list":data=e.List(Json.Str(payload,"archive"),Json.Str(payload,"password"),token,null,(int)Json.Num(payload,"codePage"));break;case "create":data=e.Create(payload,token);break;case "extract":data=e.Extract(payload,token);break;case "modify":data=e.Modify(payload,token);break;case "scan":data=ArchiveScanner.Scan(e,payload,token);break;case "comment":data=ArchiveTools.WriteComment(e,payload,token);break;case "read-comment":data=Json.Obj("comment",ArchiveTools.Comment(Json.Str(payload,"archive"),(int)Json.Num(payload,"codePage")));break;case "detect-codepage":data=ArchiveTools.DetectCodePage(Json.Str(payload,"archive"));break;case "zip-metadata":data=ArchiveTools.ZipMetadata(Json.Str(payload,"archive"),(int)Json.Num(payload,"codePage"));break;case "repair":data=ArchiveTools.Repair(e,payload,token);break;case "recover":data=ArchiveTools.RecoverPassword(e,payload,token);break;default:data=e.Test(Json.Str(payload,"archive"),Json.Str(payload,"password"),token,null,(int)Json.Num(payload,"codePage"));break;}
                    Console.WriteLine(Json.Encode(Json.Obj("ok",true,"data",data)));
                }catch(Exception e){Console.WriteLine(Json.Encode(ArchiveError.Failure(e)));}return 0;
            }
            var profile=Environment.GetEnvironmentVariable("NZIP_USER_DATA")??Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.ApplicationData),Edition.Id);
            string key;using(var sha=SHA256.Create())key=Edition.Id+"-"+BitConverter.ToString(sha.ComputeHash(Encoding.UTF8.GetBytes(profile.ToLowerInvariant()))).Replace("-","").Substring(0,24);
            if(args.Contains("--check-running")){try{using(var existing=Mutex.OpenExisting(key))return 3;}catch(WaitHandleCannotBeOpenedException){return 0;}}
            if(args.Contains("--new-window"))key+="-"+Guid.NewGuid().ToString("N");
            AppContext.SetSwitch("Switch.System.IO.UseLegacyPathHandling",false);AppContext.SetSwitch("Switch.System.IO.BlockLongPaths",false);
            bool created;using(var mutex=new Mutex(true,key,out created)){
                if(!created){try{using(var pipe=new NamedPipeClientStream(".",key,PipeDirection.Out)){pipe.Connect(2000);using(var writer=new StreamWriter(pipe)){writer.WriteLine(Json.Encode(Json.Obj("args",args)));}}}catch(IOException){}catch(TimeoutException){}return 0;}
                try{SetProcessDpiAwarenessContext(new IntPtr(-4));}catch(EntryPointNotFoundException){}
                Application.EnableVisualStyles();Application.SetCompatibleTextRenderingDefault(false);
                using(var backend=new Backend(profile))using(var window=new DesktopWindow(backend,args,key))Application.Run(window);
                mutex.ReleaseMutex();return Environment.ExitCode;
            }
        }
        public static J LaunchRequest(string[] args){for(int i=0;i<args.Length-1;i++)if(new[]{"--open","--extract","--extract-folder","--compress"}.Contains(args[i]))return Json.Obj("type",args[i].Substring(2),"path",args[i+1]);var file=args.FirstOrDefault(p=>!p.StartsWith("-")&&ShellIntegration.Extensions.Contains(Path.GetExtension(p).TrimStart('.').ToLowerInvariant()));return file==null?null:Json.Obj("type","open","path",file);}
    }
}
