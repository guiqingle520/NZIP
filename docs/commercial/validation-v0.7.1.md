# 0.7.1 列表索引越界修复记录

2026-10-11，Windows x64，`paid-version` 分支。用户截图显示在读取“多格式.tar.xz”时出现 .NET “索引超出范围，参数名 index”。截图没有异常调用栈，尚不能断言唯一触发路径。

源码确认虚拟列表存在刷新顺序缺陷：`RefreshFiles` 先替换 `visible`，再清空原生选择、更新 `VirtualListSize`；`ShowHome` 先清空数据再把原生行数设为 0。Windows 控件在清空选择、更新行数时可能同步请求旧行号，原来的 `RetrieveVirtualItem` 直接访问 `visible[index]`，因此旧行号会越界。

修复统一经过 `SetVisibleRows`：保持旧数据，清空选择并把原生行数设为 0，再替换数据、恢复新行数；批量更新使用 `BeginUpdate/EndUpdate`。过期虚拟行请求返回空行；选中条目、双击本地打开和内置内容预览使用同一边界检查。

新增原生界面回归使用 256 个文件，滚动并选中最后一行，分别切换空目录、搜索无结果、关闭压缩包。测试在同步选择事件中主动读取旧行，以检查刷新顺序；还请求负数、旧行号和最大整数行号，并重新打开真实 TAR.XZ。测试期间收到的未处理 UI 异常会导致失败，不能仅凭后续检查通过就报告成功。

| 验证 | 结果 |
| --- | --- |
| .NET Framework 原生编译 | 通过，EXE 文件版本 0.7.1.0 |
| MSI / ZIP 生成 | 通过，MSI 1,446,124 字节，ZIP 1,269,980 字节 |
| MSI / ZIP 与构建目录比对 | 10 个文件全部一致，未包含私钥、授权证书或数据库 |
| 收费版安装身份、沿用目录注册键和卸载指令 | 静态打包检查通过，保留原 UpgradeCode |
| 修改的 JavaScript 脚本语法 | 通过 |
| 新增界面回归及整套原生界面测试 | **阻塞，程序未启动，不能计为通过** |
| 实际安装 / 升级 / 卸载 | 未运行 |

执行 `scripts/smoke-native.js` 时 Node 报 `spawn UNKNOWN`。Windows CodeIntegrity 日志在 16:05:41 记录事件 3077，明确拒绝加载 `dist/NZIPPaidPreview-0.7.1-win-x64/NZIPPaidPreview.exe`；同时记录 Smart App Control 事件 3118。测试基线构建也被相同策略拦截，因此本次没有获得“旧版失败、新版通过”的运行证据。没有更改系统安全策略、添加排除项或通过其他宿主加载被拦截程序。后续需要在允许该程序的发行验证环境补跑界面回归。

0.7.0 的历史引擎、授权和界面结果仍保留在其独立记录中，不作为 0.7.1 的运行通过证据。授权设计与现有测试缓存未更改。

| 发布物 | SHA-256 |
| --- | --- |
| NZIPPaidPreview-0.7.1-Setup-x64.msi | a1a2c39c54de7780e837c7b5efab09e4e4b1b0dce405cd77f1ef086ac6cfc50b |
| NZIPPaidPreview-0.7.1-win-x64.zip | 10c5f53b0dd8f9aa27ec1c5c42b0f85ce049fca7add14c1e44994e3acfd2305a |

本机打包核验明细：`test-results/paid-package/f660d82d-d2d7-4b2a-9536-4f7f55a89245/result.json`。WiX 提示 LGHT1105：本机策略不允许运行 ICE 校验；生成 MSI 不代表实际安装已验收。
