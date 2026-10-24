using System;
using System.Collections.Generic;
using System.IO;
using System.Linq;
using System.Text;
using System.Text.RegularExpressions;
using System.Threading;

namespace NZIP {
    using J=Dictionary<string,object>;
    public sealed partial class ArchiveEngine {
        sealed class ListingLines {
            readonly TextReader reader;readonly CancellationToken cancel;readonly char[] buffer=new char[8192];readonly StringBuilder line=new StringBuilder();
            int offset,count,total;
            public ListingLines(TextReader reader,CancellationToken cancel){this.reader=reader;this.cancel=cancel;}
            public string ReadLine(){
                line.Clear();bool any=false;
                while(true){
                    if(offset==count){cancel.ThrowIfCancellationRequested();count=reader.Read(buffer,0,buffer.Length);offset=0;if(count==0)return any?line.ToString():null;total+=count;if(total>64*1024*1024)throw new ArchiveError("压缩包文件列表过大，无法安全加载","LISTING_LIMIT");}
                    char c=buffer[offset++];any=true;if(c=='\n'){if(line.Length>0&&line[line.Length-1]=='\r')line.Length--;return line.ToString();}line.Append(c);
                    if(line.Length>128*1024)throw new ArchiveError("压缩包目录信息的单行过长，无法安全加载","LISTING_LIMIT");
                }
            }
        }
        static J ReadListing(TextReader reader,string archivePath,CancellationToken cancel){
            var lines=new ListingLines(reader,cancel);string line,type="";bool started=false;
            while((line=lines.ReadLine())!=null){if(line.StartsWith("Type = ",StringComparison.Ordinal))type=line.Substring(7).Trim();if(line.Length>=10&&line.All(c=>c=='-')){started=true;break;}}
            if(!started)throw new ArchiveError("无法读取压缩包文件列表");
            var entries=new List<object>();var seen=new HashSet<string>(StringComparer.OrdinalIgnoreCase);var values=new Dictionary<string,string>();var fields=new J();long total=0;bool encrypted=false,known=true;
            Action append=()=>{
                if(fields.Count==0)return;cancel.ThrowIfCancellationRequested();
                string rawName=Json.Str(fields,"Path");if(rawName==""&&archivePath!=null&&new[]{"gzip","bzip2","xz","zstd","lzma","lzma86","z"}.Contains(type.ToLowerInvariant()))rawName=Path.GetFileNameWithoutExtension(archivePath);
                string name=SafeEntry(rawName),attrs=Json.Str(fields,"Attributes");
                if(Json.Str(fields,"Symbolic Link")!=""||Json.Str(fields,"Hard Link")!=""||Regex.IsMatch(attrs,@"reparse|(?:^|[ _])l[rwxstST-]{9}",RegexOptions.IgnoreCase))throw new ArchiveError("为保护本地文件，暂不支持含链接的压缩包","UNSAFE_PATH");
                string clean=name.TrimEnd('/');if(!seen.Add(clean))throw new ArchiveError("压缩包包含重复或大小写冲突的路径","UNSAFE_PATH");
                if(!AllowLongPaths&&name.Length>240)throw new ArchiveError("长路径处理已关闭，请在设置中启用");
                bool directory=Json.Str(fields,"Folder")=="+"||attrs.StartsWith("D"),enc=Json.Str(fields,"Encrypted")=="+",sizeKnown=Json.Str(fields,"Size")!="";
                long size=Json.Num(fields,"Size");total=checked(total+size);encrypted|=enc;if(!directory&&!sizeKnown)known=false;
                string method=Json.Str(fields,"Method");
                entries.Add(Json.Obj("path",name,"name",clean.Substring(clean.LastIndexOf('/')+1),"isDirectory",directory,"size",size,"sizeKnown",sizeKnown,"packed",Json.Num(fields,"Packed Size"),"packedKnown",Json.Str(fields,"Packed Size")!="","modified",Json.Str(fields,"Modified"),"encrypted",enc,"crc",Json.Str(fields,"CRC"),"method",method,"attributes",attrs,"comment",Json.Str(fields,"Comment"),"extra",Json.Str(fields,"Host OS"),"encryption",enc?(method.Contains("AES")?"AES":"已加密"):""));fields.Clear();
            };
            while((line=lines.ReadLine())!=null){
                if(line.Length==0){append();continue;}int equals=line.IndexOf(" = ",StringComparison.Ordinal);if(equals<0)continue;
                string key=line.Substring(0,equals),value=line.Substring(equals+3);
                if(key=="Modified"||key=="Method"||key=="Attributes"||key=="Host OS"){
                    string shared;if(values.TryGetValue(value,out shared))value=shared;else if(values.Count<256&&value.Length<=128)values.Add(value,value);
                }
                fields[key]=value;
            }
            append();return Json.Obj("type",type,"entries",entries,"totalSize",total,"totalSizeKnown",known,"encrypted",encrypted);
        }
    }
}
