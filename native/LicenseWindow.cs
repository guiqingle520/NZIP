using System;
using System.Drawing;
using System.Diagnostics;
using System.IO;
using System.Text;
using System.Threading;
using System.Threading.Tasks;
using System.Windows.Forms;

namespace NZIP {
    internal sealed class LicenseWindow:Form {
        readonly LicenseService service;readonly Label status=new Label();readonly TextBox code=new TextBox();
        readonly Button activate=new Button(),deactivate=new Button(),import=new Button(),export=new Button(),manage=new Button(),requestOffline=new Button();
        readonly CancellationTokenSource cancel=new CancellationTokenSource();bool busy;
        public LicenseWindow(){
            service=LicenseRuntime.Current;Text=Edition.Name+" · 授权与设备";ClientSize=new Size(580,365);MinimumSize=Size;MaximumSize=Size;StartPosition=FormStartPosition.CenterParent;Font=new Font("Microsoft YaHei UI",9);AutoScaleMode=AutoScaleMode.Dpi;
            var body=new TableLayoutPanel{Dock=DockStyle.Fill,Padding=new Padding(22),ColumnCount=1,RowCount=7};
            status.AutoSize=true;status.MaximumSize=new Size(530,70);body.Controls.Add(status);
            var info=new Label{Text="首次联网激活，之后可永久离线使用。默认可登记 3 台设备。\r\n换机时先解绑释放名额，或使用购买邮箱管理旧设备。",AutoSize=true,MaximumSize=new Size(530,60)};body.Controls.Add(info);
            body.Controls.Add(new Label{Text="激活码",AutoSize=true});code.Dock=DockStyle.Top;code.MaxLength=100;code.UseSystemPasswordChar=true;code.AccessibleName="激活码";body.Controls.Add(code);
            var primary=new FlowLayoutPanel{AutoSize=true};activate.Text="激活此电脑";deactivate.Text="解绑并释放名额";manage.Text="购买邮箱管理设备";foreach(var button in new[]{activate,deactivate,manage}){button.AutoSize=true;primary.Controls.Add(button);}body.Controls.Add(primary);
            var backup=new FlowLayoutPanel{AutoSize=true};import.Text="导入本机离线授权…";export.Text="导出本机离线授权…";requestOffline.Text="导出离线申请…";foreach(var button in new[]{import,export,requestOffline}){button.AutoSize=true;backup.Controls.Add(button);}body.Controls.Add(backup);
            body.Controls.Add(new Label{Text="离线授权仅适用于当前 Windows 安装，不包含激活码。\r\n没有旧电脑也可通过购买邮箱解绑；失败时保留本地授权。",AutoSize=true,ForeColor=Color.DimGray});Controls.Add(body);
            activate.Click+=async(s,e)=>await Run(async()=>{if(String.IsNullOrWhiteSpace(code.Text))throw new ArchiveError("请输入激活码");await service.Activate(code.Text,cancel.Token);code.Clear();});
            deactivate.Click+=async(s,e)=>{if(MessageBox.Show(this,"解绑成功后，本机新任务需要重新激活。名额会立即释放。","解绑此电脑",MessageBoxButtons.OKCancel,MessageBoxIcon.Question)==DialogResult.OK)await Run(()=>service.Deactivate(cancel.Token));};
            import.Click+=async(s,e)=>await Run(()=>{using(var dialog=new OpenFileDialog{Filter="NZIP 离线授权|*.nziplicense"})if(dialog.ShowDialog(this)==DialogResult.OK){if(new FileInfo(dialog.FileName).Length>16384)throw new ArchiveError("授权文件过大");service.Import(File.ReadAllText(dialog.FileName,new UTF8Encoding(false,true)));}return Task.FromResult(0);});
            export.Click+=async(s,e)=>await Run(()=>{using(var dialog=new SaveFileDialog{Filter="NZIP 离线授权|*.nziplicense",FileName="NZIP-本机授权.nziplicense"})if(dialog.ShowDialog(this)==DialogResult.OK)File.WriteAllText(dialog.FileName,service.Export(),new UTF8Encoding(false));return Task.FromResult(0);});
            requestOffline.Click+=async(s,e)=>await Run(()=>{using(var dialog=new SaveFileDialog{Filter="NZIP 离线申请|*.nziprequest",FileName="NZIP-离线申请.nziprequest"})if(dialog.ShowDialog(this)==DialogResult.OK)File.WriteAllText(dialog.FileName,Json.Encode(Json.Obj("schema",1,"product","nzip-paid","deviceDigest",LicenseService.DeviceDigest(),"deviceName",Environment.MachineName)),new UTF8Encoding(false));return Task.FromResult(0);});
            manage.Click+=(s,e)=>{try{Uri uri;if(!Uri.TryCreate(service.Endpoint,UriKind.Absolute,out uri)||uri.Scheme!="https")throw new ArchiveError("此构建尚未配置正式授权服务，请联系发行方");Process.Start(new ProcessStartInfo(service.Endpoint){UseShellExecute=true});}catch(Exception error){MessageBox.Show(this,error.Message,Text);}};
            FormClosing+=(s,e)=>{if(busy){e.Cancel=true;MessageBox.Show(this,"请等待授权请求完成，以便保存结果。",Text);}};FormClosed+=(s,e)=>cancel.Dispose();RefreshStatus();
        }
        void RefreshStatus(){var state=service.Status();bool active=Json.Bool(state,"active");status.Text=active?"已激活 · 永久授权\r\n客户编号："+Json.Str(state,"customerRef"):"未激活 · 可免费浏览压缩包目录和文件列表\r\n"+Json.Str(state,"error");deactivate.Enabled=!busy&&Json.Bool(state,"canDeactivate");export.Enabled=!busy&&active;}
        async Task Run(Func<Task> operation){if(busy)return;busy=true;foreach(var b in new[]{activate,deactivate,import,export,manage,requestOffline})b.Enabled=false;try{await operation();}catch(Exception error){MessageBox.Show(this,error is OperationCanceledException?"授权请求超时或取消，请重试；已有授权会保留。":error.Message,Text,MessageBoxButtons.OK,MessageBoxIcon.Information);}finally{busy=false;foreach(var b in new[]{activate,import,manage,requestOffline})b.Enabled=true;RefreshStatus();}}
    }
}
