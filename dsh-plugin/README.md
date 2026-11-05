# dsh-remote-huaweicloud-devbridge · DSH 插件

把本机的 DSH Web 界面通过华为云 DevBridge 的**出站隧道**交给远端设备远控：
侧边栏一个席位，点开是隧道状态、网关状态、访问令牌、二维码与日志。

公网侧的门禁由插件自己的鉴权网关承担，不依赖 DevBridge 的账号体系，也不改 DSH 启动参数。
仓库级介绍见 `README.md`，架构见 `docs/architecture.md`。本文中的路径一律相对仓库根目录；
npm 包内只带 `lib/`、`web/`、`scripts/`、`cordis.patch.yml` 与本文件，不含 `docs/` 和根目录文档。

## 包结构

```text
dsh-plugin/
├─ package.json               # dsh.bundle(patch) / dsh.client(inject) / exports / files
├─ cordis.patch.yml           # 把插件挂进 web profile，给安全默认值
├─ lib/
│  ├─ index.js                # 宿主装配：同源控制面、一次性 API token、生命周期
│  ├─ config.js               # 配置优先级、路径换算、config.json 写回
│  ├─ gate.js                 # 鉴权反向代理（HTTP + WebSocket）
│  ├─ tunnel.js               # devbridge CLI 适配、host 常驻与重连看护
│  ├─ control.js              # /api/* 同源接口
│  ├─ launch-token.js         # 找 DSH 启动令牌（进程内服务 / 手工粘贴 / 落盘兜底）
│  ├─ state.js                # state.json（0600，临时文件 + rename）
│  ├─ qrcode.js               # 纯标准库二维码生成
│  ├─ page.js                 # 独立控制页（内联面板，不依赖客户端注入）
│  ├─ log.js                  # 环形内存日志
│  ├─ client.template.js      # 浏览器半的包装模板
│  └─ client.js               # 构建产物：内联了 web/panel.js，禁止手改
├─ web/panel.js               # 面板 UI 的唯一真源
├─ scripts/build-client.mjs   # 重建 lib/client.js
├─ scripts/doctor.mjs         # 独立体检：Node / 文件 / CLI / 登录态 / 端口 / 权限
├─ scripts/install-cli.sh     # 装 devbridge CLI v0.2.x；--check 只下载审阅不执行
└─ tests/                     # 离线自测（注入 CLI / 端口，不连真实中继）
```

运行时零第三方依赖，Node >= 22.5。前端 `React` 由 DSH 宿主 `require("react")` 提供。

## 装

```bash
# 发布前：装本地目录
dsh plugin --profile web add ~/dsh-remote-huaweicloud-devbridge/dsh-plugin
dsh web

# 发布到 npm 后：
# dsh plugin --profile web add dsh-remote-huaweicloud-devbridge
```

`cordis.patch.yml` 安装时把插件插进 profile 组合，默认值：`enabled: true`、
`autoStart: false`、`gatePort: 3081`、`tunnelExpirationHours: 72`、`protocol: auto`、
`allowAnonymous: true`。**首次装完不会自动联网**，要在侧边栏点「开启远控」。

```bash
npm run doctor                      # 一键体检（不依赖 DSH 进程），阻塞项会给修复指引
sh scripts/install-cli.sh --check  # 要看官方安装脚本内容：只下载并打印前 8 行，不执行
devbridge auth login               # 浏览器登录；或用 HW_API_KEY 环境变量配合 --api-key
```

体检退出码：`0` 全部就绪、`1` 有警告、`2` 有阻塞项；不会打印 `HW_API_KEY` 的值。
npm 公开包的 `postinstall` 会用华为云官方命令自动装好 CLI（pnpm 与跳过开关见根 `README.md §装`）。

## 首次配置：华为云账号与登录

面板「开通指引」有同样内容的可折叠速查。从零开始：

1. [华为云官网](https://www.huaweicloud.com/) 注册并实名认证；DevBridge 是开发者空间的免费开发隧道，无需 ECS / 公网 IP。
2. 登录 [开发者隧道 DevBridge](https://devstation.connect.huaweicloud.com/space/devbridge) 开通服务。
3. 装 CLI v0.2.x：`sh scripts/install-cli.sh`（`--check` 只下载审阅）；v0.1.x 旧域名已停用，须升级并重建隧道。
4. 登录二选一（v0.2.x 已移除 AK/SK）：浏览器授权用 `devbridge auth login`；无人值守用 [API Key 管理页](https://devstation.connect.huaweicloud.com/space/devbridge/apikey) 创建密钥（只显示一次），`export HW_API_KEY='粘贴你的密钥'` 后执行 `devbridge auth login --api-key "$HW_API_KEY"`。
5. `npm run doctor` 体检；面板显示 `auth-required` 即未登录。API Key 与扫码令牌都不要进仓库或日志。

## 用

| 面板上的动作 | 发生了什么 |
| --- | --- |
| 开启远控 | 预检 CLI → 建/复用隧道 → 配端口 → 起常驻 host → 从 host 输出取公网 URL |
| 扫码 / 复制链接 | 生成 `https://<隧道域名>/?t=<令牌>` 的二维码与链接 |
| 轮换令牌 | 换掉签名密钥，旧链接与已签发的会话 Cookie 同时失效 |
| 保存并重新兑换 | 粘贴 DSH 启动链接（含 `token=`），重新发现令牌并兑换 DSH 会话 Cookie |
| 停止 / 重启 / 忘记隧道 | 停 host、按需重建；「忘记」会清掉持久化的隧道 ID |
| 改配置 | 写回 `~/.dsh/devbridge-remote/config.json`（`600`）；端口与 CLI 路径需重启 DSH 生效 |
| 粘贴 DSH 启动链接 | DSH 桌面端常把启动令牌只放内存；扫码后若主界面报 `authentication required`，把 `dsh web` 打印的完整链接粘进「DSH 会话兑换」保存一次，网关即可在服务端换到 DSH 会话 Cookie |

不依赖客户端注入时，可直接打开独立控制页 `http://127.0.0.1:3080/plugins/devbridge-remote/`。

## 配置

优先级（后者覆盖前者）：`DEFAULTS` < `config.json`（面板写入） < Cordis entry config
< 环境变量（前缀 `DEVBRIDGE_REMOTE_*`）。常用项：

| 键 | 默认 | 说明 |
| --- | --- | --- |
| `autoStart` | `false` | 是否在 DSH 启动后自动开隧道；默认必须人工确认 |
| `gateHost` / `gatePort` | `127.0.0.1` / `3081` | 鉴权网关监听地址，**只绑回环** |
| `webPort` | `0` | `0` 表示运行时向 `ctx.webServer` 探测 DSH 实际端口 |
| `tunnelExpirationHours` | `72` | 隧道有效期，范围 1–720 |
| `allowAnonymous` | `true` | 远端免华为云登录；**不等于免插件令牌** |
| `sessionTtlMinutes` / `maxFails` / `failWindowMs` | `720` / `10` / `600000` | 会话有效期与同 IP 失败限流 |

确切形状在 `docs/specs/contracts/02-config.md`；本表只是速查，冲突时以契约为准并同 commit 改文档。

## 同源 API

控制面前缀 `/plugins/devbridge-remote`，请求需带页面注入的 `x-devbridge-api` 头；
独立控制页会自动带上。典型接口：`GET /api/status`、`POST /api/start`、
`POST /api/stop`、`POST /api/token/rotate`、`GET /api/qr`、`POST /api/config`、
`POST /api/launch-url`。
完整路由、方法与返回体在 `docs/specs/contracts/01-api.md`。

## 连不上怎么办

面板会给出 `blocker` 与一句能照着做的指引，常见几类：

| blocker | 处理 |
| --- | --- |
| `cli-missing` / `cli-broken` | `sh scripts/install-cli.sh` 装 v0.2.x，再 `npm run doctor` 复核 |
| `cli-outdated` | v0.1.x 域名已下线：升级 CLI 后重建隧道 |
| `auth-required` | 执行 `devbridge auth login`，或设置 `HW_API_KEY` 后登录 |
| `gate-failed` | `gatePort` 被占用：`lsof -nP -iTCP:3081 -sTCP:LISTEN` 查一下，改端口后重启 DSH |
| host 已启动但无 URL | 看面板日志的中继连通性提示；必要时点「忘记隧道」重建 |
| 扫码后 DSH 主界面报 `authentication required` | 桌面端常把启动令牌只放内存，`~/.dsh/web-token` 是旧值。把 `dsh web` 打印的完整链接粘进面板「DSH 会话兑换」保存一次，重新扫码 |

先跑 `npm run doctor`，它会按上表逐项给出「就绪 / 警告 / 阻塞」；
发布前的剩余待办见 `docs/implementation/PROGRESS.md`。

## 安全默认

只绑回环、默认不自动联网、令牌可一键轮换；转发前重写 authority 并剥离外部身份头与
网关自身 Cookie。完整威胁模型与数据处理见 `SECURITY.md`。
**不要**把 `gateHost` 改成 `0.0.0.0`，也不要把 3080 / 3081 直接反代到公网。

## 传输与加密现状

华为云 DevBridge 只是数据通道：中继终止公网 TLS，在端到端加密接入完成前能看到到达
网关的明文 HTTP。`lib/e2ee.js` 已实现应用层加密核心（ECDH P-256 → HKDF-SHA256 →
AES-256-GCM，AAD 绑定会话 / 方向 / 序号防重放，二维码带网关公钥指纹防替换），
但浏览器侧 WebCrypto 实现与网关 / 面板接线尚未完成、**默认未启用**。接入完成后
应用层载荷才对中继不可读；页面 JS 仍经中继加载，不防主动篡改脚本。详见仓库根
README 的「传输与加密现状」与 `SECURITY.md`。

## License

MIT，见同目录 `LICENSE`（npm 包内自带）。
