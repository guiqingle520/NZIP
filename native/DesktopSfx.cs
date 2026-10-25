using System;
using System.IO;
using System.Windows.Forms;

namespace NZIP {
    public sealed partial class DesktopWindow {
        void SfxDialog(){using(var dialog=new EditorDialog(I18n.T("创建自解压文件"),470)){
            dialog.Note(I18n.T("生成独立的 Windows 自解压 EXE，接收方无需安装 NZIP。仅解压内容，不自动运行包内程序。"));
            var source=dialog.FileField(I18n.T("已有 7Z 压缩包"),archive!=null&&Json.Str(archive,"type")=="7z"?Json.Str(archive,"path"):"",false,false,"sfx-source");var destination=dialog.FileField(I18n.T("保存自解压 EXE"),Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.DesktopDirectory),"archive.exe"),false,true,"sfx-destination");var secret=dialog.TextField(I18n.T("压缩包密码（如果需要）"),"","sfx-password",true);AddVaultPicker(dialog,secret);
            dialog.Confirm.Text=I18n.T("创建");dialog.Confirm.Click+=(s,e)=>{StartJob("sfx",Json.Obj("archive",source.Text,"destination",destination.Text,"password",secret.Text));secret.Clear();dialog.DialogResult=DialogResult.OK;};dialog.ShowDialog(this);
        }}
    }
}
