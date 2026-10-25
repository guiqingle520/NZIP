using System;
using System.Collections.Generic;
using System.IO;
using System.Linq;
using System.Reflection;
using System.Runtime.CompilerServices;
using System.Runtime.InteropServices;
using System.Text;
using System.Windows.Forms;

namespace NZIP {
    public static class I18n {
        static string language="zh-CN";static Dictionary<string,object> english;
        public static string Language{get{return language;}set{language=new[]{"zh-CN","zh-TW","en-US"}.Contains(value)?value:"zh-CN";}}
        [DllImport("kernel32.dll",CharSet=CharSet.Unicode)]static extern int LCMapStringEx(string locale,uint flags,string source,int count,StringBuilder destination,int capacity,IntPtr version,IntPtr reserved,IntPtr sort);
        public static string T(string text){if(String.IsNullOrEmpty(text)||language=="zh-CN")return text;if(language=="zh-TW"){var output=new StringBuilder(text.Length*2+2);return LCMapStringEx("zh-TW",0x04000000,text,-1,output,output.Capacity,IntPtr.Zero,IntPtr.Zero,IntPtr.Zero)>0?output.ToString().Replace("文件夾","資料夾").Replace("文件","檔案").Replace("軟件","軟體").Replace("打開","開啟").Replace("默認","預設").Replace("剪貼板","剪貼簿"):text;}
            if(english==null)using(var stream=Assembly.GetExecutingAssembly().GetManifestResourceStream("en-US.json"))using(var reader=new StreamReader(stream,Encoding.UTF8))english=Json.Decode(reader.ReadToEnd());object translated;if(english.TryGetValue(text,out translated))return Convert.ToString(translated);return text;
        }
    }
}
