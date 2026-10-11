using System;
using System.Collections.Generic;
using System.Diagnostics;
using System.IO;
using System.Linq;
using System.Text;
using System.Threading;
using System.Threading.Tasks;
using Microsoft.Win32;

namespace NZIP {
    using J=Dictionary<string,object>;
    public sealed class Backend:IDisposable {
        readonly object gate=new object();readonly object writes=new object();
        public readonly ArchiveEngine Engine;public readonly string Profile;
        J settings;List<object> recent=new List<object>();readonly List<J> jobs=new List<J>();readonly Queue<Work> queue=new Queue<Work>();
        readonly TempFolder previews;Work active;bool worker;public event Action<string,object> Changed;
        public Backend(string profile) {
            Profile=profile;settings=Json.Obj("theme","light","openAfterExtract",true,"defaultFormat","zip","defaultLevel",5,"rememberHistory",true,"contextMenu",false);
            try{var old=Json.Decode(File.ReadAllText(Path.Combine(profile,"preferences.json")));foreach(var p in Json.Map(Json.Get(old,"settings")))if(settings.ContainsKey(p.Key))settings[p.Key]=p.Value;recent=Json.Array(Json.Get(old,"recent")).ToList();}catch(IOException){}catch(ArgumentException){}
            var binary=Environment.GetEnvironmentVariable("NZIP_7Z_PATH")??Path.Combine(AppDomain.CurrentDomain.BaseDirectory,"7zip","7z.exe");Engine=new ArchiveEngine(binary);previews=new TempFolder(Path.GetTempPath(),"nzip-preview-");
            settings["contextMenu"]=ShellIntegration.IsContextEnabled(System.Windows.Forms.Application.ExecutablePath);
        }
        void Emit(string name,object value){var c=Changed;if(c!=null)c(name,value);}
        void Jobs(){lock(gate)Emit("jobs",jobs.ToArray());}
        void State(){lock(gate)Emit("state",Json.Obj("settings",settings,"recent",recent));}
        void Persist(){lock(writes){string content;lock(gate)content=Json.Encode(Json.Obj("settings",settings,"recent",recent));Directory.CreateDirectory(Profile);var target=Path.Combine(Profile,"preferences.json");var temp=Path.Combine(Profile,".preferences-"+Guid.NewGuid().ToString("N"));File.WriteAllText(temp,content,new UTF8Encoding(false));try{if(File.Exists(target))File.Replace(temp,target,null);else File.Move(temp,target);}finally{if(File.Exists(temp))File.Delete(temp);}}}
        void Remember(J data){lock(gate){if(!Json.Bool(settings,"rememberHistory"))return;recent.RemoveAll(r=>Json.Str(Json.Map(r),"path")==Json.Str(data,"path"));recent.Insert(0,Json.Obj("path",Json.Get(data,"path"),"name",Json.Get(data,"name"),"size",Json.Get(data,"archiveSize"),"type",Json.Get(data,"type"),"openedAt",Json.Now));if(recent.Count>30)recent.RemoveRange(30,recent.Count-30);}Persist();State();}
        public void RememberOpened(J data){Remember(data);}
        public bool Busy{get{lock(gate)return active!=null||queue.Count>0;}}
        public void CancelAll(){lock(gate){foreach(var w in queue){w.Cancel.Cancel();w.Job["status"]="cancelled";w.Job["finishedAt"]=Json.Now;w.Cancel.Dispose();if(w.Completion!=null)w.Completion.TrySetCanceled();}queue.Clear();if(active!=null)active.Cancel.Cancel();}Jobs();}
        public Task<J> ExtractForOpen(J payload){var completion=new TaskCompletionSource<J>(TaskCreationOptions.RunContinuationsAsynchronously);payload["openAfterExtract"]=false;Enqueue("extract",payload,completion);return completion.Task;}
        J Enqueue(string kind,J payload,TaskCompletionSource<J> completion=null){
            var capability=LicenseGate.Capture();
            if(!new[]{"create","extract","test","modify","scan","comment","repair","recover"}.Contains(kind))throw new ArchiveError("无效操作");
            var work=new Work{Id=Guid.NewGuid().ToString(),Kind=kind,Payload=payload,Completion=completion,Capability=capability};work.Job=Json.Obj("id",work.Id,"type",kind,"label",Path.GetFileName(Json.Str(payload,kind=="create"?"destination":"archive")),"status","queued","percent",0,"createdAt",Json.Now);
            bool start;lock(gate){jobs.Insert(0,work.Job);if(jobs.Count>100)jobs.RemoveAt(jobs.Count-1);queue.Enqueue(work);start=!worker;worker=true;}Jobs();if(start)Task.Run((Action)Drain);return Json.Obj("ok",true,"id",work.Id);
        }
        void Drain(){
            while(true){Work w;lock(gate){if(queue.Count==0){worker=false;return;}w=queue.Dequeue();active=w;w.Job["status"]="running";w.Job["startedAt"]=Json.Now;}Jobs();
                Action<int> progress=n=>{lock(gate)w.Job["percent"]=n;Jobs();};J result=null;Exception failure=null;
                try{using(LicenseGate.Admitted(w.Capability)){
                    var token=w.Cancel.Token;
                    if(w.Kind=="create")result=Engine.Create(w.Payload,token,progress);else if(w.Kind=="extract")result=Engine.Extract(w.Payload,token,progress);else if(w.Kind=="modify")result=Engine.Modify(w.Payload,token,progress);else if(w.Kind=="scan")result=ArchiveScanner.Scan(Engine,w.Payload,token,progress);else if(w.Kind=="comment")result=ArchiveTools.WriteComment(Engine,w.Payload,token);else if(w.Kind=="repair")result=ArchiveTools.Repair(Engine,w.Payload,token,progress);else if(w.Kind=="recover")result=ArchiveTools.RecoverPassword(Engine,w.Payload,token,progress);else result=Engine.Test(Json.Str(w.Payload,"archive"),Json.Str(w.Payload,"password"),token,progress,(int)Json.Num(w.Payload,"codePage"));
                    if(w.Kind=="create"){try{Remember(Engine.List(Json.Str(result,"path"),Json.Str(w.Payload,"password"),CancellationToken.None));}catch(Exception){}}
                    if(w.Kind=="extract"){bool open;lock(gate)open=Json.Bool(w.Payload,"openAfterExtract",Json.Bool(settings,"openAfterExtract"));if(open){try{Reveal(Json.Str(result,"path"),true);}catch(Exception){}}}
                    lock(gate){w.Job["status"]="completed";w.Job["percent"]=100;w.Job["result"]=result;}
                }}catch(Exception e){failure=e;lock(gate){w.Job["status"]=e is OperationCanceledException?"cancelled":"failed";w.Job["error"]=e is OperationCanceledException?"操作已取消":e.Message;w.Job["code"]=Json.Get(ArchiveError.Failure(e),"code");}}
                finally{lock(gate){w.Job["finishedAt"]=Json.Now;active=null;}w.Cancel.Dispose();Jobs();if(w.Completion!=null){if(failure is OperationCanceledException)w.Completion.TrySetCanceled();else if(failure!=null)w.Completion.TrySetException(failure);else w.Completion.TrySetResult(result);}}
            }
        }
        public J Dispatch(string action,object[] args){var result=DispatchCore(action,args);if(new[]{"init","settings","integration"}.Contains(action)){lock(gate)return Json.Decode(Json.Encode(result));}return result;}
        J DispatchCore(string action,object[] args){
            Func<int,object> arg=i=>i<args.Length?args[i]:null;Func<int,string> str=i=>Convert.ToString(arg(i))??"";var token=CancellationToken.None;
            switch(action){
                case "init":lock(gate)return Json.Obj("ok",true,"settings",settings,"recent",recent,"jobs",jobs,"version",typeof(Backend).Assembly.GetName().Version.ToString(3),"downloads",Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.UserProfile),"Downloads"),"canIntegrate",true,"runtime","winforms");
                case "list":var data=Engine.List(str(0),str(1),token,null,Convert.ToInt32(arg(2)));Remember(data);return Json.Obj("ok",true,"data",data);
                case "describe":return Json.Obj("ok",true,"files",Json.Array(arg(0)).Select(v=>{var p=Json.Absolute(Convert.ToString(v));bool dir=Directory.Exists(p);if(!dir&&!File.Exists(p))throw new FileNotFoundException("文件不存在",p);return Json.Obj("path",p,"name",Path.GetFileName(p),"size",dir?0:new FileInfo(p).Length,"isDirectory",dir);}).ToArray());
                case "start-job":return Enqueue(str(0),Json.Map(arg(1)));
                case "extract-folder":var archive=Json.Absolute(str(0));var name=ArchiveFormats.Stem(archive);if(String.IsNullOrWhiteSpace(name)||name=="."||name=="..")name="解压结果";var destination=Path.Combine(Path.GetDirectoryName(archive),name);int suffix=2;while(Directory.Exists(destination)||File.Exists(destination))destination=Path.Combine(Path.GetDirectoryName(archive),name+" ("+(suffix++)+")");return Enqueue("extract",Json.Obj("archive",archive,"password",str(1),"codePage",Convert.ToInt32(arg(2)),"destination",destination));
                case "cancel-job":lock(gate){var id=str(0);if(active!=null&&active.Id==id){active.Cancel.Cancel();active.Job["status"]="cancelling";}else{var pending=queue.Where(w=>w.Id!=id).ToArray();var removed=queue.Where(w=>w.Id==id).ToArray();queue.Clear();foreach(var w in pending)queue.Enqueue(w);foreach(var w in removed){w.Job["status"]="cancelled";w.Job["finishedAt"]=Json.Now;w.Cancel.Dispose();if(w.Completion!=null)w.Completion.TrySetCanceled();}}}Jobs();return Json.Obj("ok",true);
                case "settings":var update=Json.Map(arg(0));lock(gate){if(new[]{"light","dark","system"}.Contains(Json.Str(update,"theme")))settings["theme"]=update["theme"];foreach(var k in new[]{"openAfterExtract","rememberHistory"})if(Json.Get(update,k) is bool)settings[k]=update[k];if(ArchiveFormats.CreateFormats.Contains(Json.Str(update,"defaultFormat")))settings["defaultFormat"]=update["defaultFormat"];if(update.ContainsKey("defaultLevel")&&new long[]{0,1,3,5,7,9}.Contains(Json.Num(update,"defaultLevel")))settings["defaultLevel"]=update["defaultLevel"];if(!Json.Bool(settings,"rememberHistory"))recent.Clear();}Persist();State();lock(gate)return Json.Obj("ok",true,"settings",settings);
                case "clear-history":lock(gate)recent.Clear();Persist();State();return Json.Obj("ok",true);
                case "integration":bool enabled=arg(0) is bool&&(bool)arg(0);ContextMenus(enabled);lock(gate)settings["contextMenu"]=enabled;Persist();lock(gate)return Json.Obj("ok",true,"settings",settings);
                case "reveal":Reveal(str(0),false);return Json.Obj("ok",true);
                case "open-result":string resultPath;bool openFolder;lock(gate){var job=jobs.FirstOrDefault(j=>Json.Str(j,"id")==str(0));if(!HasOpenableResult(job))throw new ArchiveError("所选任务尚未完成，或没有可打开的输出位置");resultPath=Json.Str(Json.Map(Json.Get(job,"result")),"path");openFolder=Json.Str(job,"type")=="extract";}Reveal(resultPath,openFolder);return Json.Obj("ok",true);
                case "preview":return Preview(Json.Map(arg(0)));
                case "take-password":lock(gate){var completed=jobs.FirstOrDefault(j=>Json.Str(j,"id")==str(0));var value=Json.Map(completed==null?null:Json.Get(completed,"result"));var secret=Json.Str(value,"password");value.Remove("password");return Json.Obj("ok",true,"password",secret);}
                default:throw new ArchiveError("无效操作");
            }
        }
        J Preview(J p){
            var entry=Json.Str(Json.Map(Json.Get(p,"entry")),"path");var ext=Path.GetExtension(entry).ToLowerInvariant();var mime=new Dictionary<string,string>{{".png","image/png"},{".jpg","image/jpeg"},{".jpeg","image/jpeg"},{".gif","image/gif"},{".webp","image/webp"},{".bmp","image/bmp"}};
            if(!mime.ContainsKey(ext)&&!new[]{".txt",".md",".json",".csv",".log",".xml",".yaml",".yml",".ini",".css",".js",".ts",".html"}.Contains(ext))throw new ArchiveError("此类型暂不支持预览，请解压后打开");
            var data=Engine.List(Json.Str(p,"archive"),Json.Str(p,"password"),CancellationToken.None,null,(int)Json.Num(p,"codePage"));var actual=Json.Array(Json.Get(data,"entries")).Select(Json.Map).FirstOrDefault(e=>Json.Str(e,"path")==entry);
            if(actual==null||Json.Bool(actual,"isDirectory")||Json.Num(actual,"size")>10*1024*1024)throw new ArchiveError("仅支持预览 10 MB 以内的文本或图片");
            var destination=Path.Combine(previews.Path,Guid.NewGuid().ToString("N"));
            try{Engine.Extract(Json.Obj("archive",Json.Get(p,"archive"),"destination",destination,"password",Json.Get(p,"password"),"codePage",Json.Get(p,"codePage"),"selected",new[]{entry}),CancellationToken.None);var bytes=File.ReadAllBytes(Path.Combine(destination,entry));if(mime.ContainsKey(ext))return Json.Obj("ok",true,"kind","image","content","data:"+mime[ext]+";base64,"+Convert.ToBase64String(bytes));string content;using(var reader=new StreamReader(new MemoryStream(bytes),new UTF8Encoding(false),true))content=reader.ReadToEnd();return Json.Obj("ok",true,"kind","text","content",content.Substring(0,Math.Min(200000,content.Length)),"truncated",content.Length>200000);}
            finally{if(Json.Within(previews.Path,destination)&&Directory.Exists(destination))Directory.Delete(destination,true);}
        }
        internal static bool HasOpenableResult(J job){return job!=null&&Json.Str(job,"status")=="completed"&&!String.IsNullOrWhiteSpace(Json.Str(Json.Map(Json.Get(job,"result")),"path"));}
        internal Action<ProcessStartInfo> resultLauncher=info=>Process.Start(info);
        void Reveal(string p,bool open){if(!File.Exists(p)&&!Directory.Exists(p))throw new ArchiveError("文件或文件夹已不存在");resultLauncher(new ProcessStartInfo("explorer.exe",open?ArchiveEngine.Quote(p):"/select,"+ArchiveEngine.Quote(p)){UseShellExecute=false,CreateNoWindow=true});}
        static void ContextMenus(bool enabled){ShellIntegration.SetContextMenus(System.Windows.Forms.Application.ExecutablePath,enabled);}
        public void Dispose(){CancelAll();previews.Dispose();}
        class Work{public bool Capability;public string Id,Kind;public J Payload,Job;public TaskCompletionSource<J> Completion;public readonly CancellationTokenSource Cancel=new CancellationTokenSource();}
    }
}
