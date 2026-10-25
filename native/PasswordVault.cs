using System;
using System.Collections.Generic;
using System.IO;
using System.Linq;
using System.Security.Cryptography;
using System.Text;

namespace NZIP {
    using J=Dictionary<string,object>;
    public sealed class PasswordVault:IDisposable {
        readonly string file;readonly List<J> items=new List<J>();
        static readonly byte[] Entropy=Encoding.UTF8.GetBytes("NZIP/password-vault/v1");
        public PasswordVault(string profile){file=Path.Combine(profile,"passwords.dat");if(!File.Exists(file))return;byte[] plain=null;try{var encrypted=File.ReadAllBytes(file);if(encrypted.Length>1024*1024)throw new ArchiveError("密码库过大");plain=ProtectedData.Unprotect(encrypted,Entropy,DataProtectionScope.CurrentUser);var data=Json.Decode(new UTF8Encoding(false,true).GetString(plain));if(Json.Num(data,"version")!=1)throw new ArchiveError("未知的密码库版本");items.AddRange(Json.Array(Json.Get(data,"items")).Select(Json.Map));}catch(CryptographicException){throw new ArchiveError("无法解锁密码库：请使用保存它的 Windows 用户账户");}finally{if(plain!=null)Array.Clear(plain,0,plain.Length);}}
        public J[] Labels(){return items.Select(i=>Json.Obj("id",Json.Str(i,"id"),"label",Json.Str(i,"label"))).ToArray();}
        public string Get(string id){var item=items.SingleOrDefault(i=>Json.Str(i,"id")==id);if(item==null)throw new ArchiveError("所选密码已不存在");return Json.Str(item,"password");}
        public string Add(string label,string password){if(String.IsNullOrWhiteSpace(label)||label.Length>160||String.IsNullOrEmpty(password)||password.Length>1024||items.Count>=200)throw new ArchiveError("请输入名称和密码（最多 200 项）");var id=Guid.NewGuid().ToString("N");var item=Json.Obj("id",id,"label",label.Trim(),"password",password);items.Add(item);try{Save();}catch{items.Remove(item);throw;}return id;}
        public void Remove(string id){var item=items.SingleOrDefault(i=>Json.Str(i,"id")==id);if(item==null)return;items.Remove(item);try{Save();}catch{items.Add(item);throw;}item["password"]="";}
        void Save(){Directory.CreateDirectory(Path.GetDirectoryName(file));byte[] plain=Encoding.UTF8.GetBytes(Json.Encode(Json.Obj("version",1,"items",items)));string temp=file+"."+Guid.NewGuid().ToString("N");try{var encrypted=ProtectedData.Protect(plain,Entropy,DataProtectionScope.CurrentUser);File.WriteAllBytes(temp,encrypted);if(File.Exists(file))File.Replace(temp,file,null);else File.Move(temp,file);}finally{Array.Clear(plain,0,plain.Length);if(File.Exists(temp))File.Delete(temp);}}
        public void Dispose(){foreach(var item in items)item["password"]="";items.Clear();}
    }
}
