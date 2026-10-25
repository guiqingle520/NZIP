# NZIP 更新与 Windows 11 扩展发布

2026-10-25。当前免费版 0.7.0，收费测试版 0.8.0，Windows x64 / .NET Framework 4.8。

## GitHub 更新

更新源为公开仓库 `guiqingle520/NZIP` 的 Release。应用不内置 GitHub Token，不读取客户的 Git 凭据。源码和历史已按用户授权公开，发布二进制须同时遵守 LICENSES.md 和第三方许可；公开仓库不改变收费授权代码的许可。

各产品使用独立清单名：`NZIP-update.json`、`NZIPPaid-update.json`、`NZIPPaidPreview-update.json`。客户端读取最近十个 Release，跳过草稿；免费 / 正式收费版跳过预发布，收费测试版允许预发布。更新版本必须高于已安装程序集版本、产品 ID 必须相同。

清单包含 `keyId`、Base64URL 编码的原始 JSON `payload` 和 RSA-3072 / SHA-256 PKCS#1 签名。载荷包含产品、版本、指定仓库下的 HTTPS Release MSI 地址、长度和 SHA-256。公钥编译自 `config/updates-public.json`。下载长度上限 128 MiB，清单 / API 响应上限 256 KiB；拒绝陌生主机重定向。下载完成和用户点击安装前都验证完整性。只后台检查，不静默下载或安装；用户可关闭每日检查。

本机已生成首个更新密钥，私钥仅位于忽略的 `.cache/update-signing/private.pem`，未上传 GitHub、未打入任何安装包。**正式发布前应将此私钥安全备份到发行方受保护的位置。** 公钥固定后，丢失私钥就无法给已安装客户端签发后续更新，须人工安装更换信任根的版本。更新密钥与设备授权密钥、Windows 代码签名证书相互独立。

新项目可生成自己的更新密钥，脚本拒绝覆盖现有文件；已经发行的客户端不能直接替换公钥来轮换：

```powershell
node scripts/create-update-key.mjs .cache/new-signing/private.pem .cache/new-signing/public.json guiqingle520/NZIP updates-new-01
```

构建安装包后生成对应产品的清单。参数版本应与该产品程序集一致，Release tag 和安装包名称须与上传资源一致：

```powershell
node scripts/sign-update.mjs NZIP 0.7.0 dist/NZIP-0.7.0-Setup-x64.msi v0.8.0
node scripts/sign-update.mjs NZIPPaidPreview 0.8.0 dist/NZIPPaidPreview-0.8.0-Setup-x64.msi v0.8.0
```

清单写入 `dist/<product>-update.json`。发布时把 MSI 和同产品的清单同时上传到对应 Release。没有已发布的清单时，客户端不会凭未签名的 Release 文本下载程序。不要发布测试脚本产生的 `9999.0.0` 夹具。专项测试使用每轮新建的临时 RSA 密钥，不需要也不使用发行私钥；HTTP 下载由隔离处理器提供数据，不会安装测试 MSI。

当前收费包仍为带测试授权公钥的 Preview，正式授权域名、邮件和发行密钥尚未配置，不应以正式商业版本名义发布。

## Windows 11 一级右键

原生 C++ `shell/ExplorerCommand.cpp` 实现 IExplorerCommand，根菜单四项：打开、解压到同名目录、解压到其他目录、压缩。创建菜单阶段只判断选中项，不读取压缩包。支持最多 512 个压缩来源，通过带引号的参数启动同目录产品 EXE；免费 / 收费 / Preview 各有独立 CLSID、产品名和 MSIX identity。用注册时记录的完整 EXE 路径定位外部程序。

`scripts/build-modern-package.ps1` 生成外部位置身份包，包含 COM DLL、图标和 manifest。待签名包为程序目录的 `ModernShell.msix`，默认 Publisher 为 `CN=NZIP`。按微软 sparse-package 指南使用 MakeAppx `/nv`，因为 EXE 位于外部安装目录。此开关不绕过 Windows 的包签名或证书信任检查。

用户目前没有发行证书，已明确选择交付待签名包。本版不生成或安装自签名信任证书，不更改系统证书库、应用控制或全局策略。未签名时设置页禁用启用按钮并显示原因；传统菜单继续可用。

取得证书后，用实际 Subject 匹配 `ModernPublisher`，同时重建 EXE 的身份元数据和包，不能仅修改 MSIX 的 Publisher：

```powershell
powershell -NoProfile -File scripts/build-installer.ps1 -ModernPublisher "CN=Your Publisher" -ModernCertificateThumbprint YOUR_CERTIFICATE_THUMBPRINT
powershell -NoProfile -File scripts/build-installer.ps1 -Edition Paid -Preview -PublicConfig PATH_TO_CLIENT_PUBLIC_JSON -ModernPublisher "CN=Your Publisher" -ModernCertificateThumbprint YOUR_CERTIFICATE_THUMBPRINT
```

MSI 仅在包包含签名、Windows build >= 22000 且右键功能被选中时尝试注册；取消该功能或卸载时调用移除。当前用户身份不属于该安装目录时不会移除其他位置的登记。注册脚本通过标准 Add-AppxPackage / Remove-AppxPackage，Windows 自行验证签名及信任。PowerShell 的进程级 ExecutionPolicy 参数只用于执行安装目录中的发行脚本，不更改保存的系统策略，不能绕过组织策略或 App Control。

设置 → 上下文菜单也可启停。签名后必须在真实 Windows 11 x64 检查一级菜单、四项操作、多选、重启 Explorer 后显示、升级、卸载和用户文件保留；原生 COM 单测和打包成功不等于上述场景通过。安装步骤的非零返回不会撤销已成功安装的主程序，可在设置中重试。

依据：[微软 IExplorerCommand 与身份包说明](https://learn.microsoft.com/en-us/windows/apps/desktop/modernize/integrate-packaged-app-with-file-explorer)、[外部位置打包与签名要求](https://learn.microsoft.com/en-us/windows/apps/desktop/modernize/grant-identity-to-nonpackaged-apps)。

## 测试与构建要求

原生 C# 继续使用系统 .NET Framework 编译器；新 C++ 扩展需要 Visual Studio 2022 Build Tools x64 与 Windows 10/11 SDK 的 C++ headers / libraries、MakeAppx，签名时需要 SignTool。这些开发工具不随应用分发，扩展静态链接 VC runtime。

```powershell
npm run build:installer
npm test
npm run test:ui
npm run test:features
node scripts/smoke-features.mjs NZIP en-US
node scripts/smoke-features.mjs NZIP zh-TW
npm run test:modern-shell
npm run test:licensing
```

真实 GUI 回归应串行运行，避免测试窗口竞争前台。收费测试使用已有有效隔离测试证书或全新 Windows 测试账户；不要覆盖或删除真实用户的授权缓存。`verify-paid.mjs` 会拒绝覆盖已有缓存。

SFX 模块独立构建，包含原样的 7-Zip 引擎、MIT / LGPL 与上游许可，不包含收费激活代码。可运行生成的 EXE `--licenses` 查看许可；仅解压到新目录，不执行内容。生成的 EXE 仍需足够临时磁盘空间，软件签名与压缩内容加密是不同机制。
