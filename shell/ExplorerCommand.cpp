#define WIN32_LEAN_AND_MEAN
#include <windows.h>
#include <shobjidl.h>
#include <shlwapi.h>
#include <string>
#include <vector>
#include <new>
#include "ShellConfig.h"

static HMODULE moduleHandle;
static LONG objects=0,locks=0;
static std::wstring Executable(){wchar_t configured[32768];DWORD bytes=sizeof(configured);if(RegGetValueW(HKEY_CURRENT_USER,NZIP_LANGUAGE_KEY,L"ShellExecutable",RRF_RT_REG_SZ,nullptr,configured,&bytes)==ERROR_SUCCESS&&PathIsRelativeW(configured)==FALSE)return configured;wchar_t path[32768];DWORD n=GetModuleFileNameW(moduleHandle,path,32768);if(!n||n>=32768)return L"";std::wstring result(path,n);return result.substr(0,result.find_last_of(L'\\')+1)+NZIP_EXE;}
static std::wstring Quote(const std::wstring& value){std::wstring result=L"\"";size_t slashes=0;for(wchar_t c:value){if(c==L'\\'){slashes++;continue;}result.append(slashes*(c==L'"'?2:1),L'\\');if(c==L'"')result+=L'\\';result+=c;slashes=0;}result.append(slashes*2,L'\\');return result+L'"';}
static bool Chinese(bool& traditional){wchar_t value[32]={};DWORD size=sizeof(value);if(RegGetValueW(HKEY_CURRENT_USER,NZIP_LANGUAGE_KEY,L"UILanguage",RRF_RT_REG_SZ,nullptr,value,&size)!=ERROR_SUCCESS)GetUserDefaultLocaleName(value,32);traditional=!_wcsicmp(value,L"zh-TW")||!_wcsicmp(value,L"zh-HK");return !_wcsnicmp(value,L"zh",2);}
static bool Archive(IShellItemArray* items){DWORD count=0;if(!items||FAILED(items->GetCount(&count))||count!=1)return false;IShellItem* item=nullptr;if(FAILED(items->GetItemAt(0,&item)))return false;PWSTR path=nullptr;HRESULT hr=item->GetDisplayName(SIGDN_FILESYSPATH,&path);item->Release();if(FAILED(hr))return false;PCWSTR extension=PathFindExtensionW(path);bool supported=false;for(auto known:archiveExtensions)if(!_wcsicmp(extension,known)){supported=true;break;}CoTaskMemFree(path);return supported;}
class Commands;
class Command final:public IExplorerCommand {
    LONG refs=1;int action;
public:
    explicit Command(int value):action(value){InterlockedIncrement(&objects);}~Command(){InterlockedDecrement(&objects);}
    IFACEMETHODIMP QueryInterface(REFIID iid,void** out)override{if(!out)return E_POINTER;*out=nullptr;if(iid==IID_IUnknown||iid==__uuidof(IExplorerCommand)){*out=static_cast<IExplorerCommand*>(this);AddRef();return S_OK;}return E_NOINTERFACE;}
    IFACEMETHODIMP_(ULONG) AddRef()override{return InterlockedIncrement(&refs);}IFACEMETHODIMP_(ULONG) Release()override{ULONG n=InterlockedDecrement(&refs);if(!n)delete this;return n;}
    IFACEMETHODIMP GetTitle(IShellItemArray*,PWSTR* title)override{if(!title)return E_POINTER;bool traditional=false,chinese=Chinese(traditional);const wchar_t* en[]={L"NZIP",L"Open with NZIP",L"Extract to folder",L"Extract files...",L"Compress with NZIP..."};const wchar_t* cn[]={L"NZIP",L"用 NZIP 打开",L"解压到同名文件夹",L"解压到其他文件夹…",L"使用 NZIP 压缩…"};const wchar_t* tw[]={L"NZIP",L"用 NZIP 開啟",L"解壓縮至同名資料夾",L"解壓縮至其他資料夾…",L"使用 NZIP 壓縮…"};return SHStrDupW(chinese?(traditional?tw[action]:cn[action]):en[action],title);}
    IFACEMETHODIMP GetIcon(IShellItemArray*,PWSTR* icon)override{if(!icon)return E_POINTER;return SHStrDupW((Executable()+L",0").c_str(),icon);}
    IFACEMETHODIMP GetToolTip(IShellItemArray*,PWSTR* text)override{if(!text)return E_POINTER;*text=nullptr;return E_NOTIMPL;}
    IFACEMETHODIMP GetCanonicalName(GUID* guid)override{if(!guid)return E_POINTER;*guid=NZIP_CLSID;guid->Data1+=action;return S_OK;}
    IFACEMETHODIMP GetState(IShellItemArray* items,BOOL,EXPCMDSTATE* state)override{if(!state)return E_POINTER;DWORD count=0;*state=ECS_HIDDEN;if(items&&SUCCEEDED(items->GetCount(&count))&&count>0&&count<=512&&(action==0||action==4||Archive(items)))*state=ECS_ENABLED;return S_OK;}
    IFACEMETHODIMP Invoke(IShellItemArray* items,IBindCtx*)override{
        EXPCMDSTATE state;GetState(items,FALSE,&state);if(action==0||state!=ECS_ENABLED)return E_INVALIDARG;DWORD count=0;HRESULT hr=items->GetCount(&count);if(FAILED(hr))return hr;
        std::wstring exe=Executable(),command=Quote(exe)+(action==1?L" --open":action==2?L" --extract-folder":action==3?L" --extract":L" --compress");
        for(DWORD i=0;i<count;i++){IShellItem* item=nullptr;hr=items->GetItemAt(i,&item);if(FAILED(hr))return hr;PWSTR path=nullptr;hr=item->GetDisplayName(SIGDN_FILESYSPATH,&path);item->Release();if(FAILED(hr))return hr;command+=L" "+Quote(path);CoTaskMemFree(path);if(command.size()>30000)return HRESULT_FROM_WIN32(ERROR_FILENAME_EXCED_RANGE);}
        STARTUPINFOW startup={sizeof(startup)};PROCESS_INFORMATION process={};auto folder=exe.substr(0,exe.find_last_of(L'\\'));if(!CreateProcessW(exe.c_str(),&command[0],nullptr,nullptr,FALSE,CREATE_UNICODE_ENVIRONMENT,nullptr,folder.c_str(),&startup,&process))return HRESULT_FROM_WIN32(GetLastError());CloseHandle(process.hThread);CloseHandle(process.hProcess);return S_OK;
    }
    IFACEMETHODIMP GetFlags(EXPCMDFLAGS* flags)override{if(!flags)return E_POINTER;*flags=action==0?ECF_HASSUBCOMMANDS:ECF_DEFAULT;return S_OK;}
    IFACEMETHODIMP EnumSubCommands(IEnumExplorerCommand** commands)override;
};
class Commands final:public IEnumExplorerCommand {
    LONG refs=1;ULONG position=0;
public:
    Commands(){InterlockedIncrement(&objects);}~Commands(){InterlockedDecrement(&objects);}
    IFACEMETHODIMP QueryInterface(REFIID iid,void** out)override{if(!out)return E_POINTER;*out=nullptr;if(iid==IID_IUnknown||iid==__uuidof(IEnumExplorerCommand)){*out=static_cast<IEnumExplorerCommand*>(this);AddRef();return S_OK;}return E_NOINTERFACE;}
    IFACEMETHODIMP_(ULONG) AddRef()override{return InterlockedIncrement(&refs);}IFACEMETHODIMP_(ULONG) Release()override{ULONG n=InterlockedDecrement(&refs);if(!n)delete this;return n;}
    IFACEMETHODIMP Next(ULONG count,IExplorerCommand** out,ULONG* fetched)override{if(!out||(!fetched&&count!=1))return E_POINTER;ULONG n=0;while(n<count&&position<4){out[n]=new(std::nothrow)Command(1+position);if(!out[n])return E_OUTOFMEMORY;n++;position++;}if(fetched)*fetched=n;return n==count?S_OK:S_FALSE;}
    IFACEMETHODIMP Skip(ULONG count)override{ULONG remaining=4-position;position+=count<remaining?count:remaining;return count<=remaining?S_OK:S_FALSE;}
    IFACEMETHODIMP Reset()override{position=0;return S_OK;}
    IFACEMETHODIMP Clone(IEnumExplorerCommand** out)override{if(!out)return E_POINTER;auto clone=new(std::nothrow)Commands();if(!clone)return E_OUTOFMEMORY;clone->position=position;*out=clone;return S_OK;}
};
HRESULT Command::EnumSubCommands(IEnumExplorerCommand** out){if(!out)return E_POINTER;*out=nullptr;if(action!=0)return E_NOTIMPL;*out=new(std::nothrow)Commands();return *out?S_OK:E_OUTOFMEMORY;}
class Factory final:public IClassFactory {
    LONG refs=1;
public:
    Factory(){InterlockedIncrement(&objects);}~Factory(){InterlockedDecrement(&objects);}
    IFACEMETHODIMP QueryInterface(REFIID iid,void** out)override{if(!out)return E_POINTER;*out=nullptr;if(iid==IID_IUnknown||iid==IID_IClassFactory){*out=static_cast<IClassFactory*>(this);AddRef();return S_OK;}return E_NOINTERFACE;}
    IFACEMETHODIMP_(ULONG) AddRef()override{return InterlockedIncrement(&refs);}IFACEMETHODIMP_(ULONG) Release()override{ULONG n=InterlockedDecrement(&refs);if(!n)delete this;return n;}
    IFACEMETHODIMP CreateInstance(IUnknown* outer,REFIID iid,void** out)override{if(!out)return E_POINTER;*out=nullptr;if(outer)return CLASS_E_NOAGGREGATION;auto command=new(std::nothrow)Command(0);if(!command)return E_OUTOFMEMORY;HRESULT hr=command->QueryInterface(iid,out);command->Release();return hr;}
    IFACEMETHODIMP LockServer(BOOL lock)override{if(lock)InterlockedIncrement(&locks);else InterlockedDecrement(&locks);return S_OK;}
};
STDAPI DllGetClassObject(REFCLSID clsid,REFIID iid,void** out){if(!out)return E_POINTER;*out=nullptr;if(clsid!=NZIP_CLSID)return CLASS_E_CLASSNOTAVAILABLE;auto factory=new(std::nothrow)Factory();if(!factory)return E_OUTOFMEMORY;HRESULT hr=factory->QueryInterface(iid,out);factory->Release();return hr;}
STDAPI DllCanUnloadNow(){return objects==0&&locks==0?S_OK:S_FALSE;}
BOOL WINAPI DllMain(HINSTANCE module,DWORD reason,LPVOID){if(reason==DLL_PROCESS_ATTACH){moduleHandle=module;DisableThreadLibraryCalls(module);}return TRUE;}
