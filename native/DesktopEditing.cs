using System;
using System.Collections.Generic;
using System.Diagnostics;
using System.IO;
using System.Linq;
using System.Threading;
using System.Threading.Tasks;
using System.Windows.Forms;
using File=NZIP.ArchiveFile;

namespace NZIP {
    public sealed partial class DesktopWindow {
        sealed class EditSession {
            public TempFolder Temporary;public Process Editor;
            public string Archive,Entry,LocalPath,OriginalHash,Password;public int CodePage;
            public bool Eligible,Finished,Preserve;
        }
        readonly List<EditSession> editSessions=new List<EditSession>();
        readonly System.Windows.Forms.Timer editTimer=new System.Windows.Forms.Timer{Interval=500};
        bool checkingEdits,editingDisposed,closingAfterEdits;
        Func<EditSession,bool> confirmWriteBack;
        void InitializeEditing(){
            confirmWriteBack=ConfirmArchiveEdit;
            editTimer.Tick+=async(s,e)=>await CheckEditedFiles();editTimer.Start();
        }
        bool ConfirmArchiveEdit(EditSession session){
            using(var dialog=new EditorDialog("更新压缩包",300)){
                dialog.Note("文件已修改。是否将修改后的文件保存到原压缩包？");
                dialog.TextField("压缩包",session.Archive,"edit-archive").ReadOnly=true;
                dialog.TextField("包内文件",session.Entry,"edit-entry").ReadOnly=true;
                dialog.Confirm.Text="是";dialog.Confirm.DialogResult=DialogResult.Yes;dialog.Cancel.Text="否";dialog.Cancel.DialogResult=DialogResult.No;dialog.AcceptButton=dialog.Cancel;
                return dialog.ShowDialog(this)==DialogResult.Yes;
            }
        }
        async Task CheckEditedFiles(){
            if(checkingEdits||closing||exitPending)return;checkingEdits=true;
            try{
                foreach(var session in editSessions.Where(s=>!s.Finished&&s.Eligible&&s.Editor!=null).ToArray()){
                    if(closing||exitPending)break;
                    bool exited;try{exited=session.Editor.HasExited;}catch(InvalidOperationException){session.Preserve=true;session.Finished=true;continue;}catch(System.ComponentModel.Win32Exception){session.Preserve=true;session.Finished=true;continue;}
                    if(!exited)continue;session.Finished=true;session.Editor.Dispose();session.Editor=null;
                    try{
                        string hash=await Task.Run(()=>ArchiveEdits.Fingerprint(session.LocalPath,CancellationToken.None));
                        if(hash==session.OriginalHash||closing||exitPending)continue;
                        if(!confirmWriteBack(session))continue;
                        bool current=archive!=null&&String.Equals(Json.Str(archive,"path"),session.Archive,StringComparison.OrdinalIgnoreCase);if(current)ReleaseArchive();
                        try{
                            await backend.WriteBackForOpen(Json.Obj("archive",session.Archive,"entry",session.Entry,"source",session.LocalPath,"originalHash",session.OriginalHash,"password",session.Password,"codePage",session.CodePage));
                            message.Text="编辑后的文件已写回压缩包";
                            if(archive!=null&&String.Equals(Json.Str(archive,"path"),session.Archive,StringComparison.OrdinalIgnoreCase)&&!closing&&!exitPending){string location=folder;await OpenArchive(session.Archive,password,codePage);GoFolder(nodes.ContainsKey(location)?location:"");}
                        }finally{if(!closing&&!backend.Busy)AcquireArchive();}
                    }catch(Exception error){
                        session.Preserve=true;string detail=error.Message+"\r\n\r\n编辑后的文件已保留，可从这里找回：\r\n"+session.LocalPath;message.Text=detail;
                        if(Environment.GetEnvironmentVariable("NZIP_TEST_MODE")!="1")MessageBox.Show(this,detail,"未能写回压缩包",MessageBoxButtons.OK,MessageBoxIcon.Warning);
                    }
                }
            }finally{checkingEdits=false;}
        }
        bool HasRunningEditors(){
            foreach(var session in editSessions.Where(s=>!s.Finished)){
                if(session.Editor==null){if(session.Eligible)return true;continue;}
                try{if(!session.Editor.HasExited)return true;}catch(InvalidOperationException){}catch(System.ComponentModel.Win32Exception){}
            }return false;
        }
        async Task FinishClosingEdits(){
            while(checkingEdits)await Task.Delay(30);
        }
        void CleanupOpenedFiles(){
            if(editingDisposed)return;editingDisposed=true;
            editTimer.Stop();editTimer.Dispose();
            foreach(var session in editSessions){if(session.Editor!=null){session.Editor.Dispose();session.Editor=null;}if(!session.Preserve)session.Temporary.Dispose();session.Password="";}
            editSessions.Clear();
        }
    }
}
