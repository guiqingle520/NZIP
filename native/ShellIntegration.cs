using System;
using System.IO;
using System.Linq;
using System.Runtime.InteropServices;
using Microsoft.Win32;

namespace NZIP {
    public static class ShellIntegration {
        public static readonly string[] Extensions=ArchiveFormats.ReadExtensions;
        const string Classes=@"Software\Classes\";
        static readonly string ProgId=Edition.Id+".Archive";
        static string Identity(string value){return Edition.Paid&&value!=null?System.Text.RegularExpressions.Regex.Replace(value,@"NZIP(?!Paid)",Edition.Id):value;}
        static string IdentityValue(string value){return Edition.Paid&&(value=="NZIP"||value.StartsWith(@"Software\NZIP\")||value=="NZIP 压缩文件"||value=="用 NZIP 打开并预览"||value=="使用 NZIP 压缩…")?Identity(value):value;}
        [DllImport("shell32.dll")]static extern void SHChangeNotify(uint eventId,uint flags,IntPtr item1,IntPtr item2);
        static string Command(string exe,string action){return "\""+exe+"\" "+action+" \"%1\"";}
        static void Set(string key,string name,string value){using(var k=Registry.CurrentUser.CreateSubKey(Identity(key)))k.SetValue(Identity(name),IdentityValue(value),RegistryValueKind.String);}
        static string Get(string key,string name){using(var k=Registry.CurrentUser.OpenSubKey(Identity(key)))return k==null?null:k.GetValue(Identity(name)) as string;}
        static void Delete(string key){Registry.CurrentUser.DeleteSubKeyTree(Identity(key),false);}
        static void DeleteValue(string key,string name){using(var k=Registry.CurrentUser.OpenSubKey(Identity(key),true))if(k!=null)k.DeleteValue(Identity(name),false);}
        static bool Owned(string value,string exe){return value!=null&&value.StartsWith("\""+exe+"\"",StringComparison.OrdinalIgnoreCase);}
        public static bool IsContextEnabled(string exe){return Owned(Get(Classes+@"SystemFileAssociations\.zip\shell\NZIP\shell\01.Open\command",""),exe);}
        public static bool IsRegistered(string exe){return Owned(Get(Classes+@"Applications\NZIP.exe\shell\open\command",""),exe);}
        public static void Notify(){SHChangeNotify(0x08000000,0,IntPtr.Zero,IntPtr.Zero);}
        public static void Register(string executable,bool context,bool notify=true){
            var exe=Path.GetFullPath(executable);var icon="\""+exe+"\",0";
            var app=Classes+@"Applications\NZIP.exe";
            Set(app,"FriendlyAppName","NZIP");Set(app+@"\DefaultIcon","",icon);Set(app+@"\shell\open","FriendlyAppName","NZIP");Set(app+@"\shell\open\command","",Command(exe,"--open"));
            Set(Classes+ProgId,"","NZIP 压缩文件");Set(Classes+ProgId,"FriendlyTypeName","NZIP 压缩文件");Set(Classes+ProgId+@"\DefaultIcon","",icon);Set(Classes+ProgId+@"\shell\open","","用 NZIP 打开并预览");Set(Classes+ProgId+@"\shell\open\command","",Command(exe,"--open"));
            Set(@"Software\NZIP\Capabilities","ApplicationName","NZIP");Set(@"Software\NZIP\Capabilities","ApplicationDescription","无广告的压缩解压与压缩包预览工具");Set(@"Software\NZIP\Capabilities","ApplicationIcon",icon);
            foreach(var ext in Extensions){
                Set(app+@"\SupportedTypes","."+ext,"");
                using(var k=Registry.CurrentUser.CreateSubKey(Classes+"."+ext+@"\OpenWithProgids"))k.SetValue(ProgId,new byte[0],RegistryValueKind.None);
                Set(@"Software\NZIP\Capabilities\FileAssociations","."+ext,ProgId);
            }
            Set(@"Software\RegisteredApplications","NZIP",@"Software\NZIP\Capabilities");
            Set(@"Software\Microsoft\Windows\CurrentVersion\App Paths\NZIP.exe","",exe);
            Set(@"Software\Microsoft\Windows\CurrentVersion\App Paths\NZIP.exe","Path",Path.GetDirectoryName(exe));
            SetContextMenus(exe,context,false);if(notify)Notify();
        }
        public static void SetContextMenus(string executable,bool enabled,bool notify=true){
            var exe=Path.GetFullPath(executable);var icon="\""+exe+"\",0";
            foreach(var kind in new[]{"*","Directory"}){
                var key=Classes+kind+@"\shell\NZIP.Compress";
                if(enabled){Set(key,"","使用 NZIP 压缩…");Set(key,"Icon",icon);Set(key,"MultiSelectModel","Single");Set(key+@"\command","",Command(exe,"--compress"));}
                else if(Owned(Get(key+@"\command",""),exe))Delete(key);
            }
            foreach(var ext in Extensions){
                var root=Classes+@"SystemFileAssociations\."+ext+@"\shell\";
                // Retire the separate verbs from 0.1/0.2 when updating this registration.
                foreach(var old in new[]{"NZIP.Open","NZIP.Extract"})if(enabled||Owned(Get(root+old+@"\command",""),exe))Delete(root+old);
                var key=root+"NZIP";
                if(!enabled){if(Owned(Get(key+@"\shell\01.Open\command",""),exe))Delete(key);continue;}
                Set(key,"MUIVerb","NZIP");Set(key,"Icon",icon);Set(key,"SubCommands","");Set(key,"MultiSelectModel","Single");
                var labels=new[]{"打开并预览","解压到同名文件夹","解压到其他文件夹…"};var flags=new[]{"--open","--extract-folder","--extract"};var names=new[]{"01.Open","02.ExtractFolder","03.Extract"};
                for(int i=0;i<names.Length;i++){var verb=key+@"\shell\"+names[i];Set(verb,"MUIVerb",labels[i]);Set(verb,"Icon",icon);Set(verb+@"\command","",Command(exe,flags[i]));}
            }
            if(notify)Notify();
        }
        public static void Unregister(string executable,bool notify=true){
            var exe=Path.GetFullPath(executable);
            if(IsRegistered(exe)){
                Delete(Classes+@"Applications\NZIP.exe");
                if(Owned(Get(Classes+ProgId+@"\shell\open\command",""),exe))Delete(Classes+ProgId);
                foreach(var ext in Extensions)DeleteValue(Classes+"."+ext+@"\OpenWithProgids",ProgId);
                DeleteValue(@"Software\RegisteredApplications","NZIP");Delete(@"Software\NZIP\Capabilities");
            }
            if(String.Equals(Get(@"Software\Microsoft\Windows\CurrentVersion\App Paths\NZIP.exe",""),exe,StringComparison.OrdinalIgnoreCase))Delete(@"Software\Microsoft\Windows\CurrentVersion\App Paths\NZIP.exe");
            SetContextMenus(exe,false,false);if(notify)Notify();
        }
    }
}
