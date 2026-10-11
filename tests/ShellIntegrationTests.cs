using System;
using System.IO;
using System.Runtime.InteropServices;
using Microsoft.Win32;
using NZIP;

static class ShellIntegrationTests {
    [DllImport("advapi32.dll")]static extern int RegOverridePredefKey(IntPtr key,IntPtr replacement);
    static readonly IntPtr Hkcu=new IntPtr(unchecked((int)0x80000001));
    static void Assert(bool result,string message){if(!result)throw new Exception(message);}
    static object Read(string key,string name){using(var k=Registry.CurrentUser.OpenSubKey(key))return k==null?null:k.GetValue(name);}
    static void Seed(string key,string name,object value){using(var k=Registry.CurrentUser.CreateSubKey(key))k.SetValue(name,value);}
    static int Main(){
        string sandboxPath=@"Software\NZIP.IntegrationTests\"+Guid.NewGuid().ToString("N");
        try{
            using(var sandbox=Registry.CurrentUser.CreateSubKey(sandboxPath)){
                if(RegOverridePredefKey(Hkcu,sandbox.Handle.DangerousGetHandle())!=0)throw new Exception("Registry sandbox failed");
                try{Run();}finally{RegOverridePredefKey(Hkcu,IntPtr.Zero);}
            }
            Console.WriteLine("Shell tests passed: Open With, supported formats, cascade commands, toggle, uninstall ownership, preservation of defaults and other apps.");return 0;
        }catch(Exception e){Console.Error.WriteLine(e);return 1;}
        finally{Registry.CurrentUser.DeleteSubKeyTree(sandboxPath,false);using(var parent=Registry.CurrentUser.OpenSubKey(@"Software\NZIP.IntegrationTests",true))if(parent!=null&&parent.SubKeyCount==0&&parent.ValueCount==0)Registry.CurrentUser.DeleteSubKey(@"Software\NZIP.IntegrationTests",false);}
    }
    static void Run(){
        var exe=Path.Combine(Path.GetTempPath(),"NZIP 中文 测试",Edition.Executable);
        var appId=Edition.Id;
        const string classes=@"Software\Classes\";
        const string openWith=classes+@".zip\OpenWithProgids";
        const string choice=@"Software\Microsoft\Windows\CurrentVersion\Explorer\FileExts\.zip\UserChoice";
        Seed(classes+".zip","","Existing.Zip");Seed(choice,"ProgId","Existing.Zip");Seed(choice,"Hash","do-not-change");Seed(openWith,"Other.Archive","");
        if(Edition.Paid){Seed(classes+@"Applications\NZIP.exe\shell\open\command","","free-edition-marker");Seed(classes+@"SystemFileAssociations\.zip\shell\NZIP","MUIVerb","free-menu-marker");}
        ShellIntegration.Register(exe,true,false);
        Assert(ShellIntegration.IsRegistered(exe),"Open With app not registered");
        Assert(ShellIntegration.IsContextEnabled(exe),"Context menu not registered");
        foreach(var ext in ShellIntegration.Extensions){
            Assert(Read(classes+"."+ext+@"\OpenWithProgids",appId+".Archive")!=null,"Missing OpenWithProgids: "+ext);
            Assert((string)Read(@"Software\"+appId+@"\Capabilities\FileAssociations","."+ext)==appId+".Archive","Missing capability: "+ext);
            var prefix=classes+@"SystemFileAssociations\."+ext+@"\shell\"+appId;
            Assert((string)Read(prefix,"MUIVerb")==appId,"Missing submenu: "+ext);
            Assert((string)Read(prefix+@"\shell\01.Open\command","")=="\""+exe+"\" --open \"%1\"","Open command quoting");
            Assert((string)Read(prefix+@"\shell\02.ExtractFolder\command","")=="\""+exe+"\" --extract-folder \"%1\"","Quick extract command quoting");
        }
        Assert((string)Read(classes+".zip","")=="Existing.Zip","Changed existing default");
        Assert((string)Read(choice,"Hash")=="do-not-change","Changed UserChoice hash");
        ShellIntegration.SetContextMenus(exe,false,false);
        Assert(!ShellIntegration.IsContextEnabled(exe)&&ShellIntegration.IsRegistered(exe),"Context toggle removed Open With registration");
        var newer=Path.Combine(Path.GetTempPath(),"NZIP newer",Edition.Executable);ShellIntegration.Register(newer,true,false);
        ShellIntegration.Unregister(exe,false);
        Assert(ShellIntegration.IsRegistered(newer)&&ShellIntegration.IsContextEnabled(newer),"Old uninstall removed newer registration");
        ShellIntegration.Unregister(newer,false);
        Assert(!ShellIntegration.IsRegistered(newer)&&!ShellIntegration.IsContextEnabled(newer),"Uninstall left app/menu registration");
        Assert(Read(openWith,appId+".Archive")==null&&Read(openWith,"Other.Archive")!=null,"Uninstall removed another app");
        Assert((string)Read(classes+".zip","")=="Existing.Zip"&&(string)Read(choice,"Hash")=="do-not-change","Uninstall changed existing default");
        Assert(Read(@"Software\RegisteredApplications",appId)==null,"Uninstall left capabilities");
        if(Edition.Paid){Assert((string)Read(classes+@"Applications\NZIP.exe\shell\open\command","")=="free-edition-marker","Paid registration touched free app");Assert((string)Read(classes+@"SystemFileAssociations\.zip\shell\NZIP","MUIVerb")=="free-menu-marker","Paid registration touched free menu");}
    }
}
