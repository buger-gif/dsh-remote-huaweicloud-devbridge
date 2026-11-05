# 0003 · 控制面 Host 校验收紧

- 状态：实施中
- 目标版本：0.1.4
- 日期：2026-11-05

## 背景

控制面路由 `/plugins/devbridge-remote/*` 用 `hostIsLocal()` 判断 Host 是否回环；
旧实现是 `/^127\./` 前缀匹配。实测：

```
Host: 127.0.0.1:50716          -> 200（正常）
Host: 127.0.0.1.evil.com:50716 -> 200（应按 403 拒绝）
Host: 127.0.0.1.nip.io:50716   -> 200（应按 403 拒绝）
```

攻击者可以让浏览器以 `127.0.0.1.<attacker-domain>` 为 Origin 打开页面，再用 DNS
rebinding 指到 `127.0.0.1`：浏览器发出的 Host 以 `127.` 开头，旧校验通过；控制页
由回环来源渲染，且会注入 `x-devbridge-api` token，同源脚本可读取后调用控制 API
（启停隧道、轮换访问令牌、改配置）。这是控制面接管风险，必须在发布版里修掉。

注意：DSH 自身的 Host 围栏对 `127.*` 前缀也放行，但根页面仍需 DSH 登录；插件控制页
是回环来源直接渲染，所以本插件必须自己收紧，不能依赖宿主。

## 方案

- `hostIsLocal()` 只接受精确的 `127.0.0.1`、`localhost`、`::1`；拒绝
  `127.0.0.1.evil.com`、`127.0.0.1.nip.io`、`localhost.evil.com` 等前缀变体。
- `originOk()` 复用同一严格判断；Host / Origin 必须完全一致。
- 增加集成回归：带 `x-devbridge-api` 且 Host 为 `127.0.0.1.evil.com` 的控制面请求
  必须 403；正常 loopback Host 仍然 200。
- 不改变网关（公网入口）的 Host 重写与鉴权；该改动只涉及本机控制面。

涉及文件：`dsh-plugin/lib/index.js`、`dsh-plugin/tests/integration.test.mjs`、
`CHANGELOG.md`、版本号三处、本 spec 与归档表。

## 非目标

- 不修改 DSH 自身的 Host 围栏；已把宿主行为记录在这里，需另行向 DSH 反馈。
- 不改变 `/__devbridge__/health` 的公开统计、登录限流粒度或 Cookie `Secure` 标记；
  这些是独立的低/中风险硬化项。
- 不引入新的鉴权头或配置键。

## 验收

- [x] 单测/集成：`Host: 127.0.0.1.evil.com`、`127.0.0.1.nip.io`、`localhost.evil.com`
      访问控制页与 API 均 403；`127.0.0.1` / `localhost` 仍 200。
- [x] 带正确 `x-devbridge-api` 也不能绕过 Host 校验。
- [x] `bash scripts/gate.sh` 全绿；`npm pack --dry-run` 干净。
- [ ] 发布 0.1.4 并安装后，复测 DNS rebinding Host 返回 403。

## 契约影响

- [ ] `docs/specs/contracts/01-api.md`（路由）
- [ ] `docs/specs/contracts/02-config.md`（配置键 / 默认值）
- [ ] `docs/specs/contracts/03-state.md`（状态字段）
- [x] 都不涉及：只收紧已有控制面的 Host 判断，路由、配置键与状态字段不变。
