# 0.7.0 首版验证记录

2026-10-11，Windows x64，`paid-version` 分支。测试使用隔离密钥、临时数据库与本地邮件捕获器，无真实邮件发送。

| 验证 | 结果 |
| --- | --- |
| Windows 签名协议、证书拒绝与 DPAPI | 41 项通过 |
| 服务事务、限额、重放、换机与管理员维护 | 12 项通过 |
| 购买邮箱管理页真实浏览器操作 | 1 个端到端测试通过 |
| 收费 EXE 压缩引擎回归 | 36 项通过 |
| 收费版原生界面 | 24 项通过 |
| 免费 / 收费打开方式与右键注册隔离 | 两组通过，使用注册表沙箱 |
| MSI 和 ZIP 内容比对 | 10 个文件全部一致，安装身份与目录注册键隔离检查通过 |
| 正式构建拒绝测试公钥配置 | 通过 |
| 30 次普通启动 | 中位数 481 ms，P95 769 ms |

首次未激活测试验证了 8 个收费 RPC 入口均返回 LICENSE_REQUIRED，即便设置 NZIP_TEST_MODE 也不会解锁；目录预览包含 ZIP 和 TAR.XZ。导入本机设备证书后，实际打包 EXE 跨进程完成压缩、测试、解压；错误设备导入保留原授权。永久证书测试刻意使用 2000 年签发时间，验证其没有到期限制。

启动采用普通程序启动，无测试模式/调试器，25 ms 轮询首帧就绪报告，首轮新配置目录，后续复用；未清空操作系统缓存，不能视为严格冷启动结果。免费兼容构建被本机 Windows 应用控制策略拒绝启动（Win32 4551 / CodeIntegrity 3077），因此未完成免费版回归或“免费版 +100 ms”P95 差值验收。

当前发布物是 **NZIPPaidPreview 测试构建**，公钥与授权缓存独立于正式收费版。MSI 生成成功，WiX 提示 LGHT1105，ICE 校验无法按本机策略执行；未运行实际安装、升级、卸载或 UAC 操作。正式 HTTPS、真实邮件到达、正式密钥和代码签名尚需发行环境验收。

本机测试缓存已由验证流程建立。后续清理被自动审批拒绝，原因返回“blocked by policy”；缓存被保留，仅属于 NZIP Paid Preview，不访问免费版或正式收费版授权目录。

| 发布物 | SHA-256 |
| --- | --- |
| NZIPPaidPreview-0.7.0-Setup-x64.msi | e169e352bb7cc80826f37f254706ce79b5c19a8681c856a08957bbbe471e69ba |
| NZIPPaidPreview-0.7.0-win-x64.zip | f644131d91da0477792ab443909426a038df44bdacba8649c21be6f780dcf150 |
| NZIPPaidPreview.exe | cb31594d0d4f14fdf6b767bc269b10038cd95432d0d1becfc90c6374a34c0d6b |

本地明细：`test-results/commercial-0.7.0-validation.json`、`test-results/performance/paid-0.7.0-startup.json`；原生界面截图目录 `test-results/native-desktop/137f12f3-61de-4ae2-b50a-d5e2bfdbffd7`，网页截图目录 `test-results/license-portal/2669a707-946b-4bc0-885e-a5c48c0b910b`。这些测试数据不上传 GitHub。
