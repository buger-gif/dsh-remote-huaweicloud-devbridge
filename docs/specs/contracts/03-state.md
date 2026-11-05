# 契约 03 · 状态与凭据存放

> 本文件是运行时状态的**唯一权威形状**。改 `dsh-plugin/lib/state.js` 的字段或路径，
> 必须同 commit 改本文、`SECURITY.md` 与 `docs/architecture.md §配置与状态`。
> 所有真实值都只落在本机，任何一份都不进仓库。

## 顶层

| 键 | 类型 | 写入者 | 说明 |
| --- | --- | --- | --- |
| `accessToken` | string | `ensureToken` / `rotateToken` | 随机 24 字节 base64url；为空时自动生成 |
| `tunnelId` | string | `ensureTunnel` / `/api/tunnel/forget` | devbridge 隧道 ID，忘记隧道时清空 |
| `tunnelUrl` | string | `startHost` / `/api/tunnel/forget` | 只取自 `host` 进程输出的权威 URL |
| `tunnelName` | string | `ensureTunnelName` | 按主机名生成一次并复用 |
| `launchUrl` | string | `POST /api/launch-url` | 用户粘贴的 DSH 启动链接（含 `?token=`）；桌面端把令牌只放内存时的人工兜底，**优先级最高** |

## 落盘位置

| 文件 | 权限 | 内容 |
| --- | --- | --- |
| `~/.dsh/devbridge-remote/state.json` | 目录 `700`、文件 `600` | 上表五个键 |
| `~/.dsh/devbridge-remote/config.json` | 目录 `700`、文件 `600` | 用户改过的配置键（可能含 `accessToken`） |
| `~/.dsh/web-token` | 由 DSH 管理 | 旧版 `dsh web` 落盘的启动 token；桌面端常不更新，插件只把它当最后兜底，优先从进程内 `connection` 服务发现 |

写入一律「临时文件 + rename」，避免半截 JSON；`state.json` 解析失败按空对象处理，
不因坏文件让插件起不来。

## 只在内存里的东西

| 数据 | 生命周期 | 说明 |
| --- | --- | --- |
| 控制面 `x-devbridge-api` token | 进程内，DSH 重启即换 | `lib/index.js` 启动时随机 24 字节 hex，注入页面内存 |
| 网关会话签名密钥 | 与 `accessToken` 相同 | 轮换令牌即换密钥，旧 Cookie 立即失效 |
| 失败计数 Map | 进程内 | 同 IP 失败限流，窗口过期即清 |
| 环形日志 | 进程内，上限 300 条 | 面板按 `since` 增量拉取，重启即空 |
| `host` 子进程与输出尾 | 进程内 | 卸载时回收，不写日志到磁盘 |

## 令牌生命周期

1. `apply` 时 `config.accessToken || state.ensureToken()` 得到访问令牌。
2. 面板「轮换令牌」调用 `rotateToken()`，并同步给 `Gate.accessToken`；
   旧扫码链接、`?t=` 与所有已签发 `dbr_session` Cookie 同时失效。
3. 怀疑泄露又打不开面板：删掉 `state.json`（或整个 `~/.dsh/devbridge-remote/`）后重启 DSH，
   会生成全新令牌。**先让它失效，再清理历史**。
4. 令牌不写进日志、错误信息、文档示例、issue 或截图。
