using System;
using System.IO;
using System.IO.Compression;
using System.Linq;
using System.Reflection;
using System.Text;
using System.Threading;
using System.Windows.Forms;

namespace NZIP {
    static class SfxProgram {
        [STAThread]static int Main(string[] args){
            AppContext.SetSwitch("Switch.System.IO.UseLegacyPathHandling",false);AppContext.SetSwitch("Switch.System.IO.BlockLongPaths",false);Application.EnableVisualStyles();
            if(args.Length==1&&args[0]=="--licenses"){var notice=new StringBuilder("NZIP SFX extraction module\r\nSource: https://github.com/guiqingle520/NZIP\r\n7-Zip source: https://www.7-zip.org/download.html\r\n\r\n");foreach(var name in new[]{"NZIP-LICENSE","7ZIP-LICENSE","7ZIP-LGPL"})using(var stream=Assembly.GetExecutingAssembly().GetManifestResourceStream(name))using(var reader=new StreamReader(stream,Encoding.UTF8))notice.AppendLine(reader.ReadToEnd());using(var form=new Form{Text="NZIP SFX licenses",Width=760,Height=540,StartPosition=FormStartPosition.CenterScreen}){form.Controls.Add(new TextBox{Text=notice.ToString(),ReadOnly=true,Multiline=true,WordWrap=false,ScrollBars=ScrollBars.Both,Dock=DockStyle.Fill});Application.Run(form);}return 0;}
            string destination=null,password="";for(int i=0;i<args.Length;i++){if(args[i]=="--extract"&&i+1<args.Length)destination=args[++i];else if(args[i]=="--password"&&i+1<args.Length)password=args[++i];else return 2;}
            try{
                if(destination==null)using(var choose=new FolderBrowserDialog{Description="NZIP 自解压 / Extract to a new folder",ShowNewFolderButton=true}){if(choose.ShowDialog()!=DialogResult.OK)return 0;destination=Path.Combine(choose.SelectedPath,Path.GetFileNameWithoutExtension(Application.ExecutablePath));}
                using(var work=new TempFolder(Path.GetTempPath(),"nzip-sfx-")){
                    foreach(var name in new[]{"7z.exe","7z.dll"})using(var resource=Assembly.GetExecutingAssembly().GetManifestResourceStream(name+".gz"))using(var gzip=new GZipStream(resource,CompressionMode.Decompress))using(var output=System.IO.File.Create(Path.Combine(work.Path,name)))gzip.CopyTo(output);
                    string archive=Path.Combine(work.Path,"payload.7z");using(var input=System.IO.File.OpenRead(Application.ExecutablePath)){
                        if(input.Length<24)throw new InvalidDataException("Invalid NZIP SFX");input.Position=input.Length-24;var reader=new BinaryReader(input);long count=reader.ReadInt64();if(!reader.ReadBytes(16).SequenceEqual(Encoding.ASCII.GetBytes("NZIP-SFX-0000001"))||count<32||count>input.Length-24)throw new InvalidDataException("Invalid NZIP SFX payload");input.Position=input.Length-24-count;
                        using(var output=System.IO.File.Create(archive)){var buffer=new byte[65536];while(count>0){int n=input.Read(buffer,0,(int)Math.Min(buffer.Length,count));if(n==0)throw new EndOfStreamException();output.Write(buffer,0,n);count-=n;}}
                    }
                    var engine=new ArchiveEngine(Path.Combine(work.Path,"7z.exe"));try{engine.Extract(Json.Obj("archive",archive,"destination",destination,"password",password),CancellationToken.None);}
                    catch(ArchiveError error){if(error.Code!="PASSWORD_REQUIRED"||args.Length!=0)throw;using(var dialog=new Form{Text="NZIP password",Width=420,Height=150,StartPosition=FormStartPosition.CenterScreen}){var secret=new TextBox{UseSystemPasswordChar=true,Dock=DockStyle.Top};var confirm=new Button{Text="OK",Dock=DockStyle.Bottom,DialogResult=DialogResult.OK};dialog.Controls.Add(secret);dialog.Controls.Add(confirm);dialog.AcceptButton=confirm;if(dialog.ShowDialog()!=DialogResult.OK)return 1;engine.Extract(Json.Obj("archive",archive,"destination",destination,"password",secret.Text),CancellationToken.None);secret.Clear();}}
                }
                if(args.Length==0)MessageBox.Show("解压完成 / Extraction complete","NZIP");return 0;
            }catch(Exception error){if(args.Length==0)MessageBox.Show(error.Message,"NZIP",MessageBoxButtons.OK,MessageBoxIcon.Error);return 1;}
        }
    }
}
