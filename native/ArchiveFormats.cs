using System;
using System.IO;
using System.Linq;

namespace NZIP {
    public static class ArchiveFormats {
        public static readonly string[] CreateFormats={"zip","7z","tar","tar.gz","tar.bz2","tar.xz","gz","bz2","xz","wim"};
        public static readonly string[] ReadExtensions={"zip","7z","rar","r00","tar","gz","gzip","bz2","bzip2","xz","lzma","lzma86","zst","zstd","z","tgz","tpz","tbz","tbz2","txz","tzst","taz","tlz","001","zipx","jar","war","ear","apk","apks","xpi","epub","ipa","appx","appxbundle","msix","msixbundle","cbz","cbr","cb7","cbt","iso","udf","img","cab","wim","swm","esd","arj","lzh","lha","cpio","ar","deb","udeb","rpm","xar","pkg","dmg","chm","msi","msp","vhd","vhdx","vmdk","vdi","qcow","qcow2","squashfs"};
        public static string OpenFilter {get{return "压缩文件与镜像|"+String.Join(";",ReadExtensions.Select(e=>"*."+e))+"|所有文件|*.*";}}
        public static string Normalize(string format){switch((format??"").ToLowerInvariant()){case "gzip":return "gz";case "bzip2":return "bz2";case "tgz":return "tar.gz";case "tbz":case "tbz2":return "tar.bz2";case "txz":return "tar.xz";default:return (format??"").ToLowerInvariant();}}
        public static bool SingleFile(string format){return new[]{"gz","bz2","xz"}.Contains(format);}
        public static bool Password(string format){return format=="zip"||format=="7z";}
        public static bool Volumes(string format){return Password(format);}
        public static string EngineType(string format){switch(format){case "gz":return "gzip";case "bz2":return "bzip2";default:return format;}}
        public static bool CompoundTar(string path){string name=Path.GetFileName(path).ToLowerInvariant();return new[]{".tar.gz",".tar.bz2",".tar.xz",".tar.zst",".tar.zstd",".tar.z",".tar.lzma",".tgz",".tpz",".tbz",".tbz2",".txz",".tzst",".taz",".tlz"}.Any(name.EndsWith);}
        public static string Stem(string path){string name=Path.GetFileName(path);if(name.EndsWith(".001",StringComparison.OrdinalIgnoreCase))name=Path.GetFileNameWithoutExtension(name);string stem=Path.GetFileNameWithoutExtension(name);if(CompoundTar(name)&&stem.EndsWith(".tar",StringComparison.OrdinalIgnoreCase))stem=Path.GetFileNameWithoutExtension(stem);return stem;}
        public static string ChangeFormat(string path,string format){if(String.IsNullOrWhiteSpace(path))return path;string directory=Path.GetDirectoryName(path)??"";string name=Path.GetFileName(path);foreach(string ext in CreateFormats.OrderByDescending(s=>s.Length)){if(name.EndsWith("."+ext,StringComparison.OrdinalIgnoreCase)){name=name.Substring(0,name.Length-ext.Length-1);return Path.Combine(directory,name+"."+format);}}return Path.ChangeExtension(path,format);}
    }
}
