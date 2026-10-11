using System;
using System.Collections;
using System.Collections.Generic;
using System.Globalization;
using System.Linq;
using System.Web.Script.Serialization;
using System.IO;

namespace NZIP {
    using J = Dictionary<string,object>;
    public static class Json {
        public static J Obj(params object[] pairs) { var d=new J();for(int i=0;i<pairs.Length;i+=2)d[(string)pairs[i]]=pairs[i+1];return d; }
        public static J Map(object value) { return value as J ?? new J(); }
        public static object Get(J d,string key) {object v;return d.TryGetValue(key,out v)?v:null;}
        public static string Str(J d,string key,string fallback="") {var v=Get(d,key);return v==null?fallback:Convert.ToString(v,CultureInfo.InvariantCulture);}
        public static bool Bool(J d,string key,bool fallback=false) {var v=Get(d,key);return v is bool?(bool)v:fallback;}
        public static long Num(J d,string key,long fallback=0) {long n;return Int64.TryParse(Str(d,key),out n)?n:fallback;}
        public static object[] Array(object value) {var e=value as IEnumerable;return e==null||value is string?new object[0]:e.Cast<object>().ToArray();}
        public static string[] Strings(J d,string key) {return Array(Get(d,key)).Select(v=>Convert.ToString(v)).ToArray();}
        public static string Encode(object value) {return new JavaScriptSerializer{MaxJsonLength=64*1024*1024,RecursionLimit=128}.Serialize(value);}
        public static J Decode(string value) {return new JavaScriptSerializer{MaxJsonLength=64*1024*1024,RecursionLimit=128}.Deserialize<J>(value);}
        public static long Now {get{return (long)(DateTime.UtcNow-new DateTime(1970,1,1)).TotalMilliseconds;}}
        public static string Absolute(string p) {if(String.IsNullOrWhiteSpace(p))throw new ArchiveError("文件路径不能为空");return Path.GetFullPath(p);}
        public static bool Within(string root,string target) {return target.StartsWith(root.TrimEnd('\\','/')+Path.DirectorySeparatorChar,StringComparison.OrdinalIgnoreCase);}
    }
    public class ArchiveError:Exception {
        public string Code;
        public ArchiveError(string message,string code="ARCHIVE_ERROR"):base(message){Code=code;}
        public static J Failure(Exception e){return Json.Obj("ok",false,"error",e.Message,"code",e is OperationCanceledException?"CANCELLED":e is ArchiveError?((ArchiveError)e).Code:"IO_ERROR");}
    }
    public sealed class TempFolder:IDisposable {
        public readonly string Path;
        public TempFolder(string parent,string prefix){Directory.CreateDirectory(parent);Path=System.IO.Path.Combine(parent,prefix+Guid.NewGuid().ToString("N"));Directory.CreateDirectory(Path);}
        public void Dispose(){if(Directory.Exists(Path)){try{Directory.Delete(Path,true);}catch(IOException){}catch(UnauthorizedAccessException){}}}
    }
}
