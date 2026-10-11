using System;
using System.Collections.Generic;
using System.Drawing;
using System.Drawing.Imaging;
using System.IO;
using System.Linq;
using System.Threading;
using System.Threading.Tasks;
using System.Windows.Forms;

namespace NZIP {
    using J=Dictionary<string,object>;
    public sealed partial class DesktopWindow {
        static void Assert(bool condition,string message){if(!condition)throw new Exception(message);}
        static Control Find(Control owner,string name){return owner.Controls.Find(name,true).FirstOrDefault();}
        async Task WaitFor(Func<bool> condition,string reason){var clock=System.Diagnostics.Stopwatch.StartNew();while(!condition()){if(clock.ElapsedMilliseconds>30000)throw new Exception("Timeout: "+reason);await Task.Delay(30);}}
        void Screenshot(string root,string name){using(var image=new Bitmap(Width,Height)){DrawToBitmap(image,new Rectangle(Point.Empty,Size));image.Save(Path.Combine(root,name+".png"),ImageFormat.Png);}}
        [System.Runtime.InteropServices.DllImport("user32.dll")]static extern IntPtr GetForegroundWindow();
        Bitmap RibbonScreen(){Assert(GetForegroundWindow()==Handle,"Test window must be foreground for screen paint capture");var image=new Bitmap(ribbon.Width,ribbon.Height);using(var graphics=Graphics.FromImage(image))graphics.CopyFromScreen(ribbon.PointToScreen(Point.Empty),Point.Empty,image.Size);return image;}
        static void RibbonMouse(Button button,string method){typeof(Control).GetMethod(method,System.Reflection.BindingFlags.NonPublic|System.Reflection.BindingFlags.Instance).Invoke(button,new object[]{EventArgs.Empty});}
        static void SameRibbon(Bitmap expected,Bitmap actual,string reason){Assert(expected.Size==actual.Size,reason+" size");for(int y=0;y<expected.Height;y++)for(int x=0;x<expected.Width;x++)Assert(expected.GetPixel(x,y)==actual.GetPixel(x,y),reason+" pixel "+x+","+y);}
        async Task CheckRibbonPaint(string output){
            Activate();Focus();Cursor.Position=PointToScreen(new Point(ClientSize.Width-35,ClientSize.Height-50));await Task.Delay(100);ribbon.Refresh();foreach(Button button in ribbon.Controls)button.Refresh();await Task.Delay(80);
            using(var baseline=RibbonScreen()){
                baseline.Save(Path.Combine(output,"toolbar-screen-before.png"),ImageFormat.Png);
                foreach(Button button in ribbon.Controls){var pixel=baseline.GetPixel(button.Left+4,button.Top+4);Assert(pixel.B>150&&pixel.G>80&&pixel.R<120,"Opaque blue toolbar background: "+button.Name);}
                var openButton=tools["open"];RibbonMouse(openButton,"OnMouseEnter");openButton.Refresh();await Task.Delay(40);
                using(var hover=RibbonScreen()){
                    Assert(hover.GetPixel(openButton.Left+4,4)!=baseline.GetPixel(openButton.Left+4,4),"Visible hover feedback");
                    for(int pass=0;pass<12;pass++)openButton.Refresh();await Task.Delay(40);
                    using(var repeatedHover=RibbonScreen())SameRibbon(hover,repeatedHover,"Hover overlay does not accumulate");
                    hover.Save(Path.Combine(output,"toolbar-screen-hover.png"),ImageFormat.Png);
                }
                RibbonMouse(openButton,"OnMouseLeave");openButton.Refresh();
                for(int pass=0;pass<12;pass++)foreach(Button button in ribbon.Controls){bool enabled=button.Enabled;button.Enabled=true;RibbonMouse(button,"OnMouseEnter");button.Refresh();RibbonMouse(button,"OnMouseLeave");button.Enabled=false;button.Refresh();button.Enabled=enabled;button.Refresh();}
                await Task.Delay(80);using(var repainted=RibbonScreen())SameRibbon(baseline,repainted,"Hover / enable repeated repaint");
                ClientSize=new Size(1000,700);await Task.Delay(60);ClientSize=new Size(806,554);await Task.Delay(80);
                WindowState=FormWindowState.Minimized;await Task.Delay(60);WindowState=FormWindowState.Normal;Activate();await Task.Delay(120);
                using(var restored=RibbonScreen()){restored.Save(Path.Combine(output,"toolbar-screen-after.png"),ImageFormat.Png);SameRibbon(baseline,restored,"Resize / minimize / restore repaint");}
            }
        }
        internal async Task RunSmoke(string output){
            Directory.CreateDirectory(output);var checks=new List<string>();IDataObject originalClipboard=null;try{
                originalClipboard=Clipboard.GetDataObject();var snapshot=new DataObject();if(originalClipboard!=null)foreach(string format in originalClipboard.GetFormats(false)){try{object value=originalClipboard.GetData(format,false);if(value!=null)snapshot.SetData(format,false,value);}catch{}}originalClipboard=snapshot;
                preferences.Values["modalProgress"]=false;preferences.Values["openAfterExtract"]=false;preferences.Values["confirmDelete"]=false;ApplyPreferences();
                Assert(menus.Items.Count==7,"Seven main menus");Assert(commands.ContainsKey("delete-permanent")&&commands.ContainsKey("admin-window")&&commands.ContainsKey("comment")&&commands.ContainsKey("recover"),"Screenshot menu commands");Assert(columnsMenu.DropDownItems.Count==10&&pagesMenu.DropDownItems.Count==17,"Fields and code pages");checks.Add("native menus and complete codepage / field lists");
                ClientSize=new Size(806,554);await Task.Delay(80);await CheckRibbonPaint(output);checks.Add("actual screen toolbar stays opaque and stable after hover, enabled changes, resize and restore");Screenshot(output,"home");
                var source=Path.Combine(output,"素材");Directory.CreateDirectory(source);File.WriteAllText(Path.Combine(source,"你好.txt"),"NZIP 原生界面预览测试",System.Text.Encoding.UTF8);using(var image=new Bitmap(48,32)){using(var g=Graphics.FromImage(image))g.Clear(Color.CornflowerBlue);image.Save(Path.Combine(source,"图片.png"));}
                string zip=Path.Combine(output,"原生 测试.zip");await Task.Run(()=>backend.Engine.Create(Json.Obj("sources",new[]{source},"destination",zip),CancellationToken.None));await OpenArchive(zip);Assert(archive!=null&&nodes.ContainsKey("素材/"),"Archive tree");GoFolder("素材/");Assert(visible.Any(e=>Json.Str(e,"name")=="你好.txt"),"Native listing");Screenshot(output,"archive");checks.Add("actual archive tree and virtual native list");
                var method=(ToolStripMenuItem)columnsMenu.DropDownItems["column-method"];method.PerformClick();Assert(files.Columns.Cast<ColumnHeader>().Any(c=>Convert.ToString(c.Tag)=="method"),"Field toggle");method.PerformClick();
                commands["search"].PerformClick();search.Text="你好";Assert(visible.Count==1,"Search");search.Text="";searchBar.Visible=false;checks.Add("field toggle and actual search input");
                SelectByName("你好.txt");await Preview();Assert(Application.OpenForms.Cast<Form>().Any(f=>f.Name=="text-preview"),"Text preview window");var textForm=Application.OpenForms.Cast<Form>().First(f=>f.Name=="text-preview");Assert(((TextBox)Find(textForm,"text-content")).Text.Contains("原生界面"),"Text content");textForm.Close();SelectByName("图片.png");await Preview();Assert(Application.OpenForms.Cast<Form>().Any(f=>f.Name=="image-preview"),"Image preview");Application.OpenForms.Cast<Form>().First(f=>f.Name=="image-preview").Close();checks.Add("real text and image previews");
                SelectByName("你好.txt");await CopyFiles();Assert(Clipboard.ContainsFileDropList()&&File.Exists(Clipboard.GetFileDropList()[0]),"Clipboard file copy");var extra=Path.Combine(output,"粘贴.txt");File.WriteAllText(extra,"clipboard paste");var drop=new System.Collections.Specialized.StringCollection();drop.Add(extra);Clipboard.SetFileDropList(drop);await Execute("paste");await WaitFor(()=>!backend.Busy,"paste job");await Task.Delay(150);await OpenArchive(zip);GoFolder("素材/");Assert(entries.Any(e=>Json.Str(e,"path")=="素材/粘贴.txt"),"Pasted in current folder");checks.Add("clipboard files copied and pasted into actual archive folder");
                SelectByName("粘贴.txt");using(var timer=FillDialog("重命名文件",form=>{((TextBox)Find(form,"prompt-value")).Text="已更名.txt";((EditorDialog)form).Confirm.PerformClick();})){commands["rename"].PerformClick();}await WaitFor(()=>!backend.Busy,"rename");await Task.Delay(100);await OpenArchive(zip);GoFolder("素材/");Assert(entries.Any(e=>Json.Str(e,"path")=="素材/已更名.txt"),"Rename menu modifies archive");checks.Add("F2 rename menu and native dialog");
                using(var timer=FillDialog("压缩文件注释",form=>{((TextBox)Find(form,"archive-comment")).Text="原生 ZIP 注释\r\n第二行";((EditorDialog)form).Confirm.PerformClick();})){commands["comment"].PerformClick();}await WaitFor(()=>!backend.Busy,"comment");Assert(ArchiveTools.Comment(zip,0).Contains("第二行"),"Comment write");checks.Add("ZIP comment dialog writes valid real archive");
                using(var settings=new SettingsWindow(this,backend,preferences)){settings.Show(this);await Task.Delay(60);var navigation=settings.Controls.OfType<Panel>().SelectMany(c=>c.Controls.OfType<ListBox>()).Single();Assert(navigation.Items.Count==9,"Settings categories");ScreenshotForm(settings,output,"settings");for(int i=0;i<9;i++){navigation.SelectedIndex=i;await Task.Delay(5);Assert(settings.Controls.OfType<FlowLayoutPanel>().Any(p=>p.Controls.Count>0),"Settings page");}settings.Close();}checks.Add("nine settings pages render with real controls");
                await OpenArchive(zip);GoFolder("素材/");SelectByName("已更名.txt");await Execute("delete");await WaitFor(()=>!backend.Busy,"delete entry");await Task.Delay(100);await OpenArchive(zip);Assert(!entries.Any(e=>Json.Str(e,"name")=="已更名.txt"),"Delete menu");checks.Add("entry deletion commits real ZIP");
                preferences.Values["theme"]="dark";ApplyPreferences();GoFolder("素材/");Screenshot(output,"dark");Assert(files.BackColor.R<50,"Dark theme");preferences.Values["theme"]="light";ApplyPreferences();checks.Add("native light / dark themes");
                using(var settings=new SettingsWindow(this,backend,preferences)){settings.Show(this);((CheckBox)Find(settings,"setting-fullTitle")).Checked=true;((Button)Find(settings,"settings-save")).PerformClick();settings.Close();}ApplyPreferences();Assert(Text.Contains(zip),"Settings applied");Assert(Json.Bool(Json.Decode(File.ReadAllText(Path.Combine(backend.Profile,"desktop.json"))),"fullTitle"),"Settings persisted");checks.Add("settings save persists and applies to real window");
                string created=Path.Combine(output,"新建菜单.zip");using(var timer=FillDialog("新建压缩文件",form=>{((ListBox)Find(form,"create-sources")).Items.Add(extra);((TextBox)Find(form,"create-destination")).Text=created;((EditorDialog)form).Confirm.PerformClick();})){commands["new"].PerformClick();}await WaitFor(()=>!backend.Busy,"create menu");Assert(File.Exists(created),"Create menu output");checks.Add("new archive dialog and actual compression");
                string extracted=Path.Combine(output,"菜单解压结果");using(var timer=FillDialog("解压文件",form=>{((TextBox)Find(form,"extract-destination")).Text=extracted;((EditorDialog)form).Confirm.PerformClick();})){commands["extract"].PerformClick();}await WaitFor(()=>!backend.Busy,"extract menu");Assert(File.ReadAllText(Path.Combine(extracted,"素材","你好.txt")).Contains("原生界面"),"Extract menu contents");checks.Add("extraction dialog, preallocation and actual files");
                preferences.Values["recycle"]=true;await Execute("delete-archive");Assert(!File.Exists(zip)&&archive==null,"Recycle archive");checks.Add("archive deletion moves test file to recycle bin");
                using(var settings=new SettingsWindow(this,backend,preferences)){settings.Show(this);var navigation=settings.Controls.OfType<Panel>().SelectMany(c=>c.Controls.OfType<ListBox>()).Single();navigation.SelectedIndex=4;var formats=(ComboBox)Find(settings,"setting-defaultFormat");Assert(formats.Items.Count==10,"Default format choices");formats.SelectedItem="tar.xz";((Button)Find(settings,"settings-save")).PerformClick();settings.Close();}ApplyPreferences();Assert(new DesktopPreferences(backend.Profile,new J()).Str("defaultFormat")=="tar.xz","New default format persists");checks.Add("expanded default compression format persists through real settings controls");
                string compound=Path.Combine(output,"多格式.tar.xz");using(var timer=FillDialog("新建压缩文件",form=>{var formats=(ComboBox)Find(form,"create-format");var destination=(TextBox)Find(form,"create-destination");Assert(formats.Items.Count==10&&formats.SelectedItem.ToString()=="TAR.XZ","Create defaults to selected new format");destination.Text=Path.Combine(output,"多格式.zip");formats.SelectedItem="7Z";Assert(Find(form,"create-password").Enabled&&Find(form,"create-headers").Enabled,"7Z options enabled");formats.SelectedItem="GZ";Assert(!Find(form,"create-password").Enabled&&!Find(form,"create-volume").Enabled&&Find(form,"create-format-note").Text.Contains("单个"),"Single-file options and hint");foreach(var f in new[]{"TAR.GZ","TAR.BZ2","TAR.XZ"}){formats.SelectedItem=f;Assert(destination.Text.EndsWith("多格式."+f.ToLowerInvariant()),"Compound suffix switching");}((ListBox)Find(form,"create-sources")).Items.Add(source);ScreenshotForm(form,output,"create-formats");((EditorDialog)form).Confirm.PerformClick();})){commands["new"].PerformClick();}await WaitFor(()=>!backend.Busy,"compound compression");Assert(File.Exists(compound),"Compound menu output");await OpenArchive(compound);GoFolder("素材/");SelectByName("你好.txt");Screenshot(output,"compound-archive");await Preview();var compoundPreview=Application.OpenForms.Cast<Form>().Single(f=>f.Name=="text-preview");Assert(((TextBox)Find(compoundPreview,"text-content")).Text.Contains("原生界面"),"Compound preview contents");compoundPreview.Close();checks.Add("ten create formats, compatible options, compound suffix, real TAR.XZ browsing and text preview");
                string compoundOut=Path.Combine(output,"复合包解压");using(var timer=FillDialog("解压文件",form=>{var destination=(TextBox)Find(form,"extract-destination");Assert(destination.Text.EndsWith("多格式"),"Compound folder name strips full suffix");destination.Text=compoundOut;((EditorDialog)form).Confirm.PerformClick();})){await Execute("extract-selected");}await WaitFor(()=>!backend.Busy,"compound selected extraction");Assert(File.ReadAllText(Path.Combine(compoundOut,"素材","你好.txt")).Contains("原生界面"),"Compound extracted directly");Assert(!File.Exists(Path.Combine(compoundOut,"素材","图片.png")),"Only selected compound entry extracted");checks.Add("one-step selected extraction from compressed TAR through native dialog");
                await CheckTaskResults(output,checks);
                await CheckLocalOpening(output,checks);
                File.WriteAllText(Path.Combine(output,"result.json"),Json.Encode(Json.Obj("ok",true,"checks",checks,"runtime","winforms")));
            }catch(Exception error){Environment.ExitCode=1;File.WriteAllText(Path.Combine(output,"result.json"),Json.Encode(Json.Obj("ok",false,"error",error.ToString(),"checks",checks)));}
            finally{try{if(originalClipboard!=null)Clipboard.SetDataObject(originalClipboard,true);}catch{}foreach(var form in Application.OpenForms.Cast<Form>().Where(f=>f!=this).ToArray())form.Close();Close();}
        }
        async Task CheckTaskResults(string output,List<string> checks){
            var originalLauncher=backend.resultLauncher;var requests=new List<System.Diagnostics.ProcessStartInfo>();backend.resultLauncher=info=>requests.Add(info);
            try{
                string destination=Path.Combine(output,"任务结果 中文目录");var payload=Payload();payload["destination"]=destination;payload["selected"]=new[]{"素材/你好.txt"};await backend.ExtractForOpen(payload);
                if(taskWindow!=null&&!taskWindow.IsDisposed)taskWindow.Close();await Execute("tasks");await Task.Delay(60);
                var rows=(ListView)Find(taskWindow,"task-list");var open=(Button)Find(taskWindow,"task-open-result");var cancel=(Button)Find(taskWindow,"task-cancel");var hint=(Label)Find(taskWindow,"task-hint");
                Assert(rows.SelectedItems.Count==1&&open.Enabled&&!rows.HideSelection,"Completed output automatically selected and visible");
                Assert(Json.Str(Json.Map(Json.Get(rows.SelectedItems[0].Tag as J,"result")),"path")==destination,"Latest completed output selected");
                open.Focus();open.PerformClick();Assert(requests.Count==1&&requests[0].FileName=="explorer.exe"&&requests[0].Arguments==ArchiveEngine.Quote(destination),"Actual button dispatch opens matching extracted directory");
                var snapshot=Json.Array(Json.Get(backend.Dispatch("init",new object[0]),"jobs")).Select(Json.Map).ToArray();var originalItem=rows.SelectedItems[0];for(int pass=0;pass<8;pass++)taskWindow.UpdateJobs(snapshot);
                Assert(Object.ReferenceEquals(originalItem,rows.SelectedItems[0])&&open.Enabled,"Progress refresh retains row, selection and button target");
                var create=snapshot.First(j=>Json.Str(j,"type")=="create"&&Backend.HasOpenableResult(j)&&File.Exists(Json.Str(Json.Map(Json.Get(j,"result")),"path")));
                rows.SelectedIndices.Clear();int createIndex=Array.FindIndex(snapshot,j=>Json.Str(j,"id")==Json.Str(create,"id"));rows.Items[createIndex].Selected=true;
                var pending=Json.Obj("id","ui-only-queued","type","extract","status","queued","label","排队.zip","percent",0);taskWindow.UpdateJobs(new[]{pending}.Concat(snapshot).ToArray());
                Assert(Json.Str(rows.SelectedItems[0].Tag as J,"id")==Json.Str(create,"id"),"New queued task preserves explicit selected job by ID");open.PerformClick();
                Assert(requests.Count==2&&requests[1].Arguments=="/select,"+ArchiveEngine.Quote(Json.Str(Json.Map(Json.Get(create,"result")),"path")),"Archive output selected in Explorer rather than opened");
                ScreenshotForm(taskWindow,output,"task-result-selection");checks.Add("task result button defaults to completed extraction, retains visible stable selection across refresh/insertion, opens folder or selects created archive by job ID");
                foreach(string state in new[]{"queued","running","cancelling","failed","cancelled","completed"}){
                    taskWindow.UpdateJobs(new[]{Json.Obj("id","ui-only-"+state,"type","test","status",state,"label","无输出任务","percent",0)});
                    Assert(!open.Enabled&&hint.Text.Length>0,"No-output button disabled for "+state);Assert(cancel.Enabled==(state=="queued"||state=="running"),"Cancel state "+state);open.PerformClick();
                }
                taskWindow.UpdateJobs(new J[0]);Assert(!open.Enabled&&!cancel.Enabled&&hint.Text=="暂无任务"&&requests.Count==2,"Empty list cannot silently invoke result action");
                bool rejected=false;try{backend.Dispatch("open-result",new object[]{"missing-job"});}catch(ArchiveError){rejected=true;}Assert(rejected,"Backend rejects unavailable job");
                var outputJob=snapshot.Single(j=>Json.Str(Json.Map(Json.Get(j,"result")),"path")==destination);taskWindow.UpdateJobs(new[]{outputJob});
                Assert(Json.Within(Path.GetFullPath(output),Path.GetFullPath(destination)),"Deleted fixture stays inside smoke output");Directory.Delete(destination,true);open.PerformClick();
                Assert(requests.Count==2&&hint.Text.Contains("不存在"),"Deleted output reports clear error without invoking Explorer");
                checks.Add("empty, incomplete, failed, cancelled and pathless tasks disable result opening; deleted output reports a visible error");
                taskWindow.Close();
            }finally{backend.resultLauncher=originalLauncher;}
        }
        async Task CheckLocalOpening(string output,List<string> checks){
            var originalLauncher=localFileLauncher;bool customTemp=preferences.Bool("customTemp");string tempPath=preferences.Str("tempPath");
            var launches=new List<System.Diagnostics.ProcessStartInfo>();
            try{
                preferences.Values["customTemp"]=true;preferences.Values["tempPath"]=Path.Combine(output,"本地打开临时目录");
                localFileLauncher=info=>launches.Add(info);
                string source=Path.Combine(output,"本地文件");Directory.CreateDirectory(source);
                string large=Path.Combine(source,"大文本.txt");File.WriteAllText(large,new string('N',12*1024*1024),System.Text.Encoding.UTF8);
                File.WriteAllText(Path.Combine(source,"脚本.js"),"throw new Error('must open as text');");File.WriteAllText(Path.Combine(source,"程序.exe"),"not executable");
                File.Copy(Path.Combine(output,"素材","图片.png"),Path.Combine(source,"图片.png"));
                string zip=Path.Combine(output,"本地打开.zip");await Task.Run(()=>backend.Engine.Create(Json.Obj("sources",new[]{source},"destination",zip),CancellationToken.None));
                await OpenArchive(zip);SelectByName("本地文件");await Execute("open-entry");Assert(folder=="本地文件/"&&launches.Count==0,"Folder activation only browses");
                SelectByName("..");await Execute("open-entry");Assert(folder==""&&launches.Count==0,"Parent activation navigates");GoFolder("本地文件/");
                Assert(visible.Any(e=>Json.Str(e,"name")=="大文本.txt"&&Json.Num(e,"size")>10L*1024*1024),"List browses entries over content preview limit");
                SelectByName("大文本.txt");typeof(Control).GetMethod("OnDoubleClick",System.Reflection.BindingFlags.Instance|System.Reflection.BindingFlags.NonPublic).Invoke(files,new object[]{EventArgs.Empty});
                await WaitFor(()=>launches.Count==1,"double-click local opening");
                var launch=launches[0];string opened=launch.Arguments.Trim('"');Assert(launch.UseShellExecute&&launch.FileName.EndsWith("notepad.exe",StringComparison.OrdinalIgnoreCase),"Text is routed to local Notepad");
                Assert(File.ReadAllBytes(opened).SequenceEqual(File.ReadAllBytes(large)),"Large local file extracted intact");Assert(Directory.GetFiles(Directory.GetParent(Path.GetDirectoryName(opened)).FullName,"*",SearchOption.AllDirectories).Length==1,"Only the selected file is extracted");
                await Execute("close-archive");Assert(File.Exists(opened),"Closing archive preserves editor copy");File.WriteAllText(opened,"edited copy");
                await OpenArchive(zip);GoFolder("本地文件/");Assert(Json.Num(entries.Single(e=>Json.Str(e,"name")=="大文本.txt"),"size")>10L*1024*1024,"External editing does not write back");
                checks.Add("directory/parent browsing and double-click of a 12 MiB text file: exact selected bytes, local editor request, retained independent copy");
                SelectByName("图片.png");var enter=new KeyEventArgs(Keys.Enter);typeof(Control).GetMethod("OnKeyDown",System.Reflection.BindingFlags.Instance|System.Reflection.BindingFlags.NonPublic).Invoke(files,new object[]{enter});await WaitFor(()=>launches.Count==2,"Enter local opening");
                Assert(enter.Handled&&enter.SuppressKeyPress&&launches[1].UseShellExecute&&launches[1].Verb=="open"&&File.Exists(launches[1].FileName),"Image Enter routes to default app");
                SelectByName("脚本.js");await OpenEntry();Assert(launches.Count==3&&launches[2].FileName.EndsWith("notepad.exe",StringComparison.OrdinalIgnoreCase),"Scripts open as text");
                SelectByName("程序.exe");bool blocked=false;try{await OpenEntry();}catch(ArchiveError){blocked=true;}Assert(blocked&&launches.Count==3,"Runnable files require manual extraction");
                Assert(commands["preview"].Text.Contains("内置内容")&&commands.ContainsKey("open-entry"),"Separate browser opening and optional content preview labels");
                checks.Add("Enter uses default local app request, scripts use local text editor, embedded content preview remains explicit");
                int retained=Directory.GetDirectories(OpenedFilesRoot(preferences)).Length;SelectByName("大文本.txt");localFileLauncher=info=>{throw new System.ComponentModel.Win32Exception(1155);};bool failed=false;try{await OpenEntry();}catch(ArchiveError error){failed=error.Message.Contains("默认应用");}Assert(failed&&Directory.GetDirectories(OpenedFilesRoot(preferences)).Length==retained,"Failed launch cleans temporary copy");
                localFileLauncher=info=>launches.Add(info);bool cancelledOnce=false;Action<string,object> cancelQueued=(name,value)=>{if(name=="jobs"&&!cancelledOnce){cancelledOnce=true;backend.CancelAll();}};
                backend.Changed+=cancelQueued;bool cancelled=false;try{await OpenEntry();}catch(OperationCanceledException){cancelled=true;}finally{backend.Changed-=cancelQueued;}
                Assert(cancelled&&launches.Count==3&&Directory.GetDirectories(OpenedFilesRoot(preferences)).Length==retained,"Queued cancellation completes without launching and cleans temporary copy");
                checks.Add("missing association and queued cancellation clean unlaunched copies without hanging or launching");
                Screenshot(output,"local-file-browser");
            }finally{localFileLauncher=originalLauncher;preferences.Values["customTemp"]=customTemp;preferences.Values["tempPath"]=tempPath;}
        }
        void SelectByName(string name){files.SelectedIndices.Clear();int index=visible.FindIndex(e=>Json.Str(e,"name")==name);Assert(index>=0,"Missing item "+name);files.SelectedIndices.Add(index);}
        static System.Windows.Forms.Timer FillDialog(string title,Action<Form> action){var timer=new System.Windows.Forms.Timer{Interval=80};timer.Tick+=(s,e)=>{var form=Application.OpenForms.Cast<Form>().FirstOrDefault(f=>f.Text==title);if(form==null)return;timer.Stop();try{action(form);}catch{form.DialogResult=DialogResult.Cancel;throw;}};timer.Start();return timer;}
        static void ScreenshotForm(Form form,string root,string name){using(var bitmap=new Bitmap(form.Width,form.Height)){form.DrawToBitmap(bitmap,new Rectangle(Point.Empty,form.Size));bitmap.Save(Path.Combine(root,name+".png"));}}
    }
}
