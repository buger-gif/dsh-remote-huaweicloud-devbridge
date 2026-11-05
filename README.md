# dsh-remote-huaweicloud-devbridge

把本机 DeepSeek Harness（DSH）的 Web 界面安全地交给远端设备远控：侧边栏点一下「开启远控」，
扫个码，手机/另一台电脑就能打开你本机跑着的 DSH。

**华为云 DevBridge 只是数据通道**：它只负责从本机**出站**打通一条隧道，不参与身份判断。
公网侧真正的门禁由插件自带的鉴权网关承担——一次性令牌、HMAC 会话 Cookie、失败限流，
以及转发前把所有外部身份头剥干净。它是否留存经过的流量不在本项目控制范围内。

**不提供端到端加密。** 中继会终止公网 TLS，能看到到达网关的明文 HTTP；这是评估后
主动否决的方案（`docs/decisions/rejected/0001-drop-application-layer-e2ee.md`），
不是待办事项。动手前请读 `§传输与加密现状`，不要按「密文」理解这条链路。

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
- **内容对中继可见**：链路不做端到端加密，聊过什么、跑过什么命令，中继理论上都看得到。
  别用它传递你不愿让云厂商留存的内容。
- 完整风险面与私密漏洞报告通道见 `SECURITY.md`。

## 传输与加密现状（请勿误读）

**本项目不做应用层端到端加密。** 华为云 / DevBridge 只是数据通道：隧道由本机出站发起，
中继把远端浏览器的 HTTP 与 WebSocket 送到 `127.0.0.1:gatePort`，并在边缘终止公网 TLS。
所以**中继理论上能看到到达网关的明文 HTTP**——聊天正文、工具输出、审批内容、DSH 启动
令牌都在内。网关的令牌 / HMAC Cookie / 限流是**访问控制**，不是加密。

**为什么不加密。** 纯浏览器下密钥可以带外（二维码里的 URL fragment 不会进入 HTTP 请求），
但**处理密钥的代码**——引导页、Service Worker、DSH 前端——全部经中继下发。中继改写一次
脚本，就能在正确加密的同时把密钥外传，而密文正常、公钥指纹校验照旧通过、无法检测。
所以这层只能防被动对手（日志留存、审计调取、抓包、流量镜像），防不了主动篡改；要防后者
必须引入带外可信客户端，与「手机只有一个浏览器」直接冲突。评估过程与被否决的备选
（TCP 透传、带外代理、自建 VPS 等）见
`docs/decisions/rejected/0001-drop-application-layer-e2ee.md`。

| 中继能看到 | 中继看不到 |
| --- | --- |
| 全部 HTTP / WebSocket 载荷、请求路径、包长与时序、出口 IP、连接时长、页面脚本与静态资源 | `~/.dsh/devbridge-remote/` 内的令牌与隧道状态（不随报文外发，可轮换作废）、网关内存里的会话状态 |

**因此本项目的安全承诺只有一条：谁能进，而不是内容保密。** 需要内容保密时，正确做法是
换数据面（自己终止 TLS 的入口）或换客户端（带外可信 App），本项目两者都不提供。

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
