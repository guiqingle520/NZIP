using System;
using System.Collections.Generic;
using System.IO;
using System.Linq;
using System.Threading;
using File=NZIP.ArchiveFile;
using Directory=NZIP.ArchiveDirectory;

namespace NZIP {
    using J=Dictionary<string,object>;
    public sealed partial class ArchiveEngine {
        sealed class MergeChange {public string Target,Backup;public bool Installed;}
        internal static void CheckOutputPath(string path){
            string current=Path.GetFullPath(path);
            while(!String.IsNullOrEmpty(current)){
                if((File.Exists(current)||Directory.Exists(current))&&(File.GetAttributes(current)&FileAttributes.ReparsePoint)!=0)throw new ArchiveError("目标路径不能包含链接或重解析点","UNSAFE_PATH");
                string parent=Path.GetDirectoryName(current);if(parent==current)break;current=parent;
            }
        }
        static J CommitExtraction(string source,string destination,string policy,CancellationToken cancel){
            CheckOutputPath(destination);cancel.ThrowIfCancellationRequested();
            if(File.Exists(destination))throw new ArchiveError("目标位置是文件，不能合并目录","DEST_EXISTS");
            if(!Directory.Exists(destination)){Directory.Move(source,destination);return Json.Obj("path",destination,"message","解压完成");}
            if(policy=="reject")throw new ArchiveError("目标文件夹已存在，请选择新的文件夹名称","DEST_EXISTS");
            var changes=new List<MergeChange>();var created=new List<string>();var backup=new TempFolder(Path.GetDirectoryName(destination)??destination,".nzip-merge-backup-");bool keepBackup=false;int skipped=0,renamed=0;
            try{
                Action<string> ensure=null;ensure=path=>{CheckOutputPath(path);if(Directory.Exists(path))return;if(File.Exists(path))throw new ArchiveError("文件与文件夹名称冲突："+path,"DEST_CONFLICT");var parent=Path.GetDirectoryName(path);if(parent!=path&&!Directory.Exists(parent))ensure(parent);Directory.CreateDirectory(path);created.Add(path);};
                foreach(var path in Directory.GetDirectories(source).OrderBy(p=>p,StringComparer.OrdinalIgnoreCase))MergeDirectoryTree(path,source,destination,ensure,cancel);
                foreach(var input in Directory.GetFiles(source,"*",SearchOption.AllDirectories)){
                    cancel.ThrowIfCancellationRequested();string relative=input.Substring(source.TrimEnd('\\').Length+1),target=Path.Combine(destination,relative);if(!Json.Within(destination,target))throw new ArchiveError("输出路径无效","UNSAFE_PATH");CheckOutputPath(target);ensure(Path.GetDirectoryName(target));
                    if(Directory.Exists(target))throw new ArchiveError("文件与文件夹名称冲突："+target,"DEST_CONFLICT");
                    if(File.Exists(target)){
                        if(policy=="skip"||(policy=="newer"&&new FileInfo(ArchivePath.Native(target)).LastWriteTimeUtc>=new FileInfo(ArchivePath.Native(input)).LastWriteTimeUtc)){skipped++;continue;}
                        if(policy=="rename"){string parent=Path.GetDirectoryName(target),stem=Path.GetFileNameWithoutExtension(target),extension=Path.GetExtension(target);int suffix=2;do{target=Path.Combine(parent,stem+" ("+(suffix++)+")"+extension);}while(File.Exists(target)||Directory.Exists(target));renamed++;}
                    }
                    var change=new MergeChange{Target=target};changes.Add(change);
                    if(File.Exists(target)){change.Backup=Path.Combine(backup.Path,relative);Directory.CreateDirectory(Path.GetDirectoryName(change.Backup));File.Move(target,change.Backup);}
                    File.Move(input,target);change.Installed=true;
                }
                cancel.ThrowIfCancellationRequested();return Json.Obj("path",destination,"skipped",skipped,"renamed",renamed,"written",changes.Count,"message","解压完成");
            }catch(Exception failure){
                try{foreach(var change in changes.AsEnumerable().Reverse()){CheckOutputPath(change.Target);if(change.Installed&&File.Exists(change.Target))File.Delete(change.Target);if(change.Backup!=null&&File.Exists(change.Backup))File.Move(change.Backup,change.Target);}foreach(var path in created.AsEnumerable().Reverse())if(Directory.Exists(path)&&!Directory.EnumerateFileSystemEntries(path).Any())Directory.Delete(path,false);}
                catch(Exception rollback){keepBackup=true;throw new ArchiveError("合并失败，部分文件恢复失败。请保留恢复目录："+backup.Path+"；"+rollback.Message+"；原错误："+failure.Message,"ROLLBACK_FAILED");}
                throw;
            }finally{if(!keepBackup)backup.Dispose();}
        }
        static void MergeDirectoryTree(string path,string source,string destination,Action<string> ensure,CancellationToken cancel){cancel.ThrowIfCancellationRequested();ensure(Path.Combine(destination,path.Substring(source.TrimEnd('\\').Length+1)));foreach(var child in Directory.GetDirectories(path))MergeDirectoryTree(child,source,destination,ensure,cancel);}
    }
}
