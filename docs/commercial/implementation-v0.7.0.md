# NZIP 0.7.0 收费版首版实现

当前分支 `paid-version`；依据 [设计 v1.2](design-v1.2.md) 和 [补充评审](design-review-v2.md)。此文记录技术实现与正式发行前仍需完成的配置，测试构建不作为可直接售卖的最终包。

## 已实现

- C# / .NET Framework 4.8 原生客户端，签名授权内置于核心操作入口，包含 GUI 队列、右键/启动参数、命令行 RPC、内容提取及静态修复/扫描等入口。
- 未激活允许目录树、文件列表、搜索、排序和代码页操作。ZIP 和压缩 TAR 的目录读取都可用；压缩 TAR 内部临时展开不被误判为收费解压。
- RSA-3072 / SHA-256 设备证书，签名覆盖 `NZIP-LICENSE-V1`、零字节及原始 UTF-8 payload。校验重复/未知/缺失字段、字段类型、产品、权限和本机设备摘要；最多 16 KiB，不含到期字段。
- Windows 64 位 MachineGuid 规范化为 Windows 安装实例摘要，不能读取时明确报错。每个进程首次使用授权时重新读取实际设备标识。
- DPAPI CurrentUser 缓存，与普通偏好设置、NZIP_USER_DATA 和设置导入导出分离。导出文件仅包含设备证书，不含激活码或设备管理 token。
- 异步联网激活、自助解绑、导入/导出离线证书、导出离线申请、浏览器打开购买邮箱管理页。联网请求限时 20 秒、限制响应体、禁用重定向；错误导入/网络失败保留原有效授权。
- 授权只本地验证，不在启动或每次压缩时请求服务器。已接受的队列任务保留授权快照，正常解绑后新任务重新检查。
- Node.js 24.14.x + SQLite 授权服务、邮箱验证码管理页、管理员发码与例外离线发证 CLI。订单与激活码散列合并在 licenses 表，其余状态、发证、幂等和审计分别存储。无需客户注册账号。
- 事务保护当前登记上限；同设备重复激活不占新名额；历史设备重新激活先检查可用名额。解绑立即释放，不设累计次数/常规冷却期；旧永久离线证书无法撤销的风险按确认决策接受。
- 免费版、收费版、收费测试版使用不同应用 ID、配置目录、互斥锁/管道、注册表、安装目录与 MSI UpgradeCode，可并存。
- 正式收费构建必须显式提供公钥及真实 HTTPS Origin；测试 keyId 被正式构建拒绝。测试信任和私钥仅在忽略的 .cache 中，生产程序没有测试环境激活开关。

## 构建

免费版原路径保持：`npm run build`。

正式收费版需要先完成授权服务配置，使用服务器生成的 **公开** client-public.json：

```powershell
npm run build:paid -- -PublicConfig server/secrets/client-public.json
npm run build:paid-installer -- -PublicConfig server/secrets/client-public.json
```

输出 `dist/NZIPPaid-0.7.0-win-x64.zip`、`dist/NZIPPaid-0.7.0-Setup-x64.msi`。公钥编入 EXE，不从客户可修改的配置文件加载；安装包不包含服务端或私钥。

开发测试构建显式使用 `-Preview` 和测试公钥：

```powershell
npm run test:licensing
# 上一步输出隔离测试目录，用其 client-public.json：
powershell -NoProfile -File scripts/build-installer.ps1 -Edition Paid -Preview -PublicConfig .cache/license-tests/TEST-ID/client-public.json
node scripts/verify-paid.mjs .cache/license-tests/TEST-ID
```

测试构建 ID 为 NZIPPaidPreview，授权缓存为 `%LOCALAPPDATA%\NZIP Paid Preview\License\license.dat`；免费版与正式收费版都不会读取这个缓存。测试配置无线上端点，验证使用本机签名离线证书；它不接受未来正式证书。`verify-paid.mjs` 默认清理自己创建的测试授权；`--keep-license` 用于紧接着跑界面或收费引擎测试。不能覆盖已存在的用户测试授权。

正常交付还需：真实 HTTPS 域名与证书、授权服务器、购买邮箱发信配置、正式密钥备份、销售条款、应用代码签名和实际安装/升级验证。这里的 RSA 授权签名用于证书防伪，不能替代 Windows 安装包/EXE 的 Authenticode 代码签名。

## 验证结果

结果见 [验证记录](validation-v0.7.0.md) 和本地 `test-results/commercial-0.7.0-validation.json`。已有 Windows 原生授权检查、服务事务测试、打包 EXE 的收费入口检查、36 项完整引擎回归及 24 项界面检查。管理网页另有真实浏览器测试；测试使用本地捕获的验证码，不向外发邮件。

免费兼容构建本机启动被 Windows 应用控制策略阻止（Win32 4551 / CodeIntegrity 3077），该次免费版 36 项回归无法运行。收费测试 EXE 可正常运行，不能将免费构建的失败记录宣称通过，也不能据此宣称已经达到免费版 +100 ms 的同机 P95 启动差值标准。

MSI 可生成，但 WiX ICE 校验受本机策略限制；本次不执行 UAC 安装或更改系统安全设置。正式上线 HTTPS/邮件的实际联调、安装/升级/卸载以及代码签名仍待发行环境验收。
