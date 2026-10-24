using System;
using System.IO;
using System.Collections.Generic;
using System.Linq;
using System.Threading;
using NZIP;
using J=System.Collections.Generic.Dictionary<string,object>;

static class ListingTests {
    static int checks;
    const string Header="7-Zip fixture\r\n--\r\nType = zip\r\n----------\r\n";
    static string Entry(string path,string extra=""){return "Path = "+path+"\r\nFolder = -\r\nSize = 12\r\nPacked Size = 8\r\nModified = 2026-01-01 00:00:00\r\nMethod = Deflate\r\nCRC = AABBCCDD\r\nAttributes = A\r\n"+extra+"\r\n";}
    static void Check(bool value,string message){if(!value)throw new Exception(message);checks++;}
    static void Reject(Action action,string code){bool rejected=false;try{action();}catch(ArchiveError error){rejected=error.Code==code;}Check(rejected,"Expected "+code);}
    sealed class ShortReader:TextReader {
        readonly string text;int offset;
        public ShortReader(string text){this.text=text;}
        public override int Read(char[] buffer,int start,int count){int n=Math.Min(Math.Min(count,3),text.Length-offset);text.CopyTo(offset,buffer,start,n);offset+=n;return n;}
    }
    sealed class EndlessReader:TextReader {
        readonly string header=Header;readonly string body="Comment = "+new string('x',200)+"\n";int offset;public long ReadCount;
        public override int Read(char[] buffer,int start,int count){for(int i=0;i<count;i++){buffer[start+i]=offset<header.Length?header[offset]:body[(offset-header.Length)%body.Length];offset++;}ReadCount+=count;return count;}
    }
    static void Main(){
        string text=Header+Entry("目录/one.txt")+Entry("目录/two.txt").TrimEnd('\r','\n');
        var data=ArchiveEngine.ParseList(new ShortReader(text),"sample.zip",CancellationToken.None);var entries=Json.Array(Json.Get(data,"entries")).Select(Json.Map).ToArray();
        Check(Json.Str(data,"type")=="zip"&&entries.Length==2,"Fragmented CRLF and EOF parse");Check(Json.Num(data,"totalSize")==24&&Json.Bool(data,"totalSizeKnown"),"Sizes remain consistent");
        Check(Json.Str(entries[0],"path")=="目录/one.txt"&&Json.Str(entries[0],"name")=="one.txt","Unicode hierarchy preserved");
        Check(Object.ReferenceEquals(entries[0]["method"],entries[1]["method"])&&Object.ReferenceEquals(entries[0]["modified"],entries[1]["modified"]),"Repeated metadata strings shared within a listing");
        foreach(string bad in new[]{"../escape.txt","/absolute.txt","C:/escape.txt","a/CON.txt","a/../escape.txt","control\rname.txt"})Reject(()=>ArchiveEngine.ParseList(Header+Entry(bad)),"UNSAFE_PATH");
        Reject(()=>ArchiveEngine.ParseList(Header+Entry("same.txt")+Entry("SAME.TXT")),"UNSAFE_PATH");
        Reject(()=>ArchiveEngine.ParseList(Header+Entry("link","Symbolic Link = ../target\r\n")),"UNSAFE_PATH");
        Reject(()=>ArchiveEngine.ParseList(Header+Entry("link","Hard Link = other\r\n")),"UNSAFE_PATH");
        Reject(()=>ArchiveEngine.ParseList(Header+Entry("link","Attributes = lrwxrwxrwx\r\n")),"UNSAFE_PATH");
        Reject(()=>ArchiveEngine.ParseList("invalid listing"),"ARCHIVE_ERROR");
        Reject(()=>ArchiveEngine.ParseList(Header+"Comment = "+new string('x',128*1024)),"LISTING_LIMIT");
        var endless=new EndlessReader();Reject(()=>ArchiveEngine.ParseList(endless,"sample.zip",CancellationToken.None),"LISTING_LIMIT");Check(endless.ReadCount<=64L*1024*1024+8192,"Total budget enforced without reading unbounded output");
        var cancel=new CancellationTokenSource();cancel.Cancel();bool cancelled=false;try{ArchiveEngine.ParseList(new StringReader(text),"sample.zip",cancel.Token);}catch(OperationCanceledException){cancelled=true;}Check(cancelled,"Listing cancellation preserved");cancel.Dispose();
        var unknown=ArchiveEngine.ParseList("Type = gzip\n----------\nPath = \nFolder = -\nPacked Size = 20\n\n","hello.txt.gz");Check(Json.Str(Json.Map(Json.Array(Json.Get(unknown,"entries"))[0]),"path")=="hello.txt"&&!Json.Bool(unknown,"totalSizeKnown"),"Unknown-size single stream fallback preserved");
        ArchiveEngine.AllowLongPaths=false;Reject(()=>ArchiveEngine.ParseList(Header+Entry(new string('a',245)+".txt")),"ARCHIVE_ERROR");ArchiveEngine.AllowLongPaths=true;
        Console.WriteLine("Streaming listing checks passed: "+checks);
    }
}
