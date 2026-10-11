using System;
using System.IO;
using System.Linq;
using System.Text;
using System.Threading;
using System.Threading.Tasks;
using System.Collections.Generic;
using NZIP;

static class LicenseTests {
    static int checks;
    static void Check(bool value,string message){if(!value)throw new Exception(message);checks++;}
    static void Reject(Action action,string message){bool rejected=false;try{action();}catch(FormatException){rejected=true;}Check(rejected,message);}
    static void Main(string[] args){
        if(args[0]=="--device"){Console.WriteLine(LicenseService.DeviceDigest());return;}
        var fixture=Json.Decode(File.ReadAllText(args[0]));var directory=args[1];Directory.CreateDirectory(directory);
        var keys=Json.Map(Json.Get(fixture,"keys"));string cert=Json.Str(fixture,"certificate"),digest=Json.Str(fixture,"digest");
        var service=new LicenseService(directory,"",keys,()=>digest);Check(!service.Authorized,"new user unlicensed");service.Import(cert);Check(service.Authorized,"valid server certificate accepted");
        Check(Json.Str(service.Status(),"customerRef")=="customer-001","customer ref only");Check(service.Export()==cert,"export original signed envelope");
        var bytes=File.ReadAllBytes(Path.Combine(directory,"license.dat"));Check(!Encoding.UTF8.GetString(bytes).Contains("certificate"),"DPAPI cache is not plaintext");
        Check(new LicenseService(directory,"",keys,()=>digest).Authorized,"offline reload verified");
        Check(!new LicenseService(directory,"",keys,()=>new string('f',64)).Authorized,"copied cache rejected on different machine");
        var copy=new LicenseService(Path.Combine(directory,"copy"),"",keys,()=>digest);copy.Import(cert);Check(copy.Authorized,"same OS certificate import in another cache");
        foreach(var name in new[]{"badSignature","wrongDevice","unknownKey","duplicateEnvelope","duplicatePayload","unknownPayload","missingPayload","stringSchema","invalidSchema","wrongProduct","wrongEntitlement","invalidIssuedAt","oversize"}){
            Reject(()=>service.Import(Json.Str(fixture,name)),name+" rejected");Check(service.Authorized&&service.Export()==cert,name+" preserves valid cache");
        }
        var ioDirectory=Path.Combine(directory,"io");bool networkFailure=false,badActivate=false;
        Func<string,Dictionary<string,object>,CancellationToken,Task<Dictionary<string,object>>> transport=(route,p,cancel)=>{
            if(networkFailure)throw new IOException("simulated network outage");
            if(route=="activate")return Task.FromResult(Json.Obj("certificate",Json.Decode(badActivate?Json.Str(fixture,"badSignature"):cert),"managementToken",new string('a',43)));
            return Task.FromResult(Json.Obj("deactivated",true,"bindingId",Json.Get(p,"bindingId"),"generation",Json.Get(p,"generation")));
        };
        var io=new LicenseService(ioDirectory,"",keys,()=>digest,transport);io.Activate("code",CancellationToken.None).GetAwaiter().GetResult();Check(io.Authorized&&Json.Bool(io.Status(),"canDeactivate"),"online activation stored signed cert and management token");
        var exported=io.Export();Check(!exported.Contains("managementToken")&&!exported.Contains("activationCode"),"export excludes management secrets");
        networkFailure=true;try{io.Deactivate(CancellationToken.None).GetAwaiter().GetResult();throw new Exception("outage accepted");}catch(IOException){}Check(io.Authorized&&File.Exists(Path.Combine(ioDirectory,"license.dat")),"deactivate outage preserves good license");
        networkFailure=false;badActivate=true;Reject(()=>io.Activate("code",CancellationToken.None).GetAwaiter().GetResult(),"invalid activation response rejected");Check(io.Authorized,"bad activation preserves good license");
        io.Deactivate(CancellationToken.None).GetAwaiter().GetResult();Check(!io.Authorized&&!File.Exists(Path.Combine(ioDirectory,"license.dat")),"successful deactivate clears local license");
        Check(!new LicenseService(ioDirectory,"",keys,()=>digest).Authorized,"deactivated cache stays empty on restart");
        Console.WriteLine("Native licensing checks passed: "+checks);
    }
}
