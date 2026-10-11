const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const root = path.resolve(__dirname,'..'), { version } = require('../package.json');
const work = path.join(root,'.cache/installer'), app=path.join(root,`dist/NZIP-${version}-win-x64`);
const xml = s => String(s).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&apos;'}[c]));
const id = (prefix,s) => prefix+crypto.createHash('sha256').update(s).digest('hex').slice(0,20);
const guid = s => { const h=crypto.createHash('sha256').update('NZIP/file/'+s).digest('hex'); return `${h.slice(0,8)}-${h.slice(8,12)}-5${h.slice(13,16)}-a${h.slice(17,20)}-${h.slice(20,32)}`; };
const refs=[],dirIds=[],fileComponents=[];
let mainFile;
function directory(relative, directoryId){
  dirIds.push(directoryId); let result='';
  for(const e of fs.readdirSync(path.join(app,relative),{withFileTypes:true})){
    const rel=path.join(relative,e.name);
    if(e.isDirectory())result+=`<Directory Id="${id('D',rel)}" Name="${xml(e.name)}">${directory(rel,id('D',rel))}</Directory>`;
    else {
      const component=id('C',rel), file=id('F',rel);refs.push(component);
      if(rel==='NZIP.exe')mainFile=file;
      fileComponents.push(String.raw`<DirectoryRef Id="${directoryId}"><Component Id="${component}" Guid="${guid(rel)}" Win64="yes"><File Id="${file}" Source="${xml(path.join(app,rel))}" Name="${xml(e.name)}"/><RegistryValue Root="HKCU" Key="Software\NZIP\Installer\Files" Name="${component}" Type="integer" Value="1" KeyPath="yes"/></Component></DirectoryRef>`);
    }
  }
  return result;
}
const directories=directory('','INSTALLFOLDER'), product=crypto.randomUUID().toUpperCase();
const registry=JSON.parse(fs.readFileSync(path.join(work,'shell-registry.json'),'utf8').replace(/^\uFEFF/,''));
function registryComponent(component,context){
  const entries=registry.filter(v=>/\\shell\\NZIP(?:\.Compress)?(?:\\|$)/.test(v.key)===context);
  return `<Component Id="${component}" Guid="*" Win64="yes">${entries.map((v,i)=>{
    const val=Array.isArray(v.value)?'':String(v.value).replaceAll('C:\\NZIP_PLACEHOLDER\\NZIP.exe','[INSTALLFOLDER]NZIP.exe').replaceAll('C:\\NZIP_PLACEHOLDER','[INSTALLFOLDER]');
    return `<RegistryValue Root="HKCU" Key="${xml(v.key)}" ${v.name?`Name="${xml(v.name)}"`:''} Type="string" Value="${xml(val)}" ${i===0?'KeyPath="yes"':''}/>`;
  }).join('')}</Component>`;
}
const source=String.raw`<?xml version="1.0" encoding="utf-8"?>
<Wix xmlns="http://schemas.microsoft.com/wix/2006/wi">
<Product Id="${product}" Name="NZIP" Language="2052" Codepage="936" Version="${version}" Manufacturer="NZIP" UpgradeCode="06765602-7035-4ED7-9DCB-80F02E0E5626">
<!-- ALLUSERS stays unset: retain the existing per-user product context.
     Elevated privileges allow rollback backups on protected data drives. -->
<Package InstallerVersion="500" Compressed="yes" InstallPrivileges="elevated" Platform="x64" Description="NZIP 无广告的压缩解压与预览工具"/>
<Property Id="MsiLogging" Value="voicewarmupx"/>
<MajorUpgrade AllowSameVersionUpgrades="yes" DowngradeErrorMessage="已安装更新版本的 NZIP。" Schedule="afterInstallInitialize"/>
<MediaTemplate EmbedCab="yes" CompressionLevel="high"/>

<Property Id="ARPNOMODIFY" Value="1"/>
<Property Id="ARPPRODUCTICON" Value="AppIcon"/>
<Property Id="INSTALLFOLDER" Secure="yes"/>
<Property Id="NZIP_PREVIOUS_DIR" Secure="yes"><RegistrySearch Id="PreviousDirSearch" Root="HKCU" Key="Software\NZIP\Installer" Name="Directory" Type="raw" Win64="yes"/></Property>
<SetProperty Id="INSTALLFOLDER" Action="UsePreviousInstallFolder" Value="[NZIP_PREVIOUS_DIR]" After="AppSearch" Sequence="both">NOT INSTALLFOLDER AND NZIP_PREVIOUS_DIR</SetProperty>
<Property Id="NZIP_INSTALL_MESSAGE" Value="欢迎安装 NZIP。首次安装可在下一步选择安装目录和功能。"/>
<SetProperty Id="NZIP_INSTALL_MESSAGE" Value="检测到已安装的 NZIP，将默认使用原安装目录。可在功能选择页查看目录。" After="UsePreviousInstallFolder" Sequence="both">NZIP_PREVIOUS_DIR</SetProperty>
<SetProperty Id="ARPINSTALLLOCATION" Value="[INSTALLFOLDER]" After="CostFinalize" Sequence="both"/>
<Property Id="NET48"><RegistrySearch Id="Net48Search" Root="HKLM" Key="SOFTWARE\Microsoft\NET Framework Setup\NDP\v4\Full" Name="Release" Type="raw" Win64="yes"/></Property>
<Property Id="WINMAJOR"><RegistrySearch Id="WinMajorSearch" Root="HKLM" Key="SOFTWARE\Microsoft\Windows NT\CurrentVersion" Name="CurrentMajorVersionNumber" Type="raw" Win64="yes"/></Property>
<Condition Message="需要 Windows 10/11 x64。">Installed OR (VersionNT64 AND WINMAJOR &gt;= "#10")</Condition>
<Condition Message="请先安装 Microsoft .NET Framework 4.8。">Installed OR NET48 &gt;= "#528040"</Condition>
<Icon Id="AppIcon" SourceFile="${xml(path.join(root,'assets/icon.ico'))}"/>
<Directory Id="TARGETDIR" Name="SourceDir"><Directory Id="LocalAppDataFolder"><Directory Id="NzipProgramsDir" Name="Programs"><Directory Id="INSTALLFOLDER" Name="NZIP">${directories}</Directory></Directory></Directory><Directory Id="ProgramMenuFolder"><Directory Id="NzipMenuDir" Name="NZIP"/></Directory><Directory Id="DesktopFolder"/></Directory>
${fileComponents.join('\n')}
<DirectoryRef Id="INSTALLFOLDER">
${registryComponent('OpenWithRegistration',false)}
${registryComponent('ContextMenus',true)}
<Component Id="DirectoryCleanup" Guid="*" Win64="yes"><RegistryValue Root="HKCU" Key="Software\NZIP\Installer" Name="Directory" Type="string" Value="[INSTALLFOLDER]" KeyPath="yes"/>${[...dirIds,'NzipProgramsDir'].map(d=>`<RemoveFolder Id="Remove${d}" Directory="${d}" On="uninstall"/>`).join('')}</Component>
</DirectoryRef>
<DirectoryRef Id="NzipMenuDir"><Component Id="StartMenu" Guid="*" Win64="yes"><Shortcut Id="AppShortcut" Name="NZIP" Target="[#${mainFile}]" WorkingDirectory="INSTALLFOLDER" Icon="AppIcon"/><Shortcut Id="UninstallShortcut" Name="卸载 NZIP" Target="[System64Folder]msiexec.exe" Arguments="/x {${product}}"/><RemoveFolder Id="RemoveMenu" On="uninstall"/><RegistryValue Root="HKCU" Key="Software\NZIP\Installer" Name="StartMenu" Type="integer" Value="1" KeyPath="yes"/></Component></DirectoryRef>
<DirectoryRef Id="DesktopFolder"><Component Id="DesktopShortcut" Guid="*" Win64="yes"><Shortcut Id="DesktopAppShortcut" Name="NZIP" Target="[#${mainFile}]" WorkingDirectory="INSTALLFOLDER" Icon="AppIcon"/><RegistryValue Root="HKCU" Key="Software\NZIP\Installer" Name="DesktopShortcut" Type="integer" Value="1" KeyPath="yes"/></Component></DirectoryRef>
<Feature Id="CoreFiles" Title="NZIP 主程序" Description="轻量压缩解压工具，支持包内目录、文本和图片预览。原生 Windows 界面，无需 WebView2。" Level="1" Absent="disallow" ConfigurableDirectory="INSTALLFOLDER" Display="expand">
${[...refs,'DirectoryCleanup'].map(c=>`<ComponentRef Id="${c}"/>`).join('')}
<Feature Id="OpenWith" Title="打开方式注册" Description="在压缩文件的打开方式中添加 NZIP，保留现有默认软件。" Level="1"><ComponentRef Id="OpenWithRegistration"/></Feature>
<Feature Id="ShellMenus" Title="NZIP 右键子菜单" Description="打开并预览、解压到同名文件夹、解压到其他位置；Windows 11 在显示更多选项中。" Level="1"><ComponentRef Id="ContextMenus"/></Feature>
<Feature Id="StartMenuFeature" Title="开始菜单快捷方式" Level="1"><ComponentRef Id="StartMenu"/></Feature>
<Feature Id="DesktopFeature" Title="桌面快捷方式" Level="1"><ComponentRef Id="DesktopShortcut"/></Feature>
</Feature>
<UIRef Id="WixUI_FeatureTree"/>
<WixVariable Id="WixUILicenseRtf" Value="${xml(path.join(work,'license.rtf'))}"/>
</Product></Wix>`;
fs.writeFileSync(path.join(work,'NZIP.wxs'),source);
fs.writeFileSync(path.join(work,'NZIP.wxl'),`<?xml version="1.0" encoding="utf-8"?><WixLocalization Culture="zh-CN" xmlns="http://schemas.microsoft.com/wix/2006/localization"><String Id="WelcomeDlgDescription">[NZIP_INSTALL_MESSAGE]</String><String Id="MaintenanceWelcomeDlgDescription">[NZIP_INSTALL_MESSAGE]</String></WixLocalization>`);
const license=fs.readFileSync(path.join(root,'LICENSE'),'utf8').replace(/[\\{}]/g,'\\$&').replace(/\r?\n/g,'\\par\n');
fs.writeFileSync(path.join(work,'license.rtf'),`{\\rtf1\\ansi ${license}}`);
fs.writeFileSync(path.join(work,'msi-info.json'),JSON.stringify({productCode:`{${product}}`,version,files:refs.length,registryValues:registry.length},null,2));
console.log(`Generated MSI: ${refs.length} files, ${registry.length} shell values.`);
