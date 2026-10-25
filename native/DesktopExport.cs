using System;
using System.Collections.Specialized;
using System.IO;
using System.Linq;
using System.Threading.Tasks;
using System.Windows.Forms;

namespace NZIP {
    public sealed partial class DesktopWindow {
        bool exporting;
        readonly System.Collections.Generic.List<ExportDataObject> dragObjects=new System.Collections.Generic.List<ExportDataObject>();
        bool CanCleanupExport(TempFolder temporary){return !dragObjects.Any(data=>Object.ReferenceEquals(data.Temporary,temporary)&&data.Active);}
        internal Func<IDataObject,DragDropEffects,DragDropEffects> dragFiles;
        internal async Task ExportDrag(){
            if(exporting||archive==null||SelectedPaths().Length==0)return;exporting=true;
            var temporary=new TempFolder(preferences.TemporaryRoot,"nzip-drag-");
            try{
                var selected=Selected().ToArray();var p=Payload();string destination=Path.Combine(temporary.Path,"files");p["destination"]=destination;p["selected"]=selected.Select(e=>Json.Str(e,"path")).ToArray();
                message.Text=I18n.T("正在准备拖出文件…");await backend.ExtractForOpen(p);if(closing||IsDisposed){temporary.Dispose();return;}
                var paths=new StringCollection();foreach(var entry in selected){string name=Json.Str(entry,"path");if(selected.Any(other=>other!=entry&&Json.Bool(other,"isDirectory")&&name.StartsWith(Json.Str(other,"path").TrimEnd('/')+"/",StringComparison.Ordinal)))continue;paths.Add(Path.GetFullPath(Path.Combine(destination,name.Replace('/',Path.DirectorySeparatorChar))));}
                var data=new ExportDataObject(temporary);data.Completed=()=>Ui(()=>dragObjects.Remove(data));dragObjects.Add(data);data.SetFileDropList(paths);data.SetData("Preferred DropEffect",new MemoryStream(BitConverter.GetBytes((int)DragDropEffects.Copy)));clipboardFolders.Add(temporary);
                if(dragFiles!=null)dragFiles(data,DragDropEffects.Copy);else files.DoDragDrop(data,DragDropEffects.Copy);
                message.Text=I18n.T("拖出文件按复制处理，压缩包保留原文件");
            }catch{if(CanCleanupExport(temporary))temporary.Dispose();throw;}finally{dragObjects.RemoveAll(data=>!data.Active);exporting=false;}
        }
    }
}
