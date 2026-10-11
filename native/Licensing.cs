using System;
using System.Collections.Generic;
using System.IO;
using System.Linq;
using System.Net;
using System.Net.Http;
using System.Security.Cryptography;
using System.Text;
using System.Text.RegularExpressions;
using System.Threading;
using System.Threading.Tasks;
using Microsoft.Win32;

namespace NZIP {
    using J=Dictionary<string,object>;
    // Certificates contain scalar fields only. Parse the exact signed bytes,
    // rejecting duplicate/unknown properties instead of serializer last-wins.
    internal static class LicenseProtocol {
        static readonly UTF8Encoding Utf8=new UTF8Encoding(false,true);
        public static byte[] Unbase(string value) {
            if(value==null||value.Length==0||value.Length>16384||!Regex.IsMatch(value,"^[A-Za-z0-9_-]+$"))throw new FormatException("授权编码无效");
            var data=Convert.FromBase64String(value.Replace('-','+').Replace('_','/')+new string('=',(4-value.Length%4)%4));
            if(Base(data)!=value)throw new FormatException("授权编码无效");return data;
        }
        public static string Base(byte[] bytes){return Convert.ToBase64String(bytes).TrimEnd('=').Replace('+','-').Replace('/','_');}
        static void White(string s,ref int i){while(i<s.Length&&(s[i]==' '||s[i]=='\r'||s[i]=='\n'||s[i]=='\t'))i++;}
        static string StringToken(string s,ref int i){int start=i++;bool escape=false;while(i<s.Length){char c=s[i++];if(c<32)throw new FormatException("授权 JSON 无效");if(escape){escape=false;continue;}if(c=='\\'){escape=true;continue;}if(c=='"')return s.Substring(start,i-start);}throw new FormatException("授权 JSON 无效");}
        public static J Scalars(string s,params string[] fields){
            if(s.Length>16384)throw new FormatException("授权文件过大");var d=new J();int i=0;White(s,ref i);if(i>=s.Length||s[i++]!='{')throw new FormatException("授权 JSON 无效");White(s,ref i);
            while(i<s.Length&&s[i]!='}'){
                if(s[i]!='"')throw new FormatException("授权 JSON 无效");var name=(string)new System.Web.Script.Serialization.JavaScriptSerializer().DeserializeObject(StringToken(s,ref i));White(s,ref i);
                if(!fields.Contains(name)||d.ContainsKey(name)||i>=s.Length||s[i++]!=':')throw new FormatException("授权字段无效或重复");White(s,ref i);if(i>=s.Length)throw new FormatException("授权 JSON 无效");object value;
                if(s[i]=='"'){value=new System.Web.Script.Serialization.JavaScriptSerializer().DeserializeObject(StringToken(s,ref i));if(((string)value).Length>12000)throw new FormatException("授权字段过长");}
                else {int start=i;while(i<s.Length&&s[i]>='0'&&s[i]<='9')i++;long number;var text=s.Substring(start,i-start);if(text.Length==0||(text.Length>1&&text[0]=='0')||!Int64.TryParse(text,out number))throw new FormatException("授权数字无效");value=number;}
                d.Add(name,value);White(s,ref i);if(i<s.Length&&s[i]==','){i++;White(s,ref i);if(i>=s.Length||s[i]=='}')throw new FormatException("授权 JSON 无效");}else break;
            }
            if(i>=s.Length||s[i++]!='}')throw new FormatException("授权 JSON 无效");White(s,ref i);if(i!=s.Length||d.Count!=fields.Length)throw new FormatException("授权字段缺失");return d;
        }
        public static J Verify(string certificate,J keys,string digest){
            var envelope=Scalars(certificate,"keyId","payload","signature");
            foreach(var value in envelope.Values)if(!(value is string))throw new FormatException("授权字段类型无效");
            var key=Json.Map(Json.Get(keys,Json.Str(envelope,"keyId")));if(key.Count==0)throw new FormatException("此授权签名密钥不受信任");
            var payload=Unbase(Json.Str(envelope,"payload"));var prefix=Encoding.UTF8.GetBytes("NZIP-LICENSE-V1\0");var signed=prefix.Concat(payload).ToArray();
            using(var rsa=new RSACryptoServiceProvider()){rsa.PersistKeyInCsp=false;rsa.ImportParameters(new RSAParameters{Modulus=Unbase(Json.Str(key,"modulus")),Exponent=Unbase(Json.Str(key,"exponent"))});if(rsa.KeySize<3072||!rsa.VerifyData(signed,CryptoConfig.MapNameToOID("SHA256"),Unbase(Json.Str(envelope,"signature"))))throw new FormatException("授权签名无效");}
            var p=Scalars(Utf8.GetString(payload),"schema","product","licenseId","grantId","bindingId","generation","customerRef","deviceDigest","entitlement","issuedAt");
            foreach(var pair in p)if(pair.Key!="schema"&&pair.Key!="generation"&&(!(pair.Value is string)||((string)pair.Value).Length>160))throw new FormatException("授权字段类型无效");
            if(!(p["schema"] is long)||!(p["generation"] is long)||Json.Num(p,"schema")!=1||Json.Num(p,"generation")<1||Json.Str(p,"product")!="nzip-paid"||Json.Str(p,"entitlement")!="desktop-core")throw new FormatException("授权产品或版本不匹配");
            foreach(var name in new[]{"licenseId","bindingId","grantId","customerRef"})if(!Regex.IsMatch(Json.Str(p,name),"^[A-Za-z0-9-]{1,100}$"))throw new FormatException("授权标识无效");
            if(!Regex.IsMatch(Json.Str(p,"issuedAt"),@"^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{3}Z$"))throw new FormatException("授权签发时间格式无效");
            if(!Regex.IsMatch(Json.Str(p,"deviceDigest"),"^[a-f0-9]{64}$")||Json.Str(p,"deviceDigest")!=digest)throw new FormatException("此授权属于另一台 Windows 设备，请在本机激活");return p;
        }
    }
    internal sealed class LicenseService {
        readonly object gate=new object();readonly string cache;readonly J keys;readonly string endpoint;readonly Func<string> device;
        readonly Func<string,J,CancellationToken,Task<J>> transport;
        bool loaded;J payload;string certificate="",managementToken="",loadError="";
        static readonly byte[] Entropy=Encoding.UTF8.GetBytes("NZIP Paid license cache v1");
        public LicenseService(string directory,string endpoint,J keys,Func<string> device,Func<string,J,CancellationToken,Task<J>> transport=null){cache=Path.Combine(directory,"license.dat");this.endpoint=endpoint;this.keys=keys;this.device=device;this.transport=transport??Post;}
        public string Endpoint{get{return endpoint;}}
        public static string DeviceDigest(){
            string machine;using(var root=RegistryKey.OpenBaseKey(RegistryHive.LocalMachine,RegistryView.Registry64))using(var key=root.OpenSubKey(@"SOFTWARE\Microsoft\Cryptography"))machine=key==null?null:key.GetValue("MachineGuid") as string;
            Guid id;if(!Guid.TryParse(machine,out id)||id==Guid.Empty)throw new ArchiveError("无法读取 Windows 设备标识，请检查系统权限后重试","DEVICE_ID");
            using(var sha=SHA256.Create())return BitConverter.ToString(sha.ComputeHash(Encoding.UTF8.GetBytes("NZIP-paid:device:v1|"+id.ToString("D").ToLowerInvariant()))).Replace("-","").ToLowerInvariant();
        }
        void Load(){
            if(loaded)return;loaded=true;
            try{if(!File.Exists(cache))return;if(new FileInfo(cache).Length>32768)throw new FormatException("本地授权缓存过大");var saved=Json.Decode(Encoding.UTF8.GetString(ProtectedData.Unprotect(File.ReadAllBytes(cache),Entropy,DataProtectionScope.CurrentUser)));var text=Json.Str(saved,"certificate");var verified=LicenseProtocol.Verify(text,keys,device());certificate=text;payload=verified;managementToken=Json.Str(saved,"managementToken");}
            catch(Exception e){loadError="本地授权未能验证："+e.Message;}
        }
        public J Status(){lock(gate){Load();return Json.Obj("active",payload!=null,"customerRef",payload==null?"":Json.Str(payload,"customerRef"),"error",loadError,"canDeactivate",payload!=null&&managementToken.Length>0,"bindingId",payload==null?"":Json.Str(payload,"bindingId"));}}
        public bool Authorized{get{lock(gate){Load();return payload!=null;}}}
        public string Export(){lock(gate){Load();if(payload==null)throw new ArchiveError("请先激活 NZIP","LICENSE_REQUIRED");return certificate;}}
        void Save(string text,string token){
            var verified=LicenseProtocol.Verify(text,keys,device());
            var bytes=ProtectedData.Protect(Encoding.UTF8.GetBytes(Json.Encode(Json.Obj("certificate",text,"managementToken",token))),Entropy,DataProtectionScope.CurrentUser);
            Directory.CreateDirectory(Path.GetDirectoryName(cache));var temp=cache+"."+Guid.NewGuid().ToString("N")+".tmp";
            try{File.WriteAllBytes(temp,bytes);if(File.Exists(cache))File.Replace(temp,cache,null);else File.Move(temp,cache);}finally{if(File.Exists(temp))File.Delete(temp);}
            certificate=text;managementToken=token;payload=verified;loadError="";loaded=true;
        }
        public void Import(string text){lock(gate){Load();var verified=LicenseProtocol.Verify(text,keys,device());var token=payload!=null&&Json.Str(payload,"grantId")==Json.Str(verified,"grantId")?managementToken:"";Save(text,token);}}
        async Task<J> Post(string route,J body,CancellationToken cancel){
            using(var timeout=CancellationTokenSource.CreateLinkedTokenSource(cancel)){
            timeout.CancelAfter(TimeSpan.FromSeconds(20));cancel=timeout.Token;
            Uri uri;if(!Uri.TryCreate(endpoint,UriKind.Absolute,out uri)||uri.Scheme!="https")throw new ArchiveError("此构建尚未配置正式授权服务，请联系发行方","LICENSE_CONFIG");
            ServicePointManager.SecurityProtocol|=SecurityProtocolType.Tls12;
            using(var handler=new HttpClientHandler{AllowAutoRedirect=false})using(var client=new HttpClient(handler)){client.Timeout=TimeSpan.FromSeconds(20);
                using(var request=new HttpRequestMessage(HttpMethod.Post,endpoint.TrimEnd('/')+"/v1/"+route)){request.Content=new StringContent(Json.Encode(body),Encoding.UTF8,"application/json");
                    using(var response=await client.SendAsync(request,HttpCompletionOption.ResponseHeadersRead,cancel).ConfigureAwait(false))using(var stream=await response.Content.ReadAsStreamAsync().ConfigureAwait(false))using(var output=new MemoryStream()){
                        var buffer=new byte[2048];int count;while((count=await stream.ReadAsync(buffer,0,buffer.Length,cancel).ConfigureAwait(false))>0){if(output.Length+count>16384)throw new ArchiveError("授权响应过大");output.Write(buffer,0,count);}var data=Json.Decode(new UTF8Encoding(false,true).GetString(output.ToArray()));
                        if(!response.IsSuccessStatusCode||!Json.Bool(data,"ok"))throw new ArchiveError(Json.Str(data,"error","授权服务暂时不可用，请稍后重试"),Json.Str(data,"code","LICENSE_NETWORK"));return data;
                    }
                }
            }
            }
        }
        readonly SemaphoreSlim mutation=new SemaphoreSlim(1,1);
        public async Task Activate(string code,CancellationToken cancel){
            await mutation.WaitAsync(cancel).ConfigureAwait(false);try{
                var result=await transport("activate",Json.Obj("requestId",Guid.NewGuid().ToString(),"activationCode",code.Trim(),"deviceDigest",device(),"deviceName",Environment.MachineName),cancel).ConfigureAwait(false);
                var token=Json.Str(result,"managementToken");if(!Regex.IsMatch(token,"^[A-Za-z0-9_-]{43}$"))throw new FormatException("设备管理凭证无效");lock(gate)Save(Json.Encode(Json.Map(Json.Get(result,"certificate"))),token);
            }finally{mutation.Release();}
        }
        public async Task Deactivate(CancellationToken cancel){
            await mutation.WaitAsync(cancel).ConfigureAwait(false);try{
                J request;string grant;lock(gate){Load();if(payload==null||managementToken.Length==0)throw new ArchiveError("请通过购买邮箱管理设备","LICENSE_MANAGE");grant=Json.Str(payload,"grantId");request=Json.Obj("requestId",Guid.NewGuid().ToString(),"bindingId",Json.Get(payload,"bindingId"),"generation",Json.Get(payload,"generation"),"managementToken",managementToken);}
                var result=await transport("deactivate",request,cancel).ConfigureAwait(false);if(!Json.Bool(result,"deactivated")||Json.Str(result,"bindingId")!=Json.Str(request,"bindingId")||Json.Num(result,"generation")!=Json.Num(request,"generation"))throw new FormatException("解绑响应不匹配");
                lock(gate){if(payload!=null&&Json.Str(payload,"grantId")==grant){payload=null;certificate="";managementToken="";if(File.Exists(cache))File.Delete(cache);}}
            }finally{mutation.Release();}
        }
    }
    internal static class LicenseRuntime {
        static readonly Lazy<LicenseService> current=new Lazy<LicenseService>(Create);
        static LicenseService Create(){
            string endpoint="";var keys=new J();
#if NZIP_PAID
            endpoint=PaidConfig.Endpoint;foreach(var item in Json.Array(Json.Get(Json.Decode(PaidConfig.PublicConfig),"keys"))){var key=Json.Map(item);keys.Add(Json.Str(key,"keyId"),key);}
#endif
            return new LicenseService(Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData),Edition.LicenseFolder,"License"),endpoint,keys,LicenseService.DeviceDigest);
        }
        public static LicenseService Current{get{return current.Value;}}
    }
    // An admitted operation retains an immutable capability until completion.
    // Queued tasks capture it before enqueue; new work checks current state.
    internal static class LicenseGate {
        [ThreadStatic]static int depth;
        public static bool Capture(){if(Edition.Paid&&depth==0&&!LicenseRuntime.Current.Authorized)throw new ArchiveError("浏览压缩包目录免费；压缩、解压等操作请先激活 NZIP 收费版","LICENSE_REQUIRED");return true;}
        public static IDisposable Enter(){Capture();return Admitted(true);}
        internal static IDisposable Admitted(bool capability){if(!capability)throw new InvalidOperationException();depth++;return new Scope();}
        sealed class Scope:IDisposable{bool disposed;public void Dispose(){if(!disposed){disposed=true;depth--;}}}
    }
}
