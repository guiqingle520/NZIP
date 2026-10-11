using System;
using System.Collections.Generic;
using System.Runtime.InteropServices;
using System.Text;
using System.Web.Script.Serialization;
using Microsoft.Win32;
using NZIP;
static class ExportShellRegistry {
    [DllImport("advapi32.dll")]static extern int RegOverridePredefKey(IntPtr key,IntPtr replacement);
    static readonly IntPtr Hkcu=new IntPtr(unchecked((int)0x80000001));
    static readonly List<object> values=new List<object>();
    static void Read(RegistryKey root,string path){using(var k=root.OpenSubKey(path)){foreach(var n in k.GetValueNames())values.Add(new {key=path,name=n,value=k.GetValue(n),kind=k.GetValueKind(n).ToString()});foreach(var n in k.GetSubKeyNames())Read(root,path+"\\"+n);}}
    static int Main(){
        string key=@"Software\NZIP.BuildRegistry\"+Guid.NewGuid().ToString("N");
        try{using(var sandbox=Registry.CurrentUser.CreateSubKey(key)){if(RegOverridePredefKey(Hkcu,sandbox.Handle.DangerousGetHandle())!=0)throw new Exception("Registry sandbox failed");try{ShellIntegration.Register(@"C:\NZIP_PLACEHOLDER\NZIP.exe",true,false);Read(Registry.CurrentUser,"Software");}finally{RegOverridePredefKey(Hkcu,IntPtr.Zero);}}Console.OutputEncoding=new UTF8Encoding(false);Console.WriteLine(new JavaScriptSerializer().Serialize(values));return 0;}
        finally{Registry.CurrentUser.DeleteSubKeyTree(key,false);using(var parent=Registry.CurrentUser.OpenSubKey(@"Software\NZIP.BuildRegistry",true))if(parent!=null&&parent.SubKeyCount==0&&parent.ValueCount==0)Registry.CurrentUser.DeleteSubKey(@"Software\NZIP.BuildRegistry",false);}
    }
}
