using System;
using System.Collections.Generic;
using System.Diagnostics;
using System.IO;
using File=NZIP.ArchiveFile;
using Directory=NZIP.ArchiveDirectory;
using System.Linq;
using System.Runtime.InteropServices;
using System.Text;
using System.Text.RegularExpressions;
using System.Threading;
using System.Threading.Tasks;

namespace NZIP {
    using J=Dictionary<string,object>;
    public sealed partial class ArchiveEngine {
        public static bool AllowLongPaths=true;
        readonly string binary;
        static readonly Regex Device=new Regex(@"^(CON|PRN|AUX|NUL|COM[1-9]|LPT[1-9])(?:\.|$)",RegexOptions.IgnoreCase|RegexOptions.Compiled);
        static readonly Regex Percent=new Regex(@"(\d{1,3})%",RegexOptions.Compiled);
        public ArchiveEngine(string executable){binary=executable;}
        [DllImport("kernel32.dll",CharSet=CharSet.Unicode,SetLastError=true)]static extern bool CreateHardLink(string file,string existing,IntPtr security);
        public static string Quote(string arg) {
            if(arg.Length>0&&!arg.Any(c=>Char.IsWhiteSpace(c)||c=='"'))return arg;
            var b=new StringBuilder("\"");int slashes=0;
            foreach(char c in arg){if(c=='\\'){slashes++;continue;}if(c=='"'){b.Append('\\',slashes*2+1);b.Append('"');}else{b.Append('\\',slashes);b.Append(c);}slashes=0;}
            b.Append('\\',slashes*2);return b.Append('"').ToString();
        }
        public string Run(IEnumerable<string> args,string cwd,CancellationToken cancel,Action<int> progress=null){return RunProcess(args,cwd,cancel,progress,null);}
        public static string SafeEntry(string name) {
            var n=name.Replace('\\','/');
            if(n.Length==0||n.StartsWith("/")||n.Contains(":")||n.Any(c=>c<' '||"<>\"|?*".Contains(c))||n.Split('/').Any(s=>s=="."||s==".."||s.EndsWith(".")||s.EndsWith(" ")||Device.IsMatch(s)))throw new ArchiveError("压缩包包含不安全的路径："+name,"UNSAFE_PATH");return n;
        }
        public static J ParseList(string output,string archivePath=null){using(var reader=new StringReader(output))return ReadListing(reader,archivePath,CancellationToken.None);}
        public static J ParseList(TextReader reader,string archivePath,CancellationToken cancel){return ReadListing(reader,archivePath,cancel);}
        public static string[] CodePageOptions(int codePage) {
            if(!new[]{0,65001,936,950,932,949,437,1252,1250,1251,1254,1253,1256,1255,1257,874}.Contains(codePage))throw new ArchiveError("不支持的文件名代码页");
            return codePage==0?new string[0]:new[]{"-mcp="+codePage};
        }
        J ListRaw(string archive,string password,CancellationToken cancel,Action<int> progress=null,int codePage=0) {
            archive=Json.Absolute(archive);J data=null;RunProcess(new[]{"l","-slt","-p"+(password??"")}.Concat(CodePageOptions(codePage)).Concat(new[]{"--",archive}),null,cancel,progress,reader=>data=ReadListing(reader,archive,cancel));
            data["path"]=archive;data["name"]=Path.GetFileName(archive);data["archiveSize"]=new FileInfo(ArchivePath.Native(archive)).Length;return data;
        }
        sealed class ReadArchive:IDisposable {public string Path,OuterType;public J Data;public TempFolder Temp;public void Dispose(){if(Temp!=null)Temp.Dispose();}}
        ReadArchive OpenRead(string archive,string password,CancellationToken cancel,int codePage){
            archive=Json.Absolute(archive);var opened=new ReadArchive{Path=archive};if(!ArchiveFormats.CompoundTar(archive))return opened;
            try{
                var outer=ListRaw(archive,password,cancel,null,codePage);var entries=Json.Array(Json.Get(outer,"entries")).Select(Json.Map).ToArray();
                if(entries.Length!=1||Json.Bool(entries[0],"isDirectory")||!new[]{"gzip","bzip2","xz","zstd","z","lzma"}.Contains(Json.Str(outer,"type").ToLowerInvariant()))throw new ArchiveError("此复合 TAR 文件的外层格式无效");
                opened.Temp=new TempFolder(System.IO.Path.GetTempPath(),"nzip-tar-");var drive=new DriveInfo(System.IO.Path.GetPathRoot(opened.Temp.Path));if(drive.IsReady&&Json.Num(entries[0],"size")>drive.AvailableFreeSpace)throw new ArchiveError("临时目录磁盘空间不足，无法展开 TAR 包");
                Run(new[]{"e","-y","-p"+(password??""),"-o"+opened.Temp.Path,"--",archive},null,cancel);
                VerifyTree(opened.Temp.Path,cancel);var files=Directory.GetFiles(opened.Temp.Path);if(files.Length!=1||Directory.GetDirectories(opened.Temp.Path).Length!=0)throw new ArchiveError("复合 TAR 包应包含一个 TAR 文件");
                opened.Path=files[0];try{opened.Data=ListRaw(opened.Path,password,cancel,null,codePage);}catch(ArchiveError error){if(error.Code=="UNSAFE_PATH")throw;throw new ArchiveError("此复合压缩包中没有可读取的 TAR 文件："+error.Message,error.Code);}opened.OuterType=Json.Str(outer,"type");if(!Json.Str(opened.Data,"type").Equals("tar",StringComparison.OrdinalIgnoreCase))throw new ArchiveError("此复合压缩包中没有有效的 TAR 文件");return opened;
            }catch{opened.Dispose();throw;}
        }
        public J List(string archive,string password,CancellationToken cancel,Action<int> progress=null,int codePage=0){using(var opened=OpenRead(archive,password,cancel,codePage)){var data=opened.Data??ListRaw(opened.Path,password,cancel,progress,codePage);if(opened.Temp!=null){data["type"]="tar."+ArchiveFormats.Normalize(opened.OuterType);data["path"]=Json.Absolute(archive);data["name"]=Path.GetFileName(archive);data["archiveSize"]=new FileInfo(ArchivePath.Native(archive)).Length;}return data;}}
        public J Test(string archive,string password,CancellationToken cancel,Action<int> progress=null,int codePage=0) {
            using(LicenseGate.Enter())return TestCore(archive,password,cancel,progress,codePage);
        }
        J TestCore(string archive,string password,CancellationToken cancel,Action<int> progress,int codePage) {
            using(var opened=OpenRead(archive,password,cancel,codePage)){if(opened.Data==null)ListRaw(opened.Path,password,cancel,null,codePage);Run(new[]{"t","-p"+(password??"")}.Concat(CodePageOptions(codePage)).Concat(new[]{"--",opened.Path}),null,cancel,progress);}return Json.Obj("message","完整性测试通过（格式支持时校验 CRC）");
        }
        public static void VerifyTree(string path,CancellationToken cancel) {
            cancel.ThrowIfCancellationRequested();var attrs=File.GetAttributes(path);
            if((attrs&FileAttributes.ReparsePoint)!=0)throw new ArchiveError("暂不支持符号链接或特殊文件","UNSAFE_PATH");
            if((attrs&FileAttributes.Directory)!=0)foreach(var p in Directory.EnumerateFileSystemEntries(path))VerifyTree(p,cancel);
        }
        static void CopyTree(string source,string destination,CancellationToken cancel) {
            cancel.ThrowIfCancellationRequested();var attributes=File.GetAttributes(source);
            if((attributes&FileAttributes.ReparsePoint)!=0)throw new ArchiveError("暂不支持符号链接或特殊文件","UNSAFE_PATH");
            if((attributes&FileAttributes.Directory)!=0){Directory.CreateDirectory(destination);foreach(var child in Directory.EnumerateFileSystemEntries(source))CopyTree(child,Path.Combine(destination,Path.GetFileName(child)),cancel);}
            else File.Copy(source,destination,false);
        }
        public J Create(J p,CancellationToken cancel,Action<int> progress=null) {
            using(LicenseGate.Enter())return CreateCore(p,cancel,progress);
        }
        J CreateCore(J p,CancellationToken cancel,Action<int> progress) {
            var sources=Json.Strings(p,"sources").Select(Json.Absolute).Distinct(StringComparer.OrdinalIgnoreCase).ToArray();if(sources.Length==0)throw new ArchiveError("请先添加需要压缩的文件");
            var destination=Json.Absolute(Json.Str(p,"destination"));var format=ArchiveFormats.Normalize(Json.Str(p,"format","zip"));long level=Json.Num(p,"level",5);var password=Json.Str(p,"password");var volume=Json.Str(p,"volume");
            if(!ArchiveFormats.CreateFormats.Contains(format)||!new long[]{0,1,3,5,7,9}.Contains(level))throw new ArchiveError("不支持的压缩格式或级别");
            if(!ArchiveFormats.Password(format)&&password!="")throw new ArchiveError("此格式不支持密码加密，请选择 ZIP 或 7Z");
            if(volume!=""&&!ArchiveFormats.Volumes(format))throw new ArchiveError("分卷压缩请选择 ZIP 或 7Z");
            if(ArchiveFormats.SingleFile(format)&&(sources.Length!=1||!File.Exists(sources[0])))throw new ArchiveError("GZ / BZ2 / XZ 只能压缩单个文件；多个文件或文件夹请选择 TAR.GZ / TAR.BZ2 / TAR.XZ");
            if(format=="zip"&&password.Any(c=>c<' '||c>'~'))throw new ArchiveError("ZIP 密码请使用英文字母、数字或符号；中文密码请选择 7Z 格式");
            if(volume!=""&&!Regex.IsMatch(volume,@"^[1-9]\d{0,6}[mk]$",RegexOptions.IgnoreCase))throw new ArchiveError("分卷大小格式不正确");
            if(sources.Select(Path.GetFileName).Distinct(StringComparer.OrdinalIgnoreCase).Count()!=sources.Length)throw new ArchiveError("来源中存在同名文件，请分别压缩");
            foreach(var source in sources){VerifyTree(source,cancel);if(String.Equals(source,destination,StringComparison.OrdinalIgnoreCase)||Json.Within(source,destination))throw new ArchiveError("输出压缩包不能放在待压缩文件夹内");}
            var parent=Path.GetDirectoryName(destination);Directory.CreateDirectory(parent);
            using(var staging=new TempFolder(parent,".nzip-create-")) {
                var temp=Path.Combine(staging.Path,Path.GetFileName(destination));var cwd=Path.GetDirectoryName(sources[0]);
                while(!sources.All(s=>Json.Within(cwd,s))){var dir=Directory.GetParent(cwd);if(dir==null)throw new ArchiveError("不同磁盘的文件请分别压缩");cwd=dir.FullName;}
                long threads=Json.Num(p,"threads");if(threads<0||threads>256)throw new ArchiveError("线程数应为 0（自动）到 256");
                bool compound=format.StartsWith("tar.");string inner=null;if(compound){var work=Path.Combine(staging.Path,"work");Directory.CreateDirectory(work);inner=Path.Combine(work,"payload.tar");var tarArgs=new List<string>{"a","-ttar","-y","-snl"};if(Json.Bool(p,"sharedFiles"))tarArgs.Add("-ssw");tarArgs.AddRange(new[]{"--",inner});tarArgs.AddRange(sources.Select(s=>s.Substring(cwd.TrimEnd('\\').Length+1)));Run(tarArgs,cwd,cancel,n=>{if(progress!=null)progress(n/2);});}
                var args=new List<string>{"a","-t"+ArchiveFormats.EngineType(compound?format.Substring(4):format),"-mx="+level,"-mmt="+(threads==0?"on":threads.ToString()),"-y","-snl"};if(Json.Bool(p,"sharedFiles"))args.Add("-ssw");
                if(password!=""){args.Add("-p"+password);if(format=="zip")args.Add("-mem=AES256");if(format=="7z"&&Json.Bool(p,"encryptHeaders",true))args.Add("-mhe=on");}
                if(volume!="")args.Add("-v"+volume);args.Add("--");args.Add(temp);if(compound)args.Add(inner);else args.AddRange(sources.Select(s=>s.Substring(cwd.TrimEnd('\\').Length+1)));
                Run(args,cwd,cancel,compound?(Action<int>)(n=>{if(progress!=null)progress(50+n/2);}):progress);cancel.ThrowIfCancellationRequested();var outputs=Directory.GetFiles(staging.Path).OrderBy(s=>s).ToArray();if(outputs.Length==0)throw new ArchiveError("未生成压缩文件");var committed=new List<string>();
                try{foreach(var source in outputs){cancel.ThrowIfCancellationRequested();var target=Path.Combine(parent,Path.GetFileName(source));if(CreateHardLink(target,source,IntPtr.Zero)){committed.Add(target);continue;}if(File.Exists(target)||Directory.Exists(target))throw new ArchiveError("同名压缩包或分卷已存在，请更换名称");using(var output=new FileStream(ArchivePath.Native(target),FileMode.CreateNew,FileAccess.Write,FileShare.None)){committed.Add(target);using(var input=File.OpenRead(source)){var buffer=new byte[65536];int n;while((n=input.Read(buffer,0,buffer.Length))>0){cancel.ThrowIfCancellationRequested();output.Write(buffer,0,n);}}output.Flush(true);}}}
                catch{foreach(var f in committed)File.Delete(f);throw;}
                return Json.Obj("path",committed[0],"outputs",committed,"message",committed.Count>1?"压缩完成，共 "+committed.Count+" 个分卷":"压缩完成");
            }
        }
        static void ValidateSelected(string[] selected,J data){var valid=new HashSet<string>(Json.Array(Json.Get(data,"entries")).Select(e=>Json.Str(Json.Map(e),"path")));foreach(var s in selected){SafeEntry(s);if(!valid.Contains(s))throw new ArchiveError("所选文件已不在压缩包中");}}
        public J Extract(J p,CancellationToken cancel,Action<int> progress=null) {
            using(LicenseGate.Enter())return ExtractCore(p,cancel,progress);
        }
        J ExtractCore(J p,CancellationToken cancel,Action<int> progress) {
            var archive=Json.Absolute(Json.Str(p,"archive"));var destination=Json.Absolute(Json.Str(p,"destination"));var password=Json.Str(p,"password");var selected=Json.Strings(p,"selected");int codePage=(int)Json.Num(p,"codePage");using(var opened=OpenRead(archive,password,cancel,codePage)){var data=opened.Data??ListRaw(opened.Path,password,cancel,null,codePage);
            string existing=Json.Str(p,"existing","reject");if(!new[]{"reject","overwrite","skip","rename","newer"}.Contains(existing))throw new ArchiveError("未知的同名文件处理方式");CheckOutputPath(destination);ValidateSelected(selected,data);if(File.Exists(destination)||(Directory.Exists(destination)&&existing=="reject"))throw new ArchiveError("目标文件夹已存在，请选择新的文件夹名称","DEST_EXISTS");
            var outputEntries=Json.Array(Json.Get(data,"entries")).Select(Json.Map).Where(e=>selected.Length==0||selected.Any(s=>Json.Str(e,"path")==s||Json.Str(e,"path").StartsWith(s.TrimEnd('/')+"/",StringComparison.Ordinal))).ToArray();
            if(!AllowLongPaths&&outputEntries.Any(e=>Path.Combine(destination,Json.Str(e,"path")).Length>259))throw new ArchiveError("目标包含长路径，请在设置中启用长路径处理");
            if(Json.Bool(p,"checkSpace",true)){var drive=new DriveInfo(Path.GetPathRoot(destination));if(drive.IsReady&&outputEntries.Sum(e=>Json.Num(e,"size"))>drive.AvailableFreeSpace)throw new ArchiveError("磁盘空间不足，未开始解压");}
            using(var staging=new TempFolder(Path.GetDirectoryName(destination)??destination,".nzip-extract-")) {
                if(Json.Bool(p,"preallocate"))foreach(var entry in outputEntries.Where(e=>!Json.Bool(e,"isDirectory"))){cancel.ThrowIfCancellationRequested();var path=Path.GetFullPath(Path.Combine(staging.Path,Json.Str(entry,"path")));if(!Json.Within(staging.Path,path))throw new ArchiveError("输出路径无效","UNSAFE_PATH");Directory.CreateDirectory(Path.GetDirectoryName(path));using(var output=new FileStream(ArchivePath.Native(path),FileMode.CreateNew,FileAccess.Write,FileShare.None))output.SetLength(Json.Num(entry,"size"));}
                var args=new List<string>{"x","-y","-spd","-p"+password,"-o"+staging.Path};args.AddRange(CodePageOptions(codePage));args.AddRange(new[]{"--",opened.Path});args.AddRange(selected);Run(args,null,cancel,progress);VerifyTree(staging.Path,cancel);cancel.ThrowIfCancellationRequested();
                return CommitExtraction(staging.Path,destination,existing,cancel);
            }
        }}
        public J Modify(J p,CancellationToken cancel,Action<int> progress=null) {
            using(LicenseGate.Enter())return ModifyCore(p,cancel,progress);
        }
        J ModifyCore(J p,CancellationToken cancel,Action<int> progress) {
            if(Json.Num(p,"codePage")!=0)throw new ArchiveError("非默认代码页下请先解压，再重新打包修改");
            var archive=Json.Absolute(Json.Str(p,"archive"));var password=Json.Str(p,"password");var action=Json.Str(p,"action");var data=List(archive,password,cancel);var selected=Json.Strings(p,"selected");var sources=Json.Strings(p,"sources").Select(Json.Absolute).ToArray();
            if(!new[]{"zip","7z"}.Contains(Json.Str(data,"type").ToLowerInvariant()))throw new ArchiveError("仅支持修改 ZIP 和 7Z 压缩包");
            if(Json.Bool(data,"encrypted"))throw new ArchiveError("加密压缩包请解压后重新创建，以确保加密设置一致");
            ValidateSelected(selected,data);if(!new[]{"add","delete","rename"}.Contains(action)||(action=="add"&&sources.Length==0)||(action=="delete"&&selected.Length==0))throw new ArchiveError("请先选择文件");
            string oldName=null,newPath=null;string[] renamedPaths=null;
            if(action=="rename"){
                oldName=SafeEntry(Json.Str(p,"oldName")).TrimEnd('/');var newName=Json.Str(p,"newName");
                if(String.IsNullOrWhiteSpace(newName)||newName.Contains('/')||newName.Contains('\\'))throw new ArchiveError("新名称不能包含目录分隔符");
                int slash=oldName.LastIndexOf('/');newPath=SafeEntry((slash<0?"":oldName.Substring(0,slash+1))+newName);
                var paths=Json.Array(Json.Get(data,"entries")).Select(e=>Json.Str(Json.Map(e),"path")).ToArray();
                if(!paths.Any(s=>s.TrimEnd('/')==oldName||s.StartsWith(oldName+"/",StringComparison.Ordinal)))throw new ArchiveError("所选文件已不在压缩包中");
                if(paths.Any(s=>!(s.TrimEnd('/')==oldName||s.StartsWith(oldName+"/",StringComparison.Ordinal))&&(String.Equals(s.TrimEnd('/'),newPath,StringComparison.OrdinalIgnoreCase)||s.StartsWith(newPath+"/",StringComparison.OrdinalIgnoreCase))))throw new ArchiveError("压缩包中已存在同名项目");
                renamedPaths=paths.Select(s=>s.TrimEnd('/')==oldName||s.StartsWith(oldName+"/",StringComparison.Ordinal)?newPath+s.Substring(oldName.Length):s).ToArray();
                if(renamedPaths.Select(s=>s.TrimEnd('/')).Distinct(StringComparer.OrdinalIgnoreCase).Count()!=renamedPaths.Length)throw new ArchiveError("新名称与已有文件冲突");
            }
            var before=new FileInfo(ArchivePath.Native(archive));long length=before.Length;var modified=before.LastWriteTimeUtc;
            using(var staging=new TempFolder(Path.GetDirectoryName(archive),".nzip-edit-")) {
                var temp=Path.Combine(staging.Path,Path.GetFileName(archive));File.Copy(archive,temp);
                if(action=="delete")Run(new[]{"d","-y","-spd","--",temp}.Concat(selected),null,cancel,progress);
                else if(action=="rename"){Run(new[]{"rn","-y","-spd","--",temp,oldName,newPath},null,cancel,progress);var actual=Json.Array(Json.Get(List(temp,password,cancel),"entries")).Select(e=>Json.Str(Json.Map(e),"path")).OrderBy(s=>s,StringComparer.Ordinal).ToArray();if(!actual.SequenceEqual(renamedPaths.OrderBy(s=>s,StringComparer.Ordinal)))throw new ArchiveError("引擎未完整更名，原压缩包未改变");}
                else{
                    var folder=Json.Str(p,"folder");if(folder!="")folder=SafeEntry(folder).TrimEnd('/')+"/";
                    var existing=Json.Array(Json.Get(data,"entries")).Select(e=>Json.Str(Json.Map(e),"path")).ToArray();
                    if(folder!=""&&!existing.Any(e=>e.TrimEnd('/')==folder.TrimEnd('/')||e.StartsWith(folder,StringComparison.Ordinal)))throw new ArchiveError("目标目录已不在压缩包中");
                    if(sources.Select(Path.GetFileName).Distinct(StringComparer.OrdinalIgnoreCase).Count()!=sources.Length)throw new ArchiveError("来源中存在同名文件");
                    foreach(var s in sources){VerifyTree(s,cancel);var name=folder+Path.GetFileName(s);if(existing.Any(e=>String.Equals(e.TrimEnd('/'),name,StringComparison.OrdinalIgnoreCase)||e.StartsWith(name+"/",StringComparison.OrdinalIgnoreCase)))throw new ArchiveError("压缩包中存在同名文件，请先删除或重命名来源");}
                    var cwd=Path.Combine(staging.Path,"input");Directory.CreateDirectory(Path.Combine(cwd,folder));foreach(var s in sources)CopyTree(s,Path.Combine(cwd,folder,Path.GetFileName(s)),cancel);
                    Run(new[]{"a","-y","-snl","--",temp}.Concat(sources.Select(s=>folder+Path.GetFileName(s))),cwd,cancel,progress);
                }
                Test(temp,password,cancel);cancel.ThrowIfCancellationRequested();var after=new FileInfo(ArchivePath.Native(archive));if(after.Length!=length||after.LastWriteTimeUtc!=modified)throw new ArchiveError("压缩包已被其他程序修改，请重新打开后重试");File.Replace(temp,archive,null);return Json.Obj("path",archive,"message",action=="delete"?"所选文件已从压缩包中删除":action=="rename"?"重命名完成":"文件已添加到压缩包");
            }
        }
    }
}
