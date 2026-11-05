# 契约 01 · 同源控制面 API

> 本文件是 `/api/*` 路由的**唯一权威形状**。代码（`dsh-plugin/lib/control.js`）偏离这里就是 bug；
> `dsh-plugin/tests/contracts.test.mjs` 会把本文的路径集合与代码逐一对账。
> 改路由必须同 commit 改本文与 `dsh-plugin/README.md`。

## 通用约定

- 前缀 `/plugins/devbridge-remote`，注册在 DSH 的 `webServer` 上，同源，不另起服务。
- `handler` 先过三层：连接来自回环、`Host` 是回环名、带 `Origin` 时同源；
  再要求请求头 `x-devbridge-api` 等于进程启动时生成的随机值（页面注入，不落盘）。
- 请求体 JSON，上限 1 MiB；`OPTIONS` 直接 204。出错返回
  `{ ok: false, error: "<一句话原因>" }`，成功返回 `{ ok: true, ... }`。
- `/api/status` 会返回 `accessToken` 与带令牌的 `pairingUrl`：**只给已通过控制面校验的页面**，
  不得写进日志、文档示例或 issue。
- 控制页本身：`GET /`、`/panel`、`/index.html` 返回内联面板的 HTML，不需要 `x-devbridge-api`。

## 读接口（GET）

| 方法 | 路径 | 作用 | 返回要点 |
| --- | --- | --- | --- |
| `GET` | `/api/status` | 汇总状态 | `tunnel` / `gate` / `config` / `pairingUrl` / `accessToken` / `blockerHelp` / `launchTokenSource` / `launchExchange` |
| `GET` | `/api/health` | 存活探针 | `ok`、`ts`、`uptime` |
| `GET` | `/api/logs` | 增量拉环形日志 | `since` 查询参数，最多 120 条 |
| `GET` | `/api/qr` | 扫码链接的 SVG 二维码 | 隧道未就绪返回 409 |
| `GET` | `/api/config` | 当前配置与可编辑键 | `config`、`editable` |

## 写接口（POST）

| 方法 | 路径 | 作用 | 返回要点 |
| --- | --- | --- | --- |
| `POST` | `/api/start` | 起网关（若未起）并开隧道 | 返回隧道状态 |
| `POST` | `/api/stop` | 停 host 进程 | 返回隧道状态 |
| `POST` | `/api/restart` | 先停后起 | 返回隧道状态 |
| `POST` | `/api/token/rotate` | 轮换访问令牌 | 立刻让旧链接与旧 Cookie 失效 |
| `POST` | `/api/tunnel/forget` | 清掉持久化的隧道 ID / URL / 名 | 下次开启会重建 |
| `POST` | `/api/config` | 写回 `config.json` | 只接受 `editable` 白名单键；端口与 CLI 路径需重启 DSH |
| `POST` | `/api/gate/start` | 单独拉起鉴权网关 | 返回网关状态 |
| `POST` | `/api/launch-url` | 登记 DSH 启动链接（含 `?token=`） | 解析失败返回 400；写回 `state.json` 的 `launchUrl`，供网关换 DSH 会话 |

## 网关自身路径（不经过控制面）

由 `dsh-plugin/lib/gate.js` 在公网侧处理，**不是** `/api/*`，不参与上面的自动对账：

| 路径 | 作用 |
| --- | --- |
| `/?t=<令牌>` | 扫码一次性入口，校验后签发会话 Cookie |
| `/__devbridge__/login` | 登录页（GET）/ 提交令牌（POST） |
| `/__devbridge__/enter` | 已登录时重新签发 Cookie |
| `/__devbridge__/logout` | 清除会话 Cookie |
| `/__devbridge__/health` | 仅回环可访问的运行统计 |

除上述路径外，所有请求都要先过令牌 / Cookie / 限流，再被代理到 DSH。
