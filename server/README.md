# NZIP 授权服务

实现设计 v1.2：首次激活联网，设备签名证书永久离线有效。默认 3 个服务器当前登记名额，自助解绑立即释放，历史证书不远程撤销。没有累计激活上限或普通换机冷却时间。

服务使用 **Node.js 24.14.x、内置 node:sqlite、SQLite WAL**，无 npm 运行依赖。此实现替代设计草案中建议的 ASP.NET Core；客户端仍为 C# / .NET Framework 4.8，不安装 Node.js 或本地服务。SQLite 在此 Node 版本会输出实验性 API 提示；部署应固定已验证的 Node 版本，升级前跑测试。服务支持单实例写入、SQLite 事务和同机管理员 CLI，暂不提供多区域数据库或支付平台集成。

## 初始化与发行

在仓库根目录执行，域名用自己的真实域名替换：

```powershell
node server/admin.mjs init server/secrets/config.json https://license.YOUR-DOMAIN
```

生成的 `server/secrets/` 已被 Git 忽略：RSA-3072 私钥、SQLite 数据库位置、独立存储加密密钥、激活码 HMAC 密钥及配置。**完整备份这些文件，仅授权服务账户和发行管理员可读取。** 客户端只接收 `client-public.json` 中的公钥和服务地址，构建脚本只提取这两个公开字段。不得将 secrets 文件夹、数据库或管理员工具打进安装包。

在 config.json 的 `mail.from` 填已验证发信域名的邮箱，`mail.apiKey` 填邮件服务 API 密钥。目前邮件适配器使用 [Resend 官方发送接口](https://resend.com/docs/api-reference/emails/send-email)，可替换 `deliverEmail` 接入自己的邮件网关。测试注入本地捕获器，**不会向任何真实邮箱发送邮件**。

```powershell
node server/main.mjs server/secrets/config.json
```

服务仅监听 `127.0.0.1:8787`，前置 HTTPS 反向代理，publicUrl 必须与客户端编译地址及网站 Origin 一致。配置在启动时读取，修改后重启。不能直接将 loopback HTTP 端口暴露给客户。默认临时频率保护为每个后端连接 IP 每分钟 120 个 API 请求；反向代理后连接共享 IP，应根据客户规模调整并在代理按真实客户端 IP 限流，不能盲信客户端提供的 X-Forwarded-For。

参考 Nginx 配置（证书路径按部署环境替换）：

```nginx
server {
    listen 443 ssl;
    server_name license.YOUR-DOMAIN;
    ssl_certificate /etc/ssl/nzip/fullchain.pem;
    ssl_certificate_key /etc/ssl/nzip/privkey.pem;
    client_max_body_size 16k;
    add_header Strict-Transport-Security "max-age=31536000" always;
    location / {
        proxy_pass http://127.0.0.1:8787;
        proxy_set_header Host $host;
        proxy_read_timeout 25s;
    }
}
```

## 发码、设备与换机

首版采用管理员人工录入已付款订单，不自动判断支付完成。订单编号唯一，重复发码会拒绝；激活码仅此次显示，应保存到受控订单记录并按实际销售流程交付客户。

```powershell
node server/admin.mjs issue server/secrets/config.json ORDER-001 buyer@their-domain.com CUST-001 3
```

客户在客户端输入激活码；同一 Windows 安装重复激活不占第二个名额。换机可在原电脑点击“解绑并释放名额”；旧电脑丢失时，打开服务首页，通过购买邮箱验证码管理设备。激活码本身不能远程删除客户设备。不需要注册账号，邮箱验证码 10 分钟有效、最多 5 次尝试、重发至少 60 秒，管理会话 15 分钟。

管理员可执行 `node server/admin.mjs show <config> ORDER-001` 查看订单与登记状态，或 `node server/admin.mjs update <config> ORDER-001 changes.json` 维护。changes.json 支持 `slots`（1–100，不能低于当前登记数）、`pauseNew`（仅暂停新登记，不影响已有离线证书）和 `rotateCode`（显示一次新激活码并停用旧码）。例如 `{"slots":3,"pauseNew":false,"rotateCode":true}`。这些命令依赖服务器操作系统账户权限，没有暴露给客户端的 HTTP 管理员接口。

管理网页令牌只保留在页面内存中，不写入 URL/localStorage，不使用自动携带的认证 Cookie；API 使用显式 Bearer 头和同源校验，避免 Cookie 会话的 CSRF。每个会话只访问同购买邮箱的订单设备。

完全离线的例外客户可在客户端导出 `.nziprequest` 申请文件，管理员在**授权服务器**上执行：

```powershell
node server/admin.mjs offline server/secrets/config.json ORDER-001 request.nziprequest computer.nziplicense
```

离线发证同样登记名额并使用相同限额事务。文件只含本机证书，不含激活码、邮件地址或设备管理令牌；客户导入后即可使用，通过购买邮箱自助解绑。写文件失败时可对同一订单、同一申请重试到新文件名，不会再占名额。

## 存储、安全边界与维护

`licenses` 合并本版的订单、购买邮箱、限额和激活码散列；`bindings` 保存当前状态和 generation；`grants` 保留发证历史；`mutations` 保存幂等结果；`challenges`、`sessions` 保存邮箱管理状态；`audit` 保存管理员发码/离线发证记录。数据库存购买邮箱和电脑名称，须按发行方隐私政策保护。

激活限额检查、状态更新、签名、幂等响应持久化位于 `BEGIN IMMEDIATE` 事务内，提交后才返回；任何失败回滚。解绑依据 bindingId+generation，旧请求不能删除重新激活的设备。设备 token 散列存储，幂等完整响应经独立 AES-256-GCM 密钥加密；请求体、邮箱验证码、激活码和 token 不写服务日志。管理员控制台会显示新发的激活码，这是交付入口，勿收集进公共日志。

定期通过 SQLite backup API 或停服务后备份数据库及 secrets，不能只复制正在写入的主 .sqlite 文件而忽略 WAL。storageKey/pepper 必须与数据库一同恢复，不能直接替换；更换签名密钥时客户端保留旧公钥，以便历史永久证书继续验证。版本更新不绑定精确小版本。

永久离线证书发出后无法可靠撤销：解绑后保留的旧证书、完整系统克隆和管理员修改客户端仍可能继续运行。这是已确认的产品取舍。常规用户没有定期联网要求，也不会因服务临时故障而失去离线使用权。

## 验证

```powershell
npm run test:licensing
node --test tests/licensing.test.mjs
node --test tests/licensing-portal.test.mjs
```

本地测试使用临时数据库、测试密钥和邮件捕获器；包括签名协议互通、并发名额、失败回滚、重放、换机、邮箱管理、客户端 DPAPI 和网页实际操作。测试根密钥不会进入正式构建。生产 HTTPS、真实邮件到达、实际 Windows 安装/升级和代码签名需在正式发行配置下验收。
