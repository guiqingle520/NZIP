using System;
using System.Collections.Generic;
using System.IO;
using System.Linq;
using System.Net;
using System.Net.Http;
using System.Reflection;
using System.Security.Cryptography;
using System.Text;
using System.Threading;
using System.Threading.Tasks;

namespace NZIP {
    using J=Dictionary<string,object>;
    public static class UpdateClient {
        internal static Func<HttpMessageHandler> HandlerFactory=()=>new HttpClientHandler{AllowAutoRedirect=false};
        public static J Trust(){using(var stream=Assembly.GetExecutingAssembly().GetManifestResourceStream("updates-public.json"))using(var reader=new StreamReader(stream,Encoding.UTF8))return Json.Decode(reader.ReadToEnd());}
        static byte[] Decode(string value){string text=value.Replace('-','+').Replace('_','/');return Convert.FromBase64String(text.PadRight((text.Length+3)/4*4,'='));}
        public static J Verify(string envelope,J trust,string product,Version current){
            if(envelope.Length>262144)throw new ArchiveError("更新清单过大");var data=Json.Decode(envelope);if(Json.Str(data,"keyId")!=Json.Str(trust,"keyId"))throw new ArchiveError("更新签名密钥不受信任");byte[] payload=Decode(Json.Str(data,"payload")),signature=Decode(Json.Str(data,"signature"));
            using(var rsa=new RSACryptoServiceProvider()){rsa.PersistKeyInCsp=false;rsa.ImportParameters(new RSAParameters{Modulus=Decode(Json.Str(trust,"modulus")),Exponent=Decode(Json.Str(trust,"exponent"))});if(rsa.KeySize<3072||!rsa.VerifyData(payload,CryptoConfig.MapNameToOID("SHA256"),signature))throw new ArchiveError("更新签名校验失败");}
            var release=Json.Decode(new UTF8Encoding(false,true).GetString(payload));Version version;if(Json.Str(release,"product")!=product||!Version.TryParse(Json.Str(release,"version"),out version)||version<=current)throw new ArchiveError("更新版本或产品不匹配");
            if(Json.Num(release,"size")<1024||Json.Num(release,"size")>128L*1024*1024||!System.Text.RegularExpressions.Regex.IsMatch(Json.Str(release,"sha256"),"^[a-f0-9]{64}$"))throw new ArchiveError("更新文件信息无效");
            var uri=new Uri(Json.Str(release,"url"));if(uri.Scheme!="https"||uri.Host!="github.com"||!uri.AbsolutePath.StartsWith("/"+Json.Str(trust,"repository")+"/releases/download/",StringComparison.Ordinal)||!uri.AbsolutePath.EndsWith(".msi",StringComparison.OrdinalIgnoreCase)||!String.IsNullOrEmpty(uri.UserInfo)||!String.IsNullOrEmpty(uri.Query)||!String.IsNullOrEmpty(uri.Fragment))throw new ArchiveError("更新下载地址不受信任");return release;
        }
        static bool Allowed(Uri uri){return uri.Scheme=="https"&&String.IsNullOrEmpty(uri.UserInfo)&&(uri.Host=="github.com"||uri.Host=="api.github.com"||uri.Host=="release-assets.githubusercontent.com"||uri.Host=="objects.githubusercontent.com");}
        static async Task<HttpResponseMessage> Open(HttpClient client,string url,CancellationToken cancel){
            var uri=new Uri(url);for(int hop=0;hop<6;hop++){
                if(!Allowed(uri))throw new ArchiveError("更新请求重定向到不受信任的地址");var response=await client.GetAsync(uri,HttpCompletionOption.ResponseHeadersRead,cancel).ConfigureAwait(false);
                if((int)response.StatusCode>=300&&(int)response.StatusCode<400){var location=response.Headers.Location;response.Dispose();if(location==null)throw new ArchiveError("更新重定向无效");uri=location.IsAbsoluteUri?location:new Uri(uri,location);continue;}
                if(response.StatusCode==HttpStatusCode.NotFound){response.Dispose();throw new ArchiveError("GitHub 暂无可访问的发布版本，请确认仓库公开且已发布更新清单");}try{response.EnsureSuccessStatusCode();return response;}catch{response.Dispose();throw;}
            }throw new ArchiveError("更新重定向过多");
        }
        static HttpClient Client(){ServicePointManager.SecurityProtocol|=SecurityProtocolType.Tls12;var client=new HttpClient(HandlerFactory()){Timeout=TimeSpan.FromSeconds(60)};client.DefaultRequestHeaders.UserAgent.ParseAdd("NZIP/1.0");return client;}
        static async Task<string> Text(HttpClient client,string url,CancellationToken cancel){using(var response=await Open(client,url,cancel).ConfigureAwait(false))using(var stream=await response.Content.ReadAsStreamAsync().ConfigureAwait(false))using(var output=new MemoryStream()){var buffer=new byte[8192];int n;while((n=await stream.ReadAsync(buffer,0,buffer.Length,cancel).ConfigureAwait(false))>0){if(output.Length+n>262144)throw new ArchiveError("更新清单过大");output.Write(buffer,0,n);}return new UTF8Encoding(false,true).GetString(output.ToArray());}}
        public static async Task<J> Check(CancellationToken cancel){
            var trust=Trust();using(var client=Client()){
                string text=await Text(client,"https://api.github.com/repos/"+Json.Str(trust,"repository")+"/releases?per_page=10",cancel).ConfigureAwait(false);
                // Wrap the API array for the shared object decoder.
                foreach(var item in Json.Array(Json.Get(Json.Decode("{\"releases\":"+text+"}"),"releases")).Select(Json.Map)){
                    if(Json.Bool(item,"draft")||(!Edition.Preview&&Json.Bool(item,"prerelease")))continue;
                    var asset=Json.Array(Json.Get(item,"assets")).Select(Json.Map).FirstOrDefault(a=>Json.Str(a,"name")==Edition.Id+"-update.json");if(asset==null)continue;
                    string envelope=await Text(client,Json.Str(asset,"browser_download_url"),cancel).ConfigureAwait(false);var raw=Json.Decode(new UTF8Encoding(false,true).GetString(Decode(Json.Str(Json.Decode(envelope),"payload"))));Version version;if(!Version.TryParse(Json.Str(raw,"version"),out version))throw new ArchiveError("更新版本无效");if(version<=typeof(UpdateClient).Assembly.GetName().Version)return null;
                    var release=Verify(envelope,trust,Edition.Id,typeof(UpdateClient).Assembly.GetName().Version);release["envelope"]=envelope;return release;
                }return null;
            }
        }
        public static Task<string> Download(J release,string folder,CancellationToken cancel,Action<int> progress=null){return DownloadCore(release,Trust(),folder,cancel,progress);}
        internal static Task<string> DownloadFixture(J release,J trust,string folder,CancellationToken cancel){return DownloadCore(release,trust,folder,cancel,null);}
        static async Task<string> DownloadCore(J release,J trust,string folder,CancellationToken cancel,Action<int> progress){
            release=Verify(Json.Str(release,"envelope"),trust,Edition.Id,typeof(UpdateClient).Assembly.GetName().Version);Directory.CreateDirectory(folder);string temporary=Path.Combine(folder,Guid.NewGuid().ToString("N")+".part"),target=Path.Combine(folder,Edition.Id+"-"+Json.Str(release,"version")+".msi");
            try{using(var client=Client())using(var response=await Open(client,Json.Str(release,"url"),cancel).ConfigureAwait(false))using(var input=await response.Content.ReadAsStreamAsync().ConfigureAwait(false))using(var output=new FileStream(temporary,FileMode.CreateNew,FileAccess.Write,FileShare.None))using(var hash=SHA256.Create()){
                long total=0,expected=Json.Num(release,"size");if(response.Content.Headers.ContentLength.HasValue&&response.Content.Headers.ContentLength.Value!=expected)throw new ArchiveError("更新文件长度不匹配");var buffer=new byte[65536];int n;while((n=await input.ReadAsync(buffer,0,buffer.Length,cancel).ConfigureAwait(false))>0){total+=n;if(total>expected)throw new ArchiveError("更新文件过大");hash.TransformBlock(buffer,0,n,null,0);await output.WriteAsync(buffer,0,n,cancel).ConfigureAwait(false);if(progress!=null)progress((int)(total*100/expected));}hash.TransformFinalBlock(new byte[0],0,0);if(total!=expected||BitConverter.ToString(hash.Hash).Replace("-","").ToLowerInvariant()!=Json.Str(release,"sha256"))throw new ArchiveError("更新文件完整性校验失败");
            }cancel.ThrowIfCancellationRequested();if(File.Exists(target))File.Delete(target);File.Move(temporary,target);return target;}finally{if(File.Exists(temporary))File.Delete(temporary);}
        }
        public static void VerifyInstaller(string path,J release){release=Verify(Json.Str(release,"envelope"),Trust(),Edition.Id,typeof(UpdateClient).Assembly.GetName().Version);using(var input=File.OpenRead(path))using(var hash=SHA256.Create()){if(input.Length!=Json.Num(release,"size")||BitConverter.ToString(hash.ComputeHash(input)).Replace("-","").ToLowerInvariant()!=Json.Str(release,"sha256"))throw new ArchiveError("更新文件已改变，请重新下载");}}
    }
}
