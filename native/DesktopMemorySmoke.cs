using System;
using System.Collections.Generic;
using System.Diagnostics;
using System.IO;
using System.Linq;
using System.Runtime.CompilerServices;
using System.Runtime.InteropServices;
using System.Threading;
using System.Threading.Tasks;
using File=NZIP.ArchiveFile;
using Directory=NZIP.ArchiveDirectory;

namespace NZIP {
    using J=Dictionary<string,object>;
    public sealed partial class DesktopWindow {
        [DllImport("user32.dll")]static extern uint GetGuiResources(IntPtr process,uint flags);
        J MemorySnapshot(string stage){
            GC.Collect();GC.WaitForPendingFinalizers();GC.Collect();
            using(var process=Process.GetCurrentProcess())return Json.Obj("stage",stage,"privateBytes",process.PrivateMemorySize64,"workingSetBytes",process.WorkingSet64,"managedAfterGcBytes",GC.GetTotalMemory(false),"gdiHandles",GetGuiResources(process.Handle,0),"userHandles",GetGuiResources(process.Handle,1),"entries",entries.Count,"rows",visible.Count,"treeIndex",nodes.Count,"completedIds",completed.Count);
        }
        [MethodImpl(MethodImplOptions.NoInlining)]WeakReference[] ListingReferences(){return new[]{new WeakReference(archive),new WeakReference(entries[0]),new WeakReference(tree.Nodes[0])};}
        internal async Task RunMemorySmoke(string configPath){
            var config=Json.Decode(File.ReadAllText(configPath));string output=Json.Str(config,"output");Directory.CreateDirectory(output);var samples=new List<J>();var checks=new List<string>();
            try{
                preferences.Values["modalProgress"]=false;preferences.Values["openAfterExtract"]=false;preferences.Values["autoExpand"]=false;ApplyPreferences();
                samples.Add(MemorySnapshot("home"));
                var manifest=Json.Decode(File.ReadAllText(Json.Str(config,"manifest")));var fixture=Json.Array(Json.Get(manifest,"listings")).Select(Json.Map).OrderByDescending(f=>Json.Num(f,"entries")).First();string archivePath=Json.Str(fixture,"archive");
                for(int pass=0;pass<10;pass++){
                    var watch=Stopwatch.StartNew();await OpenArchive(archivePath);Assert(archive!=null&&entries.Count==Json.Num(fixture,"entries"),"Large ZIP directory loaded completely");
                    var loaded=MemorySnapshot("loaded-"+pass);loaded["elapsedMs"]=watch.ElapsedMilliseconds;samples.Add(loaded);
                    GoFolder("目录-0500/");Assert(visible.Count==101,"Indexed list preserves directory children and parent navigation");
                    search.Text="文件-050001.txt";Assert(visible.Count==1,"Search matches the correct large-list entry");search.Text="";
                    var references=ListingReferences();ShowHome();await Task.Delay(40);samples.Add(MemorySnapshot("closed-"+pass));
                    Assert(archive==null&&entries.Count==0&&visible.Count==0&&nodes.Count==0&&files.VirtualListSize==0,"Close releases every listing model and directory index");
                    Assert(references.All(reference=>!reference.IsAlive),"Closed archive, entry and tree root are collectable");
                }
                checks.Add("100,000-entry ZIP: ten complete open, directory navigation, exact search and close cycles; old model objects collected after each close");
                var large=Json.Map(Json.Get(manifest,"large"));string largeArchive=Json.Str(large,"archive");
                await OpenArchive(largeArchive);Assert(entries.Count==1&&Json.Num(entries[0],"size")==Json.Num(large,"bytes"),"256 MiB file metadata retained without content loading");
                samples.Add(MemorySnapshot("large-file-listing"));int notifications=0;Action<string,object> changed=(name,value)=>{if(name=="jobs")Interlocked.Increment(ref notifications);};backend.Changed+=changed;
                try{
                    var p=Payload();p["destination"]=Path.Combine(output,"large-extracted");p["preallocate"]=true;await backend.ExtractForOpen(p);
                    string extracted=Path.Combine(Json.Str(p,"destination"),Path.GetFileName(Json.Str(large,"source")));
                    Assert(await Task.Run(()=>ArchiveEdits.Fingerprint(extracted,CancellationToken.None))==Json.Str(large,"sha256"),"Real 256 MiB preallocated extraction preserves SHA-256");
                    Assert(notifications>0,"Task notifications delivered");var job=backend.SnapshotJobs().First();Assert(Json.Str(job,"status")=="completed"&&Json.Num(job,"percent")==100&&Json.Num(job,"finishedAt")>0&&!backend.Busy,"Terminal snapshot includes result, finish time and an idle worker");
                }finally{backend.Changed-=changed;}
                var taskSample=MemorySnapshot("large-extracted");taskSample["jobNotifications"]=notifications;samples.Add(taskSample);ShowHome();
                checks.Add("256 MiB stored ZIP: one-entry browsing, preallocation, real extraction SHA-256, progress delivery and consistent terminal job snapshot");
                await Task.Delay(80);samples.Add(MemorySnapshot("finished"));
                var closed=samples.Where(s=>Json.Str(s,"stage").StartsWith("closed-")).ToArray();long first=Json.Num(closed[0],"managedAfterGcBytes"),last=Json.Num(closed.Last(),"managedAfterGcBytes");
                Assert(last-first<8L*1024*1024,"Repeated closes do not retain growing listing heaps");
                Assert(Json.Num(closed.Last(),"gdiHandles")-Json.Num(closed[0],"gdiHandles")<20&&Json.Num(closed.Last(),"userHandles")-Json.Num(closed[0],"userHandles")<20,"GDI and USER handles remain bounded across listing cycles");
                File.WriteAllText(Path.Combine(output,"result.json"),Json.Encode(Json.Obj("ok",true,"checks",checks,"samples",samples,"method","WinForms process; forced GC snapshots verify retained references only, not natural working-set peaks. No OS cache flush. Full files and archives are real isolated fixtures.")));
            }catch(Exception error){Environment.ExitCode=1;File.WriteAllText(Path.Combine(output,"result.json"),Json.Encode(Json.Obj("ok",false,"error",error.ToString(),"checks",checks,"samples",samples)));}
            finally{Close();}
        }
    }
}
