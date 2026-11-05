# 契约 02 · 配置键与默认值

> 本文件是 `dsh-plugin/lib/config.js` 中 `DEFAULTS` 的**唯一权威形状**。
> `dsh-plugin/tests/contracts.test.mjs` 会把本文的键集合与默认值逐一对账。
> 新增、改名、删键或改默认值，必须同 commit 改本文、`dsh-plugin/README.md` 与
> `docs/architecture.md §配置与状态`。

## 优先级

`DEFAULTS` < `~/.dsh/devbridge-remote/config.json`（面板写回） < Cordis entry config
< 环境变量 `DEVBRIDGE_REMOTE_*`（后者覆盖前者）。未知键静默忽略；`writeConfigFile`
只写用户真正改过的键。`config.json` 目录 `700`、文件 `600`。

## 键与默认值

| 键 | 类型 | 默认值 | 说明 |
| --- | --- | --- | --- |
| `enabled` | bool | `true` | 插件总开关；为 false 时网关仍起但不开隧道 |
| `autoStart` | bool | `false` | DSH 启动后是否自动开隧道，默认必须人工确认 |
| `gateHost` | string | `127.0.0.1` | 鉴权网关监听地址，只绑回环 |
| `gatePort` | number | `3081` | 鉴权网关端口 |
| `webHost` | string | `127.0.0.1` | 上游 DSH Web 地址 |
| `webPort` | number | `0` | `0` 表示运行时向 `ctx.webServer` 探测 |
| `tunnelName` | string | `""` | 为空时按主机名生成并复用 |
| `tunnelDescription` | string | `dsh远控隧道` | 建隧道时的描述 |
| `tunnelExpirationHours` | number | `72` | 隧道有效期（小时） |
| `protocol` | string | `auto` | 端口协议 |
| `allowAnonymous` | bool | `true` | 远端免华为云登录，不等于免插件令牌 |
| `devbridgeBin` | string | `""` | 显式 CLI 路径；为空时按候选路径查找 |
| `apiKeyEnv` | string | `HW_API_KEY` | 环境变量**名**，值永不写入仓库 |
| `accessToken` | string | `""` | 为空时随机生成并写入 `state.json` |
| `sessionTtlMinutes` | number | `720` | 网关会话 Cookie 有效期（分钟） |
| `maxFails` | number | `10` | 同 IP 失败次数上限 |
| `failWindowMs` | number | `600000` | 失败计数窗口（毫秒） |
| `reconnect` | bool | `true` | host 异常退出后是否重连 |
| `reconnectDelayMs` | number | `5000` | 首次重连延迟 |
| `reconnectMaxDelayMs` | number | `60000` | 退避上限 |
| `connectTimeoutMs` | number | `20000` | 等 host 吐出 URL 的超时 |
| `logLevel` | string | `info` | `debug` / `info` / `warn` / `error` / `silent` |

## 取值范围与兜底

- `gatePort` 必须在 1–65535，越界回落到 `3081`；`webPort` 越界回落 `0`（自动探测）。
- `tunnelExpirationHours` 夹到 1–720；`sessionTtlMinutes` 最小 1。
- 布尔键接受 `0/false/no/off/空串` 为假；数值键非数字时回落到默认值。
- `pickKnown` 只接受上表里的键：拼错的配置不会静默生效。

## 环境变量对照

`enabled` → `DEVBRIDGE_REMOTE_ENABLED`，`autoStart` → `DEVBRIDGE_REMOTE_AUTOSTART`，
`gateHost` / `gatePort` → `DEVBRIDGE_REMOTE_GATE_HOST` / `DEVBRIDGE_REMOTE_GATE_PORT`，
`webHost` / `webPort` → `DEVBRIDGE_REMOTE_WEB_HOST` / `DEVBRIDGE_REMOTE_WEB_PORT`，
`tunnelName` → `DEVBRIDGE_REMOTE_TUNNEL_NAME`，
`tunnelExpirationHours` → `DEVBRIDGE_REMOTE_EXPIRE_HOURS`，
`protocol` → `DEVBRIDGE_REMOTE_PROTOCOL`，
`allowAnonymous` → `DEVBRIDGE_REMOTE_ALLOW_ANONYMOUS`，
`devbridgeBin` → `DEVBRIDGE_BIN`，`apiKeyEnv` → `DEVBRIDGE_REMOTE_API_KEY_ENV`，
`accessToken` → `DEVBRIDGE_REMOTE_TOKEN`，
`sessionTtlMinutes` → `DEVBRIDGE_REMOTE_SESSION_TTL`，
`maxFails` → `DEVBRIDGE_REMOTE_MAX_FAILS`，
`failWindowMs` → `DEVBRIDGE_REMOTE_FAIL_WINDOW_MS`。
完整映射以 `dsh-plugin/lib/config.js` 的 `ENV_KEYS` 为准。
