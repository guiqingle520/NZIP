using System;
using System.Collections.Generic;
using System.IO;
using System.Linq;
using System.Security.Cryptography;
using System.Text.RegularExpressions;
using System.Threading;
using File=NZIP.ArchiveFile;
using Directory=NZIP.ArchiveDirectory;

namespace NZIP {
    using J=Dictionary<string,object>;
    public static class ArchiveEdits {
        public static string Fingerprint(string path,CancellationToken cancel){
            using(var input=File.OpenRead(path))using(var sha=SHA256.Create()){
                var buffer=new byte[65536];int n;while((n=input.Read(buffer,0,buffer.Length))>0){cancel.ThrowIfCancellationRequested();sha.TransformBlock(buffer,0,n,buffer,0);}cancel.ThrowIfCancellationRequested();sha.TransformFinalBlock(new byte[0],0,0);
                return BitConverter.ToString(sha.Hash).Replace("-","").ToLowerInvariant();
            }
        }
        public static J WriteBack(ArchiveEngine engine,J p,CancellationToken cancel,Action<int> progress=null){
            using(LicenseGate.Enter())return WriteBackCore(engine,p,cancel,progress);
        }
        static J WriteBackCore(ArchiveEngine engine,J p,CancellationToken cancel,Action<int> progress){
            cancel.ThrowIfCancellationRequested();string archive=Json.Absolute(Json.Str(p,"archive")),source=Json.Absolute(Json.Str(p,"source")),entry=ArchiveEngine.SafeEntry(Json.Str(p,"entry"));
            string password=Json.Str(p,"password"),expected=Json.Str(p,"originalHash");int page=(int)Json.Num(p,"codePage");
            if(!new[]{".zip",".zipx"}.Contains(Path.GetExtension(archive).ToLowerInvariant()))throw new ArchiveError("编辑回写仅支持 ZIP / ZIPX","EDIT_UNSUPPORTED");
            if(entry.EndsWith("/")||!Regex.IsMatch(expected,"^[a-f0-9]{64}$")||!File.Exists(source)||String.Equals(source,archive,StringComparison.OrdinalIgnoreCase))throw new ArchiveError("编辑回写参数无效");
            var data=engine.List(archive,password,cancel,null,page);if(!Json.Str(data,"type").Equals("zip",StringComparison.OrdinalIgnoreCase))throw new ArchiveError("编辑回写仅支持 ZIP / ZIPX","EDIT_UNSUPPORTED");
            var beforeEntries=Json.Array(Json.Get(data,"entries")).Select(Json.Map).ToArray();var target=beforeEntries.SingleOrDefault(e=>Json.Str(e,"path")==entry);
            if(target==null||Json.Bool(target,"isDirectory"))throw new ArchiveError("原条目已删除或更名，编辑后的文件未写回","EDIT_CONFLICT");
            using(var staging=new TempFolder(Path.GetDirectoryName(archive),".nzip-writeback-")){
                string original=Path.Combine(staging.Path,"original"),archiveHash=Fingerprint(archive,cancel);
                engine.Extract(Json.Obj("archive",archive,"password",password,"codePage",page,"destination",original,"selected",new[]{entry}),cancel);
                string previous=Path.Combine(original,entry.Replace('/',Path.DirectorySeparatorChar));
                if(Fingerprint(previous,cancel)!=expected)throw new ArchiveError("包内原文件已被其他操作修改，编辑后的文件未写回","EDIT_CONFLICT");
                ArchiveEngine.VerifyTree(source,cancel);
                string inputRoot=Path.Combine(staging.Path,"input"),replacement=Path.Combine(inputRoot,entry.Replace('/',Path.DirectorySeparatorChar));Directory.CreateDirectory(Path.GetDirectoryName(replacement));File.Copy(source,replacement);
                string editedHash=Fingerprint(replacement,cancel);if(Fingerprint(source,cancel)!=editedHash)throw new ArchiveError("本地文件仍在修改，请关闭编辑软件后重试","EDIT_CONFLICT");
                string temp=Path.Combine(staging.Path,Path.GetFileName(archive));File.Copy(archive,temp);
                if(Fingerprint(temp,cancel)!=archiveHash)throw new ArchiveError("压缩包正在被其他程序修改，未写回","EDIT_CONFLICT");
                var args=new List<string>{"a","-tzip","-y","-spd","-snl","-up1q1r2x2y2z2w2"};args.AddRange(ArchiveEngine.CodePageOptions(page));
                if(Json.Bool(target,"encrypted")){
                    if(password=="")throw new ArchiveError("写回此文件需要原压缩包密码","PASSWORD_REQUIRED");
                    var aes=Regex.Match(Json.Str(target,"method"),@"AES[- ]?(128|192|256)",RegexOptions.IgnoreCase);
                    args.Add("-p"+password);args.Add("-mem="+(aes.Success?"AES"+aes.Groups[1].Value:"ZipCrypto"));
                }
                args.AddRange(new[]{"--",temp,entry});engine.Run(args,inputRoot,cancel,progress);engine.Test(temp,password,cancel,null,page);
                var afterEntries=Json.Array(Json.Get(engine.List(temp,password,cancel,null,page),"entries")).Select(Json.Map).ToArray();
                if(!beforeEntries.Select(e=>Json.Str(e,"path")).OrderBy(s=>s,StringComparer.Ordinal).SequenceEqual(afterEntries.Select(e=>Json.Str(e,"path")).OrderBy(s=>s,StringComparer.Ordinal)))throw new ArchiveError("写回后的条目结构不一致，原压缩包保留");
                foreach(var old in beforeEntries.Where(e=>Json.Str(e,"path")!=entry)){
                    var next=afterEntries.Single(e=>Json.Str(e,"path")==Json.Str(old,"path"));
                    if(Json.Num(old,"size")!=Json.Num(next,"size")||Json.Str(old,"crc")!=Json.Str(next,"crc")||Json.Bool(old,"encrypted")!=Json.Bool(next,"encrypted"))throw new ArchiveError("其他条目在写回时发生变化，原压缩包保留");
                }
                string verify=Path.Combine(staging.Path,"verify");engine.Extract(Json.Obj("archive",temp,"password",password,"codePage",page,"destination",verify,"selected",new[]{entry}),cancel);
                if(Fingerprint(Path.Combine(verify,entry.Replace('/',Path.DirectorySeparatorChar)),cancel)!=editedHash)throw new ArchiveError("写回内容校验失败，原压缩包保留");
                if(Fingerprint(archive,cancel)!=archiveHash||Fingerprint(source,cancel)!=editedHash)throw new ArchiveError("压缩包或编辑副本在写回期间发生变化，原压缩包保留","EDIT_CONFLICT");
                cancel.ThrowIfCancellationRequested();File.Replace(temp,archive,null);return Json.Obj("path",archive,"entry",entry,"message","编辑后的文件已写回压缩包");
            }
        }
    }
}
