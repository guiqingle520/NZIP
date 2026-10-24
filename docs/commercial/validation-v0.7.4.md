# 0.6.5 / 0.7.4 内存优化与真实场景回归

2026-10-24，Windows x64，`paid-version`。免费 0.6.5；收费测试 0.7.4，沿用现有测试公钥和有效的本机预览授权，没有修改授权缓存或系统安全策略。

## 实现

- 7-Zip 目录输出改为 8 Ki 字符缓冲区读取、逐行解析；不再同时保存整份输出、分行数组和条目模型。保留原 64 Mi 字符总量保护，新增 128 Ki 字符单行保护。保留路径、链接、重复路径、长路径设置和取消检查。
- 每次目录解析的公共字符串池最多 256 项，避免全局驻留；常见时间、算法、属性和平台字符串共享。普通操作的 stdout / stderr 只保留各 8 Ki 字符诊断尾部。
- ZIP 附加字段直接访问现有条目，避免生成第二份完整元数据模型。关闭后替换条目集合、目录树索引，释放旧容量；完成的目录读取取消源及时释放。
- 后台进度变化最多每 100 ms 通知一次；界面最多保留一次待执行任务刷新。用受锁保护的任务快照替代完整状态 JSON 编解码，并修正终态与 `active` 清空先后不一致的竞态。任务完成去重集合随现有任务历史修剪。
- 生产流程没有加入强制 GC。测试中强制 GC 只判断旧模型能否回收。

## 实测方法与结果

真实 ZIP 样本分别包含 10,000 / 100,000 个中文文件名，后者为 ZIP64。256 MiB 大文件由固定种子的 1 MiB 块重复 256 次产生；它不代表所有数据的压缩率。内容 SHA-256：`a8d3cce9abee46913f9d90e8c1eb86b93d2e3d6258f2fd65dca62dbcc690362c`。

免费原生窗口对十万条目反复打开、进入目录、精确搜索、关闭 10 次：每次完整读取 100,000 条目，1001 个目录树节点；进入目录显示 100 个文件和上级导航，搜索命中一项。关闭后条目、虚拟行和树索引归零，归档模型 / 首个条目 / 树根的弱引用全部失效。

| 测量 | 免费版结果 |
| --- | --- |
| 十万条目加载后托管堆，强制 GC 快照 | 约 93.5–93.6 MiB |
| 关闭后托管堆，强制 GC 快照 | 约 2.19–2.21 MiB |
| 第 1 / 10 次关闭后托管字节 | 2,298,176 / 2,318,344，净增长 20,168 字节 |
| 加载后私有内存，同一快照 | 约 149–160 MiB |
| 关闭后私有内存，同一快照 | 约 45–49 MiB |
| 关闭后 GDI，第 1 / 10 次 | 59 / 59 |
| 关闭后 USER，第 1 / 10 次 | 81 / 86 |
| 256 MiB 存储 ZIP 的浏览与解压 | 目录仅一项；预分配实际解压、SHA-256 一致；收到 5 次任务通知；终态完整且后台空闲 |

10 轮通过不等于无限次无泄漏；强制 GC 快照也不是自然工作集峰值。加载耗时与其他测试同时运行，未作为性能结论。

另用普通 `--engine-rpc` 子进程，25 ms 间隔采样 NZIP 与直接引擎子进程，包含完整目录 JSON 序列化，各 3 次，不清 OS 缓存、不强制 GC。一万条目父进程私有内存观察峰值 59.6 / 59.5 / 59.7 MiB；十万条目为 290.1 / 290.2 / 290.0 MiB。序列化临时对象仍是 RPC 的明显开销。采样最大值可能低于真正峰值，PowerShell / Node 测试驱动不计入。

256 MiB 实际压缩回归额外从源文件开始，分别创建 ZIP / 7Z（level 1、单线程），再读取目录、引擎完整性测试、预分配选中解压、流式 SHA-256 验证。两种格式全部通过。ZIP 压缩父进程 / 引擎 / 同时合计观察峰值分别 24.7 / 8.9 / 33.5 MiB；7Z 分别 25.4 / 8.2 / 33.0 MiB。分别取得的父、子最大值不一定同时发生，不能直接相加。更高等级、多线程和大字典可能显著增加引擎内存。

旧版 0.6.4 基线和第一轮中间 0.6.5 构建被 Windows 应用控制拦截（CodeIntegrity 3077 / 3118，初轮全套测试为 spawn UNKNOWN）；它们不计为功能失败或通过。后续实质代码修改完成后的最终构建可正常运行。没有调整系统安全设置，没有有效旧版基线，因此没有内存下降百分比或 Bandizip 速度比较。

## 回归与发布核验

- 流式解析专项 21 项通过：短读、CRLF / Unicode / 无末尾换行、公共字符串共享、路径穿越 / 链接 / 冲突防护、总量与单行上限、未知大小、取消和长路径开关。
- 免费和收费测试版引擎 / 工具全套各 48 项通过，覆盖十种创建格式、RAR / RAR5、复合 TAR、中文长路径、AES、分卷、事务修改、编辑回写、注释、修复、密码恢复、安全路径与取消。
- 免费实际原生界面 29 项通过；收费测试界面 30 项通过，包括授权界面、虚拟列表、搜索、选中解压、任务结果按钮、本地打开和真实确认窗编辑回写。关联程序参数由测试捕获，编辑器寿命使用真实辅助子进程，没有声称已测客户的 Office / VS Code 实例复用。
- 免费 MSI / ZIP 的 9 个文件、收费测试 MSI / ZIP 的 11 个文件逐字节一致，包含长路径运行配置，安装身份和原位置键正确，没有打入私钥或设备授权。ZIP 独立文件核验通过，`--files-only` 明确跳过解包后运行往返。
- AMSI 本机提供者不可用，验证明确反馈，不代表成功检测恶意文件。WiX ICE 校验仍受系统策略限制（LGHT1105）；本次未实际安装、升级或卸载。没有修改安装逻辑或线上授权服务。

收费版同样完成十万条目的 10 轮打开 / 导航 / 搜索 / 关闭、对象弱引用回收，以及 256 MiB 存储 ZIP 的预分配解压和 SHA-256 校验。第 1 / 10 次关闭后托管堆 2,316,712 / 2,329,064 字节，净增长 12,352 字节；GDI 59 / 59，USER 84 / 87，所有目录集合归零。任务终态和后台空闲断言通过，收到 5 次任务通知。收费参数下没有重测三轮 RPC 峰值或从源文件创建大包，前述峰值数据仅为免费版。

## 发布文件

| 文件 | 字节数 | SHA-256 |
| --- | ---: | --- |
| NZIP-0.6.5-Setup-x64.msi | 1446933 | 99cc7447ec7185c6d48f00f4f05253633306477eb147ef1c0e1c34cb4490f9e4 |
| NZIP-0.6.5-win-x64.zip | 1282848 | d373490cabca23d01837829346050a3b206525896cba6b06bb1f87b0c0982de3 |
| NZIPPaidPreview-0.7.4-Setup-x64.msi | 1458566 | 6a1d1cb3285b2489787845325349abcc6a0731934a22f77323debe7258320583 |
| NZIPPaidPreview-0.7.4-win-x64.zip | 1286062 | 820e2d609200c137336b2b2cf652331aa44a71a478c18419b59314643e5a6383 |

## 复现

在 Windows 项目根目录运行，先构建对应版本。Python 3.9+ 用于生成样本，Node / PowerShell 仅为测试驱动。

```powershell
python scripts/memory-fixtures.py test-results/memory/my-fixtures
npm run test:listing
npm test
npm run test:ui
node scripts/smoke-memory.mjs dist/NZIP-0.6.5-win-x64/NZIP.exe test-results/memory/my-fixtures/fixtures.json
node scripts/benchmark-memory.mjs test-results/memory/my-fixtures/fixtures.json --candidate-only dist/NZIP-0.6.5-win-x64/NZIP.exe
node scripts/regress-large.mjs dist/NZIP-0.6.5-win-x64/NZIP.exe test-results/memory/my-fixtures/fixtures.json
```

收费版用同名脚本并传入收费 EXE；引擎 / 界面现有脚本通过 `NZIP_NATIVE_EXE` 指定。收费 EXE 需要有效测试授权，测试模式不绕过门禁。真实文件和输出占用约数 GiB 磁盘，保留在 `test-results`，不随源码上传。

本机证据（不随源码上传）：

- 样本：`test-results/memory/fixtures-2026-10-24/fixtures.json`
- 免费十轮界面内存：`test-results/memory/728e8d15-30ec-42e7-81f9-9fabca5690d7/result.json`
- 收费十轮界面内存：`test-results/memory/7ba4f1d1-33f4-4084-8dc5-1dc5300dee93/result.json`
- 三轮普通进程峰值：`test-results/memory/952a14f9-bad3-454d-9552-b654fe4272ff/result.json`
- 256 MiB ZIP / 7Z 往返：`test-results/memory/b4894533-68a9-419a-80fe-8190bee9654e/result.json`
- 免费界面截图：`test-results/native-desktop/0c8ff8ea-ca18-4374-902a-e135a7af6c7b/`
- 收费界面截图：`test-results/native-desktop/8e409d66-ec13-404b-9463-a2ba0aa00d76/`
- 免费包比对：`test-results/paid-package/ca2f863c-b236-4e65-ae54-51324b1c844a/result.json`
- 收费包比对：`test-results/paid-package/8d74f9e6-40eb-42cf-9617-6df7a51638fd/result.json`
