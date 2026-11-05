# dsh-remote-huaweicloud-devbridge

把本机 DeepSeek Harness（DSH）的 Web 界面安全地交给远端设备远控：侧边栏点一下「开启远控」，
扫个码，手机/另一台电脑就能打开你本机跑着的 DSH。

**华为云 DevBridge 只是数据通道**：它只负责从本机**出站**打通一条隧道，
不参与身份判断、不保存你的会话内容。公网侧真正的门禁由插件自带的鉴权网关承担——
一次性令牌、HMAC 会话 Cookie、失败限流，以及转发前把所有外部身份头剥干净。

仓库内置了应用层端到端加密的核心实现（ECDH P-256 + HKDF-SHA256 + AES-256-GCM，
设计目标是让中继只能转发密文、解不出内容），但**浏览器侧接入尚未完成，当前默认未启用**。
上线前请读 `§传输与加密现状`，不要把这层当成已经生效的保护。

> 当前实现状态与发布前待办见 `docs/implementation/PROGRESS.md`。

## 开着它会发生什么

```text
手机浏览器 ──HTTPS──▶ 华为云 DevBridge 中继
                          │ 出站隧道（本机发起，无需公网入站端口）
                          ▼
                    devbridge host
                          ▼
              127.0.0.1:3081  插件鉴权网关
               · 扫码链接 /?t=<令牌> 或登录页输入令牌
               · 签发 HttpOnly 会话 Cookie，失败限流
               · 重写 Host / Origin / Referer，剥离外部身份头
                          ▼
              127.0.0.1:3080  DSH Web（看到的仍是一次本地访问）
```

1. 装好插件、启动 DSH，侧边栏底部出现「华为云远控」席位。
2. 前置检查：devbridge CLI 需 v0.2.x 且已登录（v0.1.x 的域名已下线）。
3. 点「开启远控」→ 面板给出公网链接与二维码 → 手机扫码 → 直接进 DSH。
4. 不用了点「停止」，或在面板「轮换令牌」让所有旧链接与旧会话立刻失效。
5. 隧道最长 72 小时；`autoStart` 默认关，**插件不会自己联网**。

面板里能看到隧道状态、网关状态、日志与可执行的前置检查修复指引；连不上时不会只显示
一个转圈，而是明确告诉你是「CLI 没装 / 版本过旧 / 没登录 / 端口占用」中的哪一种。

## 装

前置：Node >= 22.5（运行时零第三方依赖）、一个启用 web profile 的 DSH、
devbridge CLI v0.2.x 且已完成 `devbridge auth login`。`HW_API_KEY` 是可选环境变量**名**，
请把值放在本机环境里，不要写进任何配置文件或提交。

```bash
dsh plugin --profile web add dsh-remote-huaweicloud-devbridge
dsh web

# 或从源码装本地目录
# dsh plugin --profile web add ~/dsh-remote-huaweicloud-devbridge/dsh-plugin
```

**npm 公开包会自动装 CLI**：`postinstall` 检测 `devbridge`，已是 v0.2.x 则跳过；
未装或 v0.1.x 就原样执行华为云官方命令（`curl -fsSL <官方渠道>/install.sh -o <临时文件>`
+ `bash <临时文件> -s`；Windows `irm .../install.ps1 | iex`），装完复核版本。URL 固定为
官方三渠道之一，不接受环境变量覆盖；`DEVBRIDGE_SKIP_INSTALL=1` 可跳过，失败只告警、不阻断安装。
`dsh plugin add` 走 pnpm（默认不跑第三方 postinstall），所以首次「开启远控」还会按需懒安装
（失败冷却 10 分钟）；手动补装用 `npx dsh-devbridge-install`。登录仍需用户自己完成。

插件通过 `cordis.patch.yml` 挂进 web profile；默认 `enabled: true`、`autoStart: false`、
`gatePort: 3081`、`allowAnonymous: true`（含义见下方安全说明）。配置项、API 速查与排障
在 `dsh-plugin/README.md`，参数确切形状在 `docs/specs/contracts/02-config.md`。

## 30 秒上手

1. 打开侧边栏「华为云远控」，或直接访问 `http://127.0.0.1:3080/plugins/devbridge-remote/`
   （独立控制页，不依赖客户端注入）。
2. 点「开启远控」，等状态变成「已连接」，复制公网链接或扫二维码。
3. 远端打开链接，若提示登录，粘贴面板上的访问令牌。用完点「停止」。

想改端口、隧道名、有效期、协议或 CLI 路径，在面板里改；端口与 CLI 路径类改动需重启 DSH 生效。

## 安全须知（用之前先看）

- **只绑回环**：网关默认只监听 `127.0.0.1`。不要改成 `0.0.0.0`，
  也不要用反向代理把 3080 / 3081 直接对公网开放——那会绕开插件的门禁。
- **`allowAnonymous` 不是免鉴权**：它只让远端免华为云账号登录，访问仍必须过插件令牌。
  想再加一层，把它设为 false，远端就得先用华为云账号登录 DevBridge。
- **令牌即钥匙**：扫码链接里带令牌，别贴进 issue、聊天或截图。怀疑泄露就在面板
  「轮换令牌」，或删掉 `~/.dsh/devbridge-remote/state.json` 后重启让旧令牌全部失效。
- **状态只在本机**：`~/.dsh/devbridge-remote/` 目录 `700`、文件 `600`，
  存放令牌、隧道 ID 与上次公网 URL；不上传、不进第三方日志。
- 完整风险面与私密漏洞报告通道见 `SECURITY.md`。

## 传输与加密现状（请勿误读）

**华为云 / DevBridge 只承担数据通道。** 隧道由本机出站发起，中继把远端浏览器的
HTTP / WebSocket 送到 `127.0.0.1:gatePort`；DSH 本身只监听回环。中继会终止公网
TLS，**在端到端加密接入完成前，理论上能看到到达网关的明文 HTTP**。隧道不提供
内容级保密，网关的令牌 / Cookie / 限流属于访问控制，不是加密。

**已实现**：`dsh-plugin/lib/e2ee.js` 提供应用层加密核心（零第三方依赖），
`dsh-plugin/tests/e2ee.test.mjs` 覆盖 Node 侧互操作：

- 二维码带 8 字节网关公钥指纹（带外、摄像头扫描不触网）；浏览器生成临时
  ECDH P-256 密钥对，校验网关公钥哈希与指纹一致，挡住中继替换公钥；
- HKDF-SHA256 派生 32 字节主密钥，再拆成 `c2s` / `s2c` 两个方向密钥；
- AES-256-GCM，12 字节随机 IV，AAD 绑定 `sid|方向|序号`，序号严格递增防重放。

**尚未完成**：浏览器侧 WebCrypto 实现（`web/e2ee-shim.js`）、网关握手路由与面板
接线都不在仓库里，这层加密**默认未启用**。只有接入完成并默认开启后，应用层载荷
才对中继不可读；现在请不要按「密文不可解密」来判断链路安全性。

**边界（接入完成后依然成立）**：页面 JS 本身仍经中继加载，可防被动窃听、日志留存
与公钥替换，**不防中继主动篡改页面脚本**（那需要带外可信客户端）；时间、流量大小、
IP 等元数据也不在保护范围内。

## 自测与开发

```bash
# 仓库根
bash scripts/gate.sh --quick              # 语法 / 文档 / 契约 / 密钥扫描

# 插件目录
cd dsh-plugin
npm test                                  # 离线单测：CLI 与端口都注入假实现
npm run doctor                            # 独立体检：Node / CLI / 登录态 / 端口 / 权限
npm run build:client                      # 改了 web/panel.js 后重建 lib/client.js
```

不接真实中继、不需要华为云账号。开发规范与开源标准见 `AGENTS.md`，
贡献流程见 `CONTRIBUTING.md`，文档导航见 `docs/README.md`。

## 参与贡献

欢迎提 issue 与 PR。请先读 `CONTRIBUTING.md`：一次提交一件事、提交前跑门禁、
示例数据必须虚构、不要带进真实隧道地址与令牌。行为准则见 `CODE_OF_CONDUCT.md`。

## License

MIT，见 `LICENSE`。
