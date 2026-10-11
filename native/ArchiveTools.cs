using System;
using System.Collections.Generic;
using System.IO;
using System.IO.Compression;
using System.Linq;
using System.Text;
using System.Threading;

namespace NZIP {
    using J=Dictionary<string,object>;
    public static class ArchiveTools {
        static readonly uint[] CrcTable=MakeTable();
        static uint[] MakeTable(){var t=new uint[256];for(uint i=0;i<256;i++){uint c=i;for(int n=0;n<8;n++)c=(c&1)!=0?0xedb88320^(c>>1):c>>1;t[i]=c;}return t;}
        static uint Crc(byte[] bytes){uint c=0xffffffff;foreach(byte b in bytes)c=CrcTable[(c^b)&255]^(c>>8);return c^0xffffffff;}
        static Encoding NameEncoding(int flags,int page){return (flags&2048)!=0?new UTF8Encoding(false,true):Encoding.GetEncoding(page==0?Encoding.Default.CodePage:page,EncoderFallback.ExceptionFallback,DecoderFallback.ExceptionFallback);}
        static string UnicodeExtra(byte[] raw,byte[] extra,int field){for(int i=0;i+4<=extra.Length;){int id=BitConverter.ToUInt16(extra,i),length=BitConverter.ToUInt16(extra,i+2);i+=4;if(i+length>extra.Length)break;if(id==field&&length>=5&&extra[i]==1&&BitConverter.ToUInt32(extra,i+1)==Crc(raw))return new UTF8Encoding(false,true).GetString(extra,i+5,length-5);i+=length;}return null;}
        static string EntryName(byte[] raw,byte[] extra,int flags,int page){return UnicodeExtra(raw,extra,0x7075)??NameEncoding(flags,page).GetString(raw);}
        static long EndRecord(FileStream stream){
            int count=(int)Math.Min(stream.Length,65557);var tail=new byte[count];stream.Position=stream.Length-count;if(stream.Read(tail,0,count)!=count)throw new ArchiveError("ZIP 尾部读取失败");
            for(int i=count-22;i>=0;i--)if(BitConverter.ToUInt32(tail,i)==0x06054b50&&i+22+BitConverter.ToUInt16(tail,i+20)==count)return stream.Length-count+i;
            throw new ArchiveError("未找到完整 ZIP 中央目录，请使用修复工具");
        }
        public static string Comment(string path,int page){using(var stream=File.OpenRead(path)){long end=EndRecord(stream);stream.Position=end+20;var reader=new BinaryReader(stream);int n=reader.ReadUInt16();var bytes=reader.ReadBytes(n);try{return new UTF8Encoding(false,true).GetString(bytes);}catch(DecoderFallbackException){return NameEncoding(0,page).GetString(bytes);}}}
        public static J WriteComment(ArchiveEngine engine,J p,CancellationToken token){
            using(LicenseGate.Enter())return WriteCommentCore(engine,p,token);
        }
        static J WriteCommentCore(ArchiveEngine engine,J p,CancellationToken token){
            var archive=Json.Absolute(Json.Str(p,"archive"));if(!Path.GetExtension(archive).Equals(".zip",StringComparison.OrdinalIgnoreCase))throw new ArchiveError("注释编辑目前支持 ZIP");
            var bytes=Encoding.UTF8.GetBytes(Json.Str(p,"comment"));if(bytes.Length>65535)throw new ArchiveError("ZIP 注释最多 65535 字节");
            using(var stage=new TempFolder(Path.GetDirectoryName(archive),".nzip-comment-")){
                var temp=Path.Combine(stage.Path,"comment.zip");var before=new FileInfo(archive);long length=before.Length;var modified=before.LastWriteTimeUtc;
                using(var input=File.OpenRead(archive))using(var output=File.Create(temp)){
                    long end=EndRecord(input);input.Position=0;Copy(input,output,end+20,token);using(var writer=new BinaryWriter(output,Encoding.UTF8,true)){writer.Write((ushort)bytes.Length);writer.Write(bytes);}
                }
                engine.Test(temp,Json.Str(p,"password"),token,null,(int)Json.Num(p,"codePage"));token.ThrowIfCancellationRequested();var now=new FileInfo(archive);if(now.Length!=length||now.LastWriteTimeUtc!=modified)throw new ArchiveError("压缩包已改变，请重新打开");File.Replace(temp,archive,null);
                return Json.Obj("path",archive,"message","ZIP 注释已保存（UTF-8）");
            }
        }
        static void Copy(Stream input,Stream output,long count,CancellationToken token){var buffer=new byte[65536];while(count>0){token.ThrowIfCancellationRequested();int n=input.Read(buffer,0,(int)Math.Min(buffer.Length,count));if(n==0)throw new EndOfStreamException();output.Write(buffer,0,n);count-=n;}}
        public static J ZipMetadata(string path,int page){
            var result=new J();using(var stream=File.OpenRead(path)){
                long end=EndRecord(stream);var r=new BinaryReader(stream);stream.Position=end+4;ushort disk=r.ReadUInt16(),centralDisk=r.ReadUInt16();r.ReadUInt16();ushort count=r.ReadUInt16();uint size=r.ReadUInt32(),offset=r.ReadUInt32();
                if(disk!=0||centralDisk!=0||count==65535||offset==uint.MaxValue||size==uint.MaxValue)throw new ArchiveError("ZIP64 或分卷的附加注释字段暂不可用");
                if((long)offset+size>end)throw new ArchiveError("ZIP 中央目录损坏");stream.Position=offset;
                for(int i=0;i<count;i++){
                    if(stream.Position+46>end||r.ReadUInt32()!=0x02014b50)throw new ArchiveError("ZIP 中央目录损坏");
                    r.ReadUInt16();r.ReadUInt16();ushort flags=r.ReadUInt16(),method=r.ReadUInt16();stream.Position+=16;int names=r.ReadUInt16(),extras=r.ReadUInt16(),comments=r.ReadUInt16();stream.Position+=12;
                    if(stream.Position+names+extras+comments>end)throw new ArchiveError("ZIP 字段超出目录边界");var raw=r.ReadBytes(names);var extra=r.ReadBytes(extras);var comment=r.ReadBytes(comments);
                    try{var encoding=NameEncoding(flags,page);var name=EntryName(raw,extra,flags,page).Replace('\\','/').TrimEnd('/');result[name]=Json.Obj("comment",UnicodeExtra(comment,extra,0x6375)??encoding.GetString(comment),"method",method==0?"Store":method==8?"Deflate":method==99?"AES":method.ToString(),"encryption",(flags&1)!=0?(method==99?"AES":"ZipCrypto"):"");}catch(DecoderFallbackException){}
                }
            }return result;
        }
        public static J DetectCodePage(string path){
            var names=new List<byte[]>();using(var stream=File.OpenRead(path))using(var r=new BinaryReader(stream)){
                long end=EndRecord(stream);stream.Position=end+16;uint offset=r.ReadUInt32();if(offset==uint.MaxValue)throw new ArchiveError("ZIP64 自动编码检测暂不支持，请手动选择代码页");stream.Position=offset;
                for(int i=0;i<64&&stream.Position+46<=end;i++){
                    if(r.ReadUInt32()!=0x02014b50)break;stream.Position+=4;ushort flags=r.ReadUInt16();stream.Position+=18;int n=r.ReadUInt16(),x=r.ReadUInt16(),c=r.ReadUInt16();stream.Position+=12;if(stream.Position+n+x+c>end)break;
                    var raw=r.ReadBytes(n);var extra=r.ReadBytes(x);stream.Position+=c;if((flags&2048)!=0)return Json.Obj("codePage",65001,"message","ZIP 已标记 UTF-8");if(UnicodeExtra(raw,extra,0x7075)!=null)return Json.Obj("codePage",0,"message","ZIP 包含校验有效的 Unicode 路径字段，使用默认编码即可正确显示");if(raw.Any(b=>b>=128))names.Add(raw);
                }
            }
            if(names.Count==0)return Json.Obj("codePage",0,"message","文件名均为 ASCII，使用默认编码");
            var scores=new List<J>();foreach(int page in new[]{65001,936,950,932,949,1252,1250,1251,1254,1253,1256,1255,1257,874}){
                try{var enc=NameEncoding(0,page);int score=0;foreach(var name in names){string text=enc.GetString(name);if(!enc.GetBytes(text).SequenceEqual(name)){score-=100;continue;}if(page==65001)score+=20;if(page==Encoding.Default.CodePage)score+=3;foreach(char ch in text){if(Char.IsControl(ch))score-=30;else if(ch>=0x3040&&ch<=0x30ff)score+=8;else if(ch>=0x4e00&&ch<=0x9fff)score+=4;else if(ch>=0xac00&&ch<=0xd7af)score+=5;else if(ch>=128)score++;}}scores.Add(Json.Obj("page",page,"score",score));}catch(DecoderFallbackException){}catch(EncoderFallbackException){}
            }
            var best=scores.OrderByDescending(s=>Json.Num(s,"score")).FirstOrDefault();if(best==null)throw new ArchiveError("无法检测编码，请手动选择");return Json.Obj("codePage",Json.Num(best,"page"),"message","启发式检测结果；旧 ZIP 编码没有唯一标识，若仍乱码请手动选择。","candidates",scores);
        }
        public static J Repair(ArchiveEngine engine,J p,CancellationToken token,Action<int> progress=null){
            using(LicenseGate.Enter())return RepairCore(engine,p,token,progress);
        }
        static J RepairCore(ArchiveEngine engine,J p,CancellationToken token,Action<int> progress){
            string archive=Json.Absolute(Json.Str(p,"archive")),destination=Json.Absolute(Json.Str(p,"destination"));if(String.Equals(archive,destination,StringComparison.OrdinalIgnoreCase)||File.Exists(destination)||Directory.Exists(destination))throw new ArchiveError("修复结果必须保存到新的 ZIP 文件，原文件保留");
            if(new FileInfo(archive).Length>2L*1024*1024*1024)throw new ArchiveError("当前修复器支持 2 GB 以内的普通 ZIP");
            int recovered=0,skipped=0;long expanded=0;var seen=new HashSet<string>(StringComparer.OrdinalIgnoreCase);
            using(var stage=new TempFolder(Path.GetDirectoryName(destination),".nzip-repair-")){
                var output=Path.Combine(stage.Path,"recovered.zip");using(var input=File.OpenRead(archive))using(var reader=new BinaryReader(input))using(var zip=new ZipArchive(File.Create(output),ZipArchiveMode.Create)){
                    while(input.Position+30<=input.Length){
                        token.ThrowIfCancellationRequested();long start=input.Position;if(reader.ReadUInt32()!=0x04034b50){input.Position=start+1;continue;}
                        ushort version=reader.ReadUInt16(),flags=reader.ReadUInt16(),method=reader.ReadUInt16();reader.ReadUInt32();uint expected=reader.ReadUInt32(),packed=reader.ReadUInt32(),size=reader.ReadUInt32();int n=reader.ReadUInt16(),extra=reader.ReadUInt16();
                        if(n==0||input.Position+n+extra>input.Length){skipped++;input.Position=start+1;continue;}byte[] raw=reader.ReadBytes(n),extraBytes=reader.ReadBytes(extra);long dataStart=input.Position;
                        if((flags&1)!=0||version>20||(method!=0&&method!=8)||packed==uint.MaxValue||size>64*1024*1024){skipped++;input.Position=start+1;continue;}
                        if((flags&8)!=0&&packed==0){
                            // Signed descriptors carry the missing sizes. Verify candidate
                            // CRC below rather than trusting signatures inside compressed data.
                            bool found=false;long bound=Math.Min(input.Length-16,dataStart+128*1024*1024);
                            for(long pos=dataStart;pos<=bound;pos++){if((pos&65535)==0)token.ThrowIfCancellationRequested();input.Position=pos;if(reader.ReadUInt32()!=0x08074b50)continue;uint crc=reader.ReadUInt32(),cp=reader.ReadUInt32(),sz=reader.ReadUInt32();if(cp==pos-dataStart&&sz<=64*1024*1024){expected=crc;packed=cp;size=sz;found=true;break;}}
                            if(!found){skipped++;input.Position=start+1;continue;}
                        }
                        if(packed>128*1024*1024||dataStart+packed>input.Length){skipped++;input.Position=start+1;continue;}input.Position=dataStart;var bytes=reader.ReadBytes((int)packed);long next=dataStart+packed;
                        try{
                            string name=ArchiveEngine.SafeEntry(EntryName(raw,extraBytes,flags,(int)Json.Num(p,"codePage")));if(seen.Contains(name.TrimEnd('/')))throw new InvalidDataException();byte[] content;
                            using(var compressed=new MemoryStream(bytes))using(var plain=new MemoryStream()){
                                Stream decoded=method==0?(Stream)compressed:new DeflateStream(compressed,CompressionMode.Decompress,true);
                                try{var buffer=new byte[65536];int read;while((read=decoded.Read(buffer,0,buffer.Length))>0){token.ThrowIfCancellationRequested();if(plain.Length+read>64*1024*1024)throw new InvalidDataException();plain.Write(buffer,0,read);}content=plain.ToArray();}finally{if(decoded!=compressed)decoded.Dispose();}
                            }
                            if(content.Length!=size||Crc(content)!=expected)throw new InvalidDataException();expanded+=content.Length;if(expanded>512L*1024*1024||recovered>=10000)throw new ArchiveError("修复达到 512 MB / 10,000 项上限，原文件保留");
                            var entry=zip.CreateEntry(name,CompressionLevel.Optimal);using(var target=entry.Open())target.Write(content,0,content.Length);seen.Add(name.TrimEnd('/'));recovered++;
                        }catch(InvalidDataException){skipped++;}catch(DecoderFallbackException){skipped++;}catch(ArchiveError error){if(error.Code=="UNSAFE_PATH")skipped++;else throw;}
                        input.Position=next;if(progress!=null)progress((int)(next*95/Math.Max(1,input.Length)));
                    }
                }
                if(recovered==0)throw new ArchiveError("没有可恢复的完整条目。当前支持 Store/Deflate 普通 ZIP，不支持加密、ZIP64 或分卷修复。");engine.Test(output,"",token);token.ThrowIfCancellationRequested();File.Move(output,destination);
            }
            return Json.Obj("path",destination,"recovered",recovered,"skipped",skipped,"message","修复完成：恢复 "+recovered+" 项，跳过 "+skipped+" 个损坏或不支持的条目；原文件保留");
        }
        public static J RecoverPassword(ArchiveEngine engine,J p,CancellationToken token,Action<int> progress=null){
            using(LicenseGate.Enter())return RecoverPasswordCore(engine,p,token,progress);
        }
        static J RecoverPasswordCore(ArchiveEngine engine,J p,CancellationToken token,Action<int> progress){
            string archive=Json.Absolute(Json.Str(p,"archive"));if(!new[]{".zip",".7z"}.Contains(Path.GetExtension(archive).ToLowerInvariant()))throw new ArchiveError("密码恢复支持 ZIP / 7Z，请仅用于有权访问的文件");
            try{var listed=engine.List(archive,"",token);if(!Json.Bool(listed,"encrypted"))throw new ArchiveError("压缩包未加密，无需恢复密码","NOT_ENCRYPTED");}catch(ArchiveError error){if(error.Code!="PASSWORD_REQUIRED")throw;}
            var candidates=Json.Strings(p,"candidates");var dictionary=Json.Str(p,"dictionary");string chars=Json.Str(p,"characters","0123456789");int min=(int)Json.Num(p,"minLength",1),max=(int)Json.Num(p,"maxLength",4);
            IEnumerable<string> guesses;long count;
            if(dictionary!=""){if(new FileInfo(dictionary).Length>10*1024*1024)throw new ArchiveError("字典上限 10 MB");candidates=File.ReadAllLines(dictionary,Encoding.UTF8).Where(s=>s.Length>0).Distinct().ToArray();if(candidates.Length==0)throw new ArchiveError("字典中没有候选密码");}
            if(candidates.Any(s=>s.Length>1024))throw new ArchiveError("单个候选密码最多 1,024 个字符");
            if(candidates.Length>0){if(candidates.Length>1000000)throw new ArchiveError("最多尝试 1,000,000 个候选密码");guesses=candidates;count=candidates.Length;}
            else{chars=new string(chars.Distinct().ToArray());if(chars.Length==0||chars.Length>128||min<1||max<min||max>12)throw new ArchiveError("字符集或长度范围无效");count=0;for(int length=min;length<=max;length++){double n=Math.Pow(chars.Length,length);if(n>1000000||count+n>1000000)throw new ArchiveError("组合超过 1,000,000 次，请缩小范围或使用字典");count+=(long)n;}guesses=Generate(chars,min,max);}
            long tried=0;var started=System.Diagnostics.Stopwatch.StartNew();foreach(var guess in guesses){token.ThrowIfCancellationRequested();bool found=false;try{engine.Run(new[]{"t","-p"+guess,"--",archive},null,token);found=true;}catch(ArchiveError error){if(error.Code=="ENGINE_MISSING")throw;}
                tried++;if(progress!=null)progress((int)(tried*99/Math.Max(1,count)));if(found)return Json.Obj("password",guess,"attempts",tried,"message","已找到可通过完整性测试的密码（仅保留在当前窗口内存中）");if(started.Elapsed.TotalMinutes>=30)throw new ArchiveError("已达到 30 分钟上限，请缩小范围后重试");}
            throw new ArchiveError("已尝试 "+tried+" 个候选，未找到可通过测试的密码；损坏包也可能无法验证。","PASSWORD_NOT_FOUND");
        }
        static IEnumerable<string> Generate(string chars,int min,int max){for(int length=min;length<=max;length++){long n=(long)Math.Pow(chars.Length,length);for(long i=0;i<n;i++){long v=i;var candidate=new char[length];for(int j=length-1;j>=0;j--){candidate[j]=chars[(int)(v%chars.Length)];v/=chars.Length;}yield return new string(candidate);}}}
    }
}
