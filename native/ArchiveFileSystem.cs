using System;
using System.Collections.Generic;
using System.IO;
using System.Linq;
using System.Text;

namespace NZIP {
    // Keep public paths normal; use explicit extended paths only at Windows I/O boundaries.
    // This works without changing the machine-wide LongPathsEnabled policy.
    internal static class ArchivePath {
        public static string Native(string path){
            string full=Path.GetFullPath(path).Replace('/','\\');
            if(full.StartsWith(@"\\?\",StringComparison.Ordinal))return full;
            if(full.StartsWith(@"\\",StringComparison.Ordinal))return @"\\?\UNC\"+full.Substring(2);
            return @"\\?\"+full;
        }
        public static string Display(string path){
            if(path.StartsWith(@"\\?\UNC\",StringComparison.OrdinalIgnoreCase))return @"\\"+path.Substring(8);
            return path.StartsWith(@"\\?\",StringComparison.Ordinal)?path.Substring(4):path;
        }
    }
    internal static class ArchiveFile {
        public static bool Exists(string path){try{return !String.IsNullOrEmpty(path)&&File.Exists(ArchivePath.Native(path));}catch(ArgumentException){return false;}catch(NotSupportedException){return false;}catch(PathTooLongException){return false;}catch(System.Security.SecurityException){return false;}}
        public static FileAttributes GetAttributes(string path){return File.GetAttributes(ArchivePath.Native(path));}
        public static FileStream OpenRead(string path){return File.OpenRead(ArchivePath.Native(path));}
        public static FileStream Create(string path){return File.Create(ArchivePath.Native(path));}
        public static byte[] ReadAllBytes(string path){return File.ReadAllBytes(ArchivePath.Native(path));}
        public static string ReadAllText(string path){return File.ReadAllText(ArchivePath.Native(path));}
        public static string ReadAllText(string path,Encoding encoding){return File.ReadAllText(ArchivePath.Native(path),encoding);}
        public static string[] ReadAllLines(string path,Encoding encoding){return File.ReadAllLines(ArchivePath.Native(path),encoding);}
        public static void WriteAllBytes(string path,byte[] bytes){File.WriteAllBytes(ArchivePath.Native(path),bytes);}
        public static void WriteAllText(string path,string text){File.WriteAllText(ArchivePath.Native(path),text);}
        public static void WriteAllText(string path,string text,Encoding encoding){File.WriteAllText(ArchivePath.Native(path),text,encoding);}
        public static void Copy(string source,string destination){File.Copy(ArchivePath.Native(source),ArchivePath.Native(destination));}
        public static void Copy(string source,string destination,bool overwrite){File.Copy(ArchivePath.Native(source),ArchivePath.Native(destination),overwrite);}
        public static void Move(string source,string destination){File.Move(ArchivePath.Native(source),ArchivePath.Native(destination));}
        public static void Delete(string path){File.Delete(ArchivePath.Native(path));}
        public static void Replace(string source,string destination,string backup){File.Replace(ArchivePath.Native(source),ArchivePath.Native(destination),backup==null?null:ArchivePath.Native(backup));}
    }
    internal static class ArchiveDirectory {
        public static bool Exists(string path){try{return !String.IsNullOrEmpty(path)&&Directory.Exists(ArchivePath.Native(path));}catch(ArgumentException){return false;}catch(NotSupportedException){return false;}catch(PathTooLongException){return false;}catch(System.Security.SecurityException){return false;}}
        public static void CreateDirectory(string path){Directory.CreateDirectory(ArchivePath.Native(path));}
        public static void Delete(string path,bool recursive){Directory.Delete(ArchivePath.Native(path),recursive);}
        public static void Move(string source,string destination){Directory.Move(ArchivePath.Native(source),ArchivePath.Native(destination));}
        public static DirectoryInfo GetParent(string path){return Directory.GetParent(path);}
        public static IEnumerable<string> EnumerateFileSystemEntries(string path){return Directory.EnumerateFileSystemEntries(ArchivePath.Native(path)).Select(ArchivePath.Display);}
        public static string[] GetFiles(string path){return Directory.GetFiles(ArchivePath.Native(path)).Select(ArchivePath.Display).ToArray();}
        public static string[] GetFiles(string path,string pattern,SearchOption option){return Directory.GetFiles(ArchivePath.Native(path),pattern,option).Select(ArchivePath.Display).ToArray();}
        public static string[] GetDirectories(string path){return Directory.GetDirectories(ArchivePath.Native(path)).Select(ArchivePath.Display).ToArray();}
    }
}
