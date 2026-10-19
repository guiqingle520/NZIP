# 0.6.3 / 0.7.2 长路径修复验证

2026-10-19，Windows x64，.NET Framework 4.8，`paid-version` 分支。免费版 0.6.3、收费测试版 0.7.2 共用修复。用户截图显示深层 Java 项目 ZIP 的解压任务失败，异常提示完整路径需短于 260 字符、目录需短于 248 字符；未取得用户原包，因此用等效长路径样本验证。

## 原因与改动

原来只有 manifest 的 longPathAware 和 Main 内的 AppContext 开关，没有明确的 TargetFramework 声明和启动配置。补上这两项后，在本机 `LongPathsEnabled=0` 的条件下，4 项新增长路径测试仍全部失败，表明普通 System.IO 路径调用仍依赖系统行为。

新增 `ArchiveFileSystem.cs`：仅在文件系统 I/O 边界将绝对路径转为 Windows 扩展格式，覆盖驱动器路径和 UNC 格式；枚举返回值转换为常规显示路径。用于源目录遍历、文件存在/属性检查、预分配 FileStream、读取/写入、目录提交/失败清理，以及 ZIP 字段读取、扫描和临时副本等调用。界面、7-Zip 参数和路径安全检查继续使用常规路径，保留原来的目录穿越、链接、重复条目、目标覆盖和取消保护。

同时声明 .NET Framework 4.8，增加程序对应的 `.exe.config`，在运行时初始化阶段关闭旧路径处理及 MAX_PATH 兼容限制；MSI 和 ZIP 均包含此文件。便携版必须完整解压，不应单独复制 EXE。

双击深层文件时仍只提取所选条目；如副本完整路径超过 259 字符，将它移动到该次独立临时输出目录根部，保留原文件名，再交给本地程序。任务“打开结果位置”仍指向包含该副本的目录。内置文本/图片预览使用已经支持长路径的文件流打开。

没有修改 Windows 全局长路径策略、系统安全设置或已有授权缓存。单个文件名长度、整个路径的操作系统上限和外部程序自身限制仍然存在；这次不是无限路径长度支持。

## 验证

| 检查 | 结果 |
| --- | --- |
| 免费版完整引擎与 ZIP 工具回归 | 40 项通过，包含新增 4 项长路径测试 |
| 收费测试版长路径引擎回归 | 4 项通过 |
| 免费版原生界面回归，最终构建 | 25 项通过 |
| 收费测试版原生界面回归，最终构建 | 26 项通过 |
| 原生签名授权、DPAPI 等隔离测试 | 41 项检查通过 |
| 授权服务回归 | 12 项通过 |
| 免费 MSI/ZIP 字节与内容核验 | 9 个文件一致，包含 NZIP.exe.config |
| 收费测试 MSI/ZIP 字节与内容核验 | 11 个文件一致，包含 NZIPPaidPreview.exe.config |

长路径样本包括：10 层中文目录、条目路径超过 260 字符的 ZIP/7Z/TAR.XZ；预分配开和关两种解压；压缩包自身及目标目录的绝对路径超过 260 字符；CRC 错误后不提交目标、清理临时目录。GUI 增加深层 TableCleanupJob.java 的目录浏览、提取、缩短临时副本路径、文件内容与编辑器启动参数检查。编辑器启动器在测试中被记录器替换，未实际启动记事本。UNC 前缀转换已实现，未进行真实网络共享端到端验证。

AMSI 测试按既有约定验证了杀毒引擎不可用时的明确错误，不代表实际杀毒扫描成功。构建过程中有一次新 EXE 启动被 CodeIntegrity 3077 拒绝；没有绕过策略，最终包含完整修复的两个版本均正常运行并通过上述测试。MSI 生成时 WiX 提示 LGHT1105，系统策略不允许运行 ICE 校验；没有实际安装、升级或卸载用户的软件。

## 发布物

| 文件 | 字节数 | SHA-256 |
| --- | ---: | --- |
| NZIP-0.6.3-Setup-x64.msi | 1434645 | 04addf06cf2a3cf24edc17ce5bb31098a9d59b3f7488c8ed8f94e5a952c503f4 |
| NZIP-0.6.3-win-x64.zip | 1268661 | 2a20ee3fe61021a9364d6c13a0bd1f03f310188911fb64c7598af866ffcb89cc |
| NZIPPaidPreview-0.7.2-Setup-x64.msi | 1446278 | edfd2bb2586042d40fc43d8be4b14e74dd9bbe17299d1c66bdc506faa54e0fb4 |
| NZIPPaidPreview-0.7.2-win-x64.zip | 1271817 | af205463223f26c041373a9271944b5ee73cf9e0419d3f8b2cf9546a7a5165b3 |

本地证据：

- 免费界面：`test-results/native-desktop/792eaf6b-3cee-4602-a8cb-9462bc55986d/result.json`
- 收费测试界面：`test-results/native-desktop/b780673e-2050-43d9-8e5f-18955708cfee/result.json`
- 免费打包核验：`test-results/paid-package/f6b1a238-31a3-476a-8e27-76ac8e8a3b97/result.json`
- 收费测试打包核验：`test-results/paid-package/518c454a-0ddc-4c15-ba3d-7f628b067abb/result.json`

微软资料：[Win32 路径长度和扩展路径](https://learn.microsoft.com/windows/win32/fileio/maximum-file-path-limitation)、[.NET 路径兼容开关](https://learn.microsoft.com/dotnet/framework/configure-apps/file-schema/runtime/appcontextswitchoverrides-element)。
