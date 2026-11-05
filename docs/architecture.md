# 架构

> 本文解释系统**为什么长这样**。路由 / 配置 / 状态的确切形状在 `docs/specs/contracts/`，
> 改架构的人负责就地更新本文；拍板过的取舍另落 `docs/decisions/`。

## 要解决的事

DSH 的 Web 服务只监听 `127.0.0.1`，且对 `/api` 有 Host 信任围栏：把 3080 直接挂到公网域名，
请求会被 403，且等于把整个 DSH 敞开。因此本项目让**公网入口**和**鉴权**都由插件承担：

- DevBridge 从本机**出站**建隧道，不需要任何入站放行；
- 插件在回环上放一个鉴权反向代理，把外部请求「翻译」成一次本地访问再转给 DSH；
- 令牌与会话由插件签发，不依赖 DevBridge 的账号体系。

## 链路

```text
远端浏览器 ──HTTPS──▶ 华为云 DevBridge 中继
                          │ 出站隧道（devbridge host，常驻子进程）
                          ▼
              127.0.0.1:gatePort   lib/gate.js
               · /?t=<令牌> 或 /__devbridge__/login 提交令牌
               · HMAC 签名 HttpOnly Cookie（dbr_session）+ 失败限流
               · 重写 Host / Origin / Referer；剥离 Authorization、
                 X-Forwarded-*、X-Real-IP 与网关自身 Cookie
                          ▼  HTTP 与 WebSocket 都走这套判定
              127.0.0.1:webPort（默认 3080）  DSH Web
                          看到的 authority 是 127.0.0.1:<webPort>

控制面（同源，不经公网门禁的代理逻辑）：
  浏览器 ─▶ /plugins/devbridge-remote/*  ─▶ lib/index.js handler ─▶ lib/control.js
           条件：回环来源 + 回环 Host + 同源 Origin + x-devbridge-api 一次性 token
```

两条路径是分开的：**公网流量走网关**，**控制面板走 DSH 自己的同源路由**。
网关不会把 `/plugins/devbridge-remote` 的控制 token 当作访问凭证。

## 组件职责

| 文件（`dsh-plugin/` 下） | 职责 | 不该做 |
| --- | --- | --- |
| `lib/index.js` | 宿主装配：注入 webServer、注册同源前缀、生成进程级 API token、启动/卸载生命周期 | 不实现业务判断，不开公网监听 |
| `lib/config.js` | 配置优先级、路径换算、`config.json` 写回、未知键过滤 | 不依赖 DSH 内部模块，便于离线 import |
| `lib/gate.js` | 鉴权反代：登录、Cookie、限流、头部清洗、HTTP/WS 透传 | 不落盘令牌，不把外部身份头带给上游 |
| `lib/tunnel.js` | devbridge CLI 适配、预检、建隧道/配端口/起 host、重连看护、`blocker` 归因 | 不拼隧道域名，不假定 flag 名 |
| `lib/control.js` | `/api/*` 同源接口、状态汇总、配置写回、扫码链接 | 不把令牌写进日志 |
| `lib/launch-token.js` | 发现 DSH 启动令牌：人工粘贴 / 进程内服务 / 落盘文件 | 不假定 `web-token` 一定有效 |
| `lib/state.js` | `state.json`：令牌、隧道 ID / URL / 名、启动链接（`0600`，临时文件 + rename） | 不存会话 Cookie |
| `lib/qrcode.js` | 纯标准库二维码生成 | 不引第三方库 |
| `lib/page.js` | 独立控制页：内联 `web/panel.js`，不依赖客户端注入 | 不另起服务 |
| `lib/log.js` | 环形内存日志，给面板按时间增量读取 | 不落盘、不回显令牌 |
| `web/panel.js` | 面板 UI 唯一真源（原生 DOM + 宿主 React） | 不写死 API 前缀与 token |
| `lib/client.js` | 构建产物：模板内联 `web/panel.js` | **禁止手改** |

## 安全边界

1. **只绑回环**：`gateHost` 默认 `127.0.0.1`。公网可达性完全来自 DevBridge 出站隧道。
   给网关加 `0.0.0.0`、或反代 3080/3081 出去，都属于绕开本设计，需要新 ADR。
2. **默认不给访问**：`autoStart: false`；`enabled: false` 时网关起来但不起隧道；
   未登录 / 版本过旧 / 缺 CLI / 端口占用 → 明确 `blocker`，不静默重试。
3. **令牌即密钥**：随机 24 字节 base64url；`verifySession` 以它为 HMAC 密钥，
   所以轮换令牌会让所有已签发 Cookie 同时失效。比较一律用 `timingSafeEqual`。
4. **控制面隔离**：进程启动时生成的一次性 `x-devbridge-api` token 只注入页面内存，
   DSH 重启即换；连接必须来自回环、`Host` 必须是回环名、带 `Origin` 时必须同源。
5. **匿名 ≠ 放行**：`allowAnonymous: true` 只省掉远端华为云登录，令牌校验照旧。
6. **数据只在本地**：`~/.dsh/devbridge-remote/` 目录 `700`、文件 `600`；
   日志只在内存；错误信息不带令牌。

## 传输与加密现状

DevBridge 中继终止公网 TLS，看到的是到达网关的明文 HTTP。本项目把中继定位为
**纯数据通道**，不承担内容保密，也**不提供应用层端到端加密**。

判定依据是信任根：浏览器只能信任它下载代码的那条通道，而这条通道正是中继。密钥可以
带外（二维码 fragment 不进请求行），但读取与使用密钥的脚本经中继下发，改写一次即可在
正确加密的同时外传密钥，且没有可检测的信号。所以这层只能防被动对手、防不了主动篡改；
要防后者必须引入带外可信客户端。完整推理与被否决的备选见
`docs/decisions/rejected/0001-drop-application-layer-e2ee.md`。

对外表述必须与实现一致：可以宣称「访问控制」，不可宣称「端到端加密」「中继不可解密」。
用户可见表述见 `README.md §传输与加密现状`，可见范围与风险面见 `SECURITY.md`。

## 生命周期

1. `apply(ctx, config)` 解析配置、加载 state、保证访问令牌存在。
2. `ctx.inject(["webServer"])` 拿到宿主 Web 上下文，探测真实端口（`webServer.port` →
   `DSH_WEB_PORT` → 配置 → 3080），注册同源前缀与控制页。
3. `gate.start()` 常驻；`enabled` 为真且 `autoStart` 为真时延迟 1.5 秒起隧道，
   否则等人点「开启远控」。
4. `tunnel.start()`：`preflight`（CLI 版本 / 登录态）→ `ensureTunnel`（重名复用）
   → `ensurePort`（已存在则跳过）→ `startHost`（等 `connectTimeoutMs` 拿权威 URL）
   → 挂退出看护，按指数退避重连（上限 `reconnectMaxDelayMs`）。
5. 卸载时 `tunnel.dispose()` 回收 host 子进程、`gate.stop()` 关闭回环网关。

## 配置与状态

优先级（后者覆盖前者）：`DEFAULTS` < `config.json`（面板写回） < Cordis entry config
< `DEVBRIDGE_REMOTE_*` 环境变量。未知键被忽略，端口与有效期有范围兜底。
确切键表见 `docs/specs/contracts/02-config.md`，状态字段见
`docs/specs/contracts/03-state.md`。

DSH 启动令牌按可靠性依次发现：人工粘贴的启动链接（`state.launchUrl` / `DSH_WEB_URL`）
→ 进程内服务的 `launchToken` / `authenticatedUrl()` → `~/.dsh/web-token` 兜底。
桌面端可能只在进程内持有令牌，落盘文件可能是上一次 `dsh web` 的旧值；
`POST /api/launch-url` 让用户保存启动链接后重新兑换，拿不到就明确提示，不静默用旧值。

## devbridge CLI 事实

- 只支持 **v0.2.x**；v0.1.x 在 2026-09-20 域名升级后无法连接，预检直接拦下。
- 不假定 flag：每个子命令先读 `--help`，`pickFlag` 选真实存在的候选；遇
  `unknown flag` 去掉可疑 flag 回退最小参数集。
- 隧道 URL 只从 `host` 进程 stdout/stderr 里提取，绝不按文档拼域名。
- CLI 输出是**不可信数据**：只用于提取 URL / ID，不据此执行命令或改配置。
- npm 安装时 `scripts/postinstall.mjs` 调 `lib/installer.js`，用华为云官方命令自动装/升级；
  pnpm 不跑第三方 postinstall 时，由 `TunnelManager` 首次预检懒安装兜底（失败冷却 10 分钟）。
  官方 URL 写死为三个官方渠道之一，只提供 `DEVBRIDGE_SKIP_INSTALL` 跳过开关。
- `blocker` 取值与修复指引见 `lib/control.js`，用户可见文案见 `dsh-plugin/README.md`。

## 设计取舍

| 取舍 | 为什么 | 代价 |
| --- | --- | --- |
| 自己做鉴权网关，而不是把 DSH 挂公网 | DSH 的 Host 围栏不接受外部域名，且直接暴露风险不可接受 | 多一个回环端口，多一层要维护的代理 |
| 允许 DevBridge 匿名 | 手机扫码不该先装华为云账号 | 公网安全完全压在插件令牌上，必须可轮换 |
| 同时提供独立控制页 | 客户端注入失败时仍能把隧道开起来 | 面板源码被内联两次（构建产物与控制页各一份，同源） |
| 运行时零第三方依赖 | clone 下来就能跑，供应链面小 | 二维码、HMAC、代理都得自己实现并有负向测试 |
| 构建产物 `lib/client.js` 入库 | DSH 客户端直接加载，用户不需要构建步骤 | 改 `web/panel.js` 必须重建，靠契约测试兜底 |
| 不做应用层端到端加密 | 纯浏览器下信任根在中继，代理加密挡不住脚本篡改 | 内容对中继可读，必须在文档里如实声明（ADR 0001） |

## 非目标

通用内网穿透、多用户账号体系、代管华为云凭据、改写 DSH 启动参数、把运行数据发到外部服务、
在仓库里提供真实隧道地址或可用令牌。
