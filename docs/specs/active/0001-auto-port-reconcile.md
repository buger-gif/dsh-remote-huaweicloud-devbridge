# 0001 · 隧道端口自动对账与唯一入口

- 状态：实施中
- 目标版本：0.1.2
- 日期：2026-11-05

## 背景

DevBridge 的 `host` 会给隧道里**每一个已配置端口**各打印一行 `Tunnel URL:`；公网端口
`P` 转发到本机同号端口 `P`。插件真正监听的只有 `gatePort`（默认 `3081`），其余端口
后面没有本机服务，中继对它们的请求返回 `502 bad gateway`。

旧行为有两个问题：

1. `ensurePort()` 只用子串判断 `gatePort` 是否出现在 `port list` 文本里；隧道里的历史
   残留端口（重复调试、旧版本留下的映射）不会被清理。
2. `startHost()` 把最后看到的 `Tunnel URL` 当成唯一入口；多端口时经常挑中死端口，
   写进 `state.tunnelUrl`、面板和二维码，用户扫码后只看到 `bad gateway`。

用户不该知道端口、映射、残留这些词，更不该被要求手工执行 `devbridge port delete`。
实测（2026-11-05，本机）：隧道有 10 个端口时只有 `3081` 返回 `302 → 200`，其余 9 个
均为 `502`；在本机临时监听其中一个端口后，对应公网端口立刻可达，确认是同号转发。

## 方案

1. **端口解析纯函数**：新增 `parsePortList(text)`，从 `port list` 表格中只取首列合法端口
   号（去 ANSI 色码、忽略表头 / 空行 / 非数字），返回排序去重后的数组。
2. **自动对账**：把 `ensurePort()` 改为 `reconcilePorts()`：
   - `port list <tunnelId>` 成功时，删除所有不等于 `gatePort` 的端口；`gatePort` 永不删除；
   - 清理后若 `gatePort` 仍不存在，再走原有 `port create`（保底逻辑不变）；
   - 删除前先读 `port delete --help`，CLI 不支持 `--port-number` / `-p` 就跳过清理并继续；
   - 单个端口删除失败只降级（debug 日志），不阻塞启动；
   - `port list` 失败时不删任何端口，继续原有创建逻辑（fail-open）。
3. **唯一 URL 选择**：新增 `extractTunnelUrls(text)` / `pickTunnelUrl(text, gatePort)`；
   `startHost()` 维护跨 chunk 的行缓冲，按完整行解析：
   - DevBridge 把端口放在 hostname 首段（`<tunnelId>-<port>.domain`），
     `urlPort()` 同时识别显式端口与该形式；
   - 优先选端口等于 `gatePort` 的 URL；
   - 只有一个 URL、端口与 `gatePort` 不同，且对账已确认隧道里只剩 `gatePort` 时，
     按 host 输出接受（兼容服务端分配不同公网端口）；
   - 多个 URL 且没有匹配项时**不更新** `state.tunnelUrl`，启动超时后给出可执行的提示。
4. **对用户屏蔽**：不新增配置键、按钮、状态字段；清理逐端口日志用 `debug`，默认 `info`
   级别不可见；面板和二维码始终只拿到一个经过筛选的 URL。清理失败也不把端口细节抛给用户。
5. **回归方式**：纯函数单测 + 注入假 CLI 的启动链测试；再用一条临时隧道做真实 CLI 验证
   （建端口 → 对账 → 只剩 `gatePort` → 删除临时隧道），不触碰用户正在用的隧道。

涉及文件：

- `dsh-plugin/lib/tunnel.js`
- `dsh-plugin/tests/tunnel.test.mjs`
- `CHANGELOG.md`、`dsh-plugin/README.md`、`docs/implementation/PROGRESS.md`
- 本 spec 与 `docs/specs/archive/README.md`

## 非目标

- 不做通用端口管理面板，不新增 `prune` 配置开关；自动清理就是默认且唯一的行为。
- 不把网关绑到非回环地址，不改 `allowAnonymous` / 令牌 / Cookie / 限流语义。
- 不改 `host` 启动参数（不引入 `-p` 限定），以实际 `Tunnel URL` 为权威来源。
- 不处理“用户把其他服务故意挂进同一条隧道”的场景：该隧道归插件专用，非 `gatePort`
  端口一律视为残留。README 会把这条写成前提。

## 验收

- [x] `parsePortList` 覆盖 ANSI、表头、空行、重复、越界值；`pickTunnelUrl` 覆盖多行、
      单行不同端口、无匹配、跨 chunk 断行。
- [x] 注入假 CLI：多余端口被删除且不删 `gatePort`；缺 `gatePort` 时先清理再创建；
      删除能力缺失或删除失败时不阻塞启动，最终仍拿到 `gatePort` URL。
- [x] 真实 CLI：临时隧道建两个额外端口 → 对账后只剩 `gatePort` → 删除临时隧道；
      用户现有隧道不在验证中改动。
- [ ] `bash scripts/gate.sh` 全绿；`cd dsh-plugin && npm pack --dry-run` 干净。
- [ ] 发布 0.1.2 后，面板/二维码固定为 `gatePort` 入口，旧端口链接不再生成。

## 契约影响

- [ ] `docs/specs/contracts/01-api.md`（路由）
- [ ] `docs/specs/contracts/02-config.md`（配置键 / 默认值）
- [ ] `docs/specs/contracts/03-state.md`（状态字段）
- [x] 都不涉及：清理是插件内部行为；不新增路由、配置键或 `state.json` 字段，
      `tunnel.status()` / `/api/status` 的返回形状保持不变。
