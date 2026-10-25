using System;
using System.Runtime.InteropServices;
using System.Runtime.InteropServices.ComTypes;
using System.Threading;
using System.Windows.Forms;

namespace NZIP {
    [ComVisible(true),Guid("3D8B0590-F691-11D2-8EA9-006097DF5BD4"),InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
    public interface IDataObjectAsyncCapability {
        [PreserveSig]int SetAsyncMode([MarshalAs(UnmanagedType.Bool)]bool enabled);
        [PreserveSig]int GetAsyncMode([MarshalAs(UnmanagedType.Bool)]out bool enabled);
        [PreserveSig]int StartOperation(IBindCtx reserved);
        [PreserveSig]int InOperation([MarshalAs(UnmanagedType.Bool)]out bool active);
        [PreserveSig]int EndOperation(int result,IBindCtx reserved,uint effects);
    }
    [ComVisible(true),ClassInterface(ClassInterfaceType.None)]
    public sealed class ExportDataObject:DataObject,IDataObjectAsyncCapability {
        int active;bool enabled=true;
        internal readonly TempFolder Temporary;
        internal Action Completed;
        internal ExportDataObject(TempFolder temporary){Temporary=temporary;}
        internal bool Active{get{return Interlocked.CompareExchange(ref active,0,0)!=0;}}
        public int SetAsyncMode(bool value){enabled=value;return 0;}
        public int GetAsyncMode(out bool value){value=enabled;return 0;}
        public int StartOperation(IBindCtx reserved){Interlocked.Exchange(ref active,1);return 0;}
        public int InOperation(out bool value){value=Active;return 0;}
        public int EndOperation(int result,IBindCtx reserved,uint effects){Interlocked.Exchange(ref active,0);var completed=Completed;Completed=null;if(completed!=null)completed();return 0;}
    }
}
