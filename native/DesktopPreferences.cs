using System;
using System.Collections.Generic;
using System.IO;
using System.Linq;
using System.Text;

namespace NZIP {
    using J=Dictionary<string,object>;
    public sealed class DesktopPreferences {
        public J Values;readonly string file;
        public static J Defaults(){return Json.Obj("language","zh-CN","autoUpdate",true,"theme","light","customTemp",false,"tempPath",Path.GetTempPath(),"extraTypes",false,"extensions","*.cbr;*.cbz;*.ear","cleanupExit",true,"recycle",true,"rememberHistory",true,"longPaths",true,"allowExternalDelete",false,"preallocate",true,"autoExpand",true,"modalProgress",true,"elegant",true,"startPage",true,"fullTitle",false,"checkSpace",true,"sharedFiles",false,"openAfterExtract",true,"defaultFormat","zip","defaultLevel",5,"threads",0,"encryptHeaders",true,"previewLimit",10,"confirmDelete",true,"textEncoding",65001,"split",68,"view","details","tree",true,"columns",new[]{"packed","size","type","modified"});}
        public DesktopPreferences(string profile,J old){file=Path.Combine(profile,"desktop.json");Values=Defaults();foreach(var k in new[]{"theme","rememberHistory","openAfterExtract","defaultFormat","defaultLevel"})if(old.ContainsKey(k))Values[k]=old[k];try{Merge(Json.Decode(File.ReadAllText(file)));}catch(IOException){}catch(ArgumentException){}catch(ArchiveError){} }
        public bool Bool(string key){return Json.Bool(Values,key);}
        public string Str(string key){return Json.Str(Values,key);}
        public int Int(string key){return (int)Json.Num(Values,key);}
        public void Merge(J incoming){
            var candidate=Json.Decode(Json.Encode(Values));foreach(var pair in incoming){if(!candidate.ContainsKey(pair.Key))continue;var expected=Defaults()[pair.Key];if(expected is bool&&!(pair.Value is bool))throw new ArchiveError("设置字段类型不正确："+pair.Key);if(expected is string&&!(pair.Value is string))throw new ArchiveError("设置字段类型不正确："+pair.Key);candidate[pair.Key]=pair.Value;}
            if(!new[]{"zh-CN","zh-TW","en-US"}.Contains(Json.Str(candidate,"language")))throw new ArchiveError("未知的界面语言");
            if(!new[]{"light","dark","system"}.Contains(Json.Str(candidate,"theme")))throw new ArchiveError("未知主题");
            if(!ArchiveFormats.CreateFormats.Contains(Json.Str(candidate,"defaultFormat"))||!new long[]{0,1,3,5,7,9}.Contains(Json.Num(candidate,"defaultLevel"))||Json.Num(candidate,"threads")<0||Json.Num(candidate,"threads")>256||Json.Num(candidate,"previewLimit")<1||Json.Num(candidate,"previewLimit")>10||Json.Num(candidate,"split")<20||Json.Num(candidate,"split")>80||!new[]{"details","icons"}.Contains(Json.Str(candidate,"view")))throw new ArchiveError("设置值超出允许范围");
            if(Json.Str(candidate,"tempPath").Length>32000||!Path.IsPathRooted(Json.Str(candidate,"tempPath")))throw new ArchiveError("临时目录必须是绝对路径");
            ArchiveEngine.CodePageOptions((int)Json.Num(candidate,"textEncoding"));
            if(Json.Str(candidate,"extensions").Split(';').Any(e=>!System.Text.RegularExpressions.Regex.IsMatch(e,@"^\*\.[a-zA-Z0-9]{1,12}$")))throw new ArchiveError("扩展名请使用 *.cbr;*.cbz;*.ear 形式");
            Values=candidate;
        }
        public void Save(){Directory.CreateDirectory(Path.GetDirectoryName(file));var temp=file+"."+Guid.NewGuid().ToString("N");try{File.WriteAllText(temp,Json.Encode(Values),new UTF8Encoding(false));if(File.Exists(file))File.Replace(temp,file,null);else File.Move(temp,file);}finally{if(File.Exists(temp))File.Delete(temp);}}
        public string TemporaryRoot{get{return Bool("customTemp")?Str("tempPath"):Path.GetTempPath();}}
    }
}
