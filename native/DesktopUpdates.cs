using System;
using System.Diagnostics;
using System.IO;
using System.Linq;
using System.Threading;
using System.Threading.Tasks;
using System.Windows.Forms;

namespace NZIP {
    public sealed partial class DesktopWindow {
        Task UpdateDialog(){using(var cancel=new CancellationTokenSource())using(var dialog=new EditorDialog(I18n.T("软件更新"),390)){
            dialog.Note(I18n.T("通过 GitHub Release 获取更新，核验发布签名和安装包 SHA-256。下载完成后由你选择是否安装。"));var info=new Label{AutoSize=true,MaximumSize=new System.Drawing.Size(525,0),Text=I18n.T("正在检查…"),Name="update-info"};dialog.Body.Controls.Add(info);dialog.Confirm.Text=I18n.T("下载更新");dialog.Confirm.Enabled=false;System.Collections.Generic.Dictionary<string,object> release=null;string installer=null;bool running=false;
            dialog.Shown+=async(s,e)=>{try{release=await UpdateClient.Check(cancel.Token);if(dialog.IsDisposed)return;info.Text=release==null?I18n.T("已是最新版本"):I18n.T("发现新版本：")+Json.Str(release,"version")+"\r\n"+Json.Str(release,"notes");dialog.Confirm.Enabled=release!=null;}catch(Exception error){if(!dialog.IsDisposed)info.Text=error.Message;}};
            dialog.FormClosing+=(s,e)=>cancel.Cancel();dialog.Confirm.Click+=async(s,e)=>{if(running)return;try{if(installer!=null){if(backend.Busy||editSessions.Any(session=>!session.Finished)){info.Text=I18n.T("请先完成当前任务并关闭包内编辑文件，再安装更新");return;}UpdateClient.VerifyInstaller(installer,release);Process.Start(new ProcessStartInfo(Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.System),"msiexec.exe"),"/i "+ArchiveEngine.Quote(installer)){UseShellExecute=true});dialog.DialogResult=DialogResult.OK;Close();return;}running=true;dialog.Confirm.Enabled=false;info.Text=I18n.T("正在下载并验证…");installer=await UpdateClient.Download(release,Path.Combine(backend.Profile,"updates"),cancel.Token);if(dialog.IsDisposed)return;info.Text=I18n.T("更新包已通过签名和哈希验证，可开始安装");dialog.Confirm.Text=I18n.T("安装并退出 NZIP");dialog.Confirm.Enabled=true;}catch(Exception error){if(!dialog.IsDisposed){info.Text=error.Message;dialog.Confirm.Enabled=release!=null;}}finally{running=false;}};dialog.ShowDialog(this);
        }return Task.FromResult(0);}
        async Task CheckUpdatesQuietly(){if(!preferences.Bool("autoUpdate")||Environment.GetEnvironmentVariable("NZIP_TEST_MODE")=="1")return;var path=Path.Combine(backend.Profile,"update-check.txt");try{if(System.IO.File.Exists(path)&&DateTime.UtcNow-System.IO.File.GetLastWriteTimeUtc(path)<TimeSpan.FromDays(1))return;System.IO.File.WriteAllText(path,DateTime.UtcNow.ToString("O"));using(var cancel=new CancellationTokenSource(TimeSpan.FromSeconds(12))){var release=await UpdateClient.Check(cancel.Token);if(release!=null&&!closing)message.Text=I18n.T("发现新版本，可从帮助菜单打开软件更新");}}catch(Exception){}}
    }
}
