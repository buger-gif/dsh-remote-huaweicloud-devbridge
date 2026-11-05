# 0002 · DSH 会话 Cookie 自动刷新

- 状态：实施中
- 目标版本：0.1.3
- 日期：2026-11-05

## 背景

DSH 重启后，浏览器里仍保留上一次进程签发的 `dsh-auth-<authority-hash>` Cookie。
网关自己的 `dbr_session` 由插件的 `accessToken` 签名，跨重启仍然有效；于是网关放行，
把旧的 `dsh-auth-*` 原样转给新 DSH 进程。新进程用新的签名密钥/authority 校验，
返回：

```
dsh web authentication required; reopen the URL printed by dsh web.
```

实测（2026-11-05）：DSH 重启到 `127.0.0.1:53213` 后，本地带旧 Cookie 请求返回 401；
同一网关会话重新打开 `/?t=<token>` 后立即恢复 200。根因不是隧道、不是网关令牌，
而是网关只在 `/?t=` / 登录时兑换 DSH Cookie，日常导航不刷新。

## 方案

1. **缓存兑换结果**：`Gate` 把 `launch token` 兑换回来的 `set-cookie` 解析为
   `{ name, value }` 存入内存；不落盘、不写日志。
2. **懒刷新**：任何已通过网关鉴权的 HTTP 请求在转发前调用 `ensureDshCookies()`；
   缓存为空时在服务端执行一次兑换，多请求共享同一个 in-flight Promise。
   没有可用 launch token 时冷却 5 秒，避免每个请求都打 DSH。
3. **转发时注入**：`buildUpstreamHeaders()` 增加可选会话 Cookie 参数；注入前删掉客户端
   发来的同名 Cookie 与所有 `dsh-auth-*` 旧项，再写入当前缓存值。
   这样浏览器即使握着旧 Cookie，上游也只会看到新值。
4. **WebSocket 同样处理**：`upgrade` 路径在建立上游连接前 await 同一份缓存并注入。
5. **登录路径复用**：`#grant()` 兑换后同步更新缓存，浏览器仍会收到完整 `set-cookie`。
6. **不改变鉴权边界**：网关仍先校验 `dbr_session` / `x-devbridge-auth`；本改动只在
   「已放行」之后决定转发哪组 DSH Cookie。

涉及文件：`dsh-plugin/lib/gate.js`、`dsh-plugin/tests/gate.test.mjs`、`CHANGELOG.md`、
`dsh-plugin/package.json`、`lib/index.js`、`lib/control.js`、本 spec 与归档表。

## 非目标

- 不绕过 DSH 的 BrowserAuth，不伪造 Cookie；只是用现有 launch token 换取新 Cookie。
- 不把 DSH Cookie、launch token 写入磁盘、日志、`state.json` 或 `/api/status`。
- 不做多用户隔离：一条隧道仍对应一个本机 DSH 实例，网关只负责访问控制。
- 不改 launch token 的发现顺序与人工粘贴兜底。

## 验收

- [x] 纯函数：解析 `set-cookie`；注入时替换同名 Cookie、清掉旧 `dsh-auth-*`、
      未提供缓存时保持原有 Cookie。
- [x] 集成：带有效 `dbr_session` + 旧 `dsh-auth-*` 请求 `/api/echo`，上游只看到新 Cookie；
      首次请求自动触发兑换。
- [x] WebSocket：升级请求携带旧 Cookie 时，上游收到注入后的新 Cookie。
- [x] 未认证请求仍被挡在登录页，网关 Cookie 不泄漏给 DSH。
- [x] `bash scripts/gate.sh` 全绿；`npm pack --dry-run` 干净。
- [ ] 发布 0.1.3 后重启 DSH，直接打开根路径不再出现 `dsh web authentication required`。

## 契约影响

- [ ] `docs/specs/contracts/01-api.md`（路由）
- [ ] `docs/specs/contracts/02-config.md`（配置键 / 默认值）
- [ ] `docs/specs/contracts/03-state.md`（状态字段）
- [x] 都不涉及：无新路由/配置键/状态字段；`/api/status` 的 `launchExchange` 形状不变。
