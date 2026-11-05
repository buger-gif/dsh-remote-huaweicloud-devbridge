# 当前断点与发布前待办

> 新会话第一读取点。本文是**唯一允许写时效指针**的地方：就地改写，不做沿革。
> 开源标准与红线在 `AGENTS.md`，文档规矩在 `docs/README.md`。

## 现在到哪了（2026-11-05 19:58 核对）

**已公开发布 0.1.3，发布通道仍是 OIDC。** GitHub 公开仓库
<https://github.com/buger-gif/dsh-remote-huaweicloud-devbridge>（topics `dsh` / `dsh-plugin`）；
npm 包最新版 `dsh-remote-huaweicloud-devbridge@0.1.3`，由 `v0.1.3` tag 经
Trusted Publishing 发布，仓库与账号里都不存在长期发布令牌。

已核对的读数：

- `bash scripts/gate.sh`：**6/6 全绿**（js-check / docs / contracts / secrets / tests / redlines）；
  `v0.1.3` 的 GitHub Actions `test` 与 `publish` 工作流均 success；
- npm 侧：`dist-tags.latest = 0.1.3`，tarball 直连 **HTTP 200 / 61,277 字节**，
  22 个文件；`0.1.3` 带 SLSA provenance（`dist.attestations`）；
- 包页 <https://www.npmjs.com/package/dsh-remote-huaweicloud-devbridge> 正常渲染 `0.1.3` 与中文 README；
- 0.1.2 的端口自动对账已在临时隧道实测；spec 0001 已归档；
- 0.1.3 修复 DSH 重启后的旧会话 Cookie：网关内存缓存 launch token 兑换结果，并在每个
  已鉴权 HTTP / WebSocket 请求转发前注入上游。单测覆盖纯函数、HTTP 注入与 WS 注入；
- 本机 desktop profile 已安装 `0.1.3`；当前运行进程仍是 `0.1.2`，**重启 DSH 后**验证
  「带旧 Cookie 直接打开根路径不再报 `authentication required`」，spec 0002 待归档；
- 包设置页 Trusted Publisher：`buger-gif` / 本仓库 / `publish.yml`，状态 **Valid**，
  权限 `npm publish` + `npm stage publish` + `npm dist-tag`；
- 发布访问策略已收紧为 **disallow bypass 2fa tokens**（npm 推荐项）；
- `NPM_TOKEN` secret 已删除；历史 granular token 已全部吊销；
- 仓库描述已按实际改为「中继只是数据管道、可见明文；保护来自令牌网关而非加密」。

## 还没做完（不阻塞首发，但要盯）

1. **应用层加密已否决（ADR 0001）**：密码学核心与单测已随决策移除，`lib/` 下不再有
   `e2ee.js`。对外一律按「中继可见明文」表述；这不是待办，翻案须新起 ADR。
2. **`0.0.0-stage` 残留版本**：仍在版本列表（`5 Versions`），但不指向 `latest`、
   不影响安装、不再出现在包页首屏。删除它需要 OTP，而 `npm unpublish` 被 npm 新策略
   拒绝（bypass-2FA 令牌不得执行该操作），网页亦不提供删除单版本入口。
   需要清掉时用支持 WebAuthn 的设备带 OTP 执行 `npm unpublish ...@0.0.0-stage`。
3. **版本硬编码三处**：`lib/index.js`（2 处）/ `lib/control.js`（1 处），当前 `0.1.3`，
   长期改为从 `package.json` 读取；契约测试保证一致且不允许新增第四处。
4. **本地发版已不可用 bypass 令牌**：策略收紧后只能走 OIDC（打 tag）或带 OTP 的交互式发布。
   这是预期行为，不要为了「图方便」把策略调回去。
5. **端口对账假设隧道专用**：启动时会删除 `gatePort` 以外的端口；若未来允许把其他服务
   挂进同一条隧道，必须先重新设计清理边界并补 ADR。
6. **spec 0002 待重启验收**：安装已完成，但运行进程还是 0.1.2；重启 DSH 后按验收项
   复核并归档。

## 发布流程（现状）

1. 改 `CHANGELOG.md`「未发布」小节 → 改成 `## X.Y.Z — YYYY-MM-DD`；
2. 同步 `dsh-plugin/package.json` 与 `lib/index.js`（2 处）、`lib/control.js`（1 处）的版本号；
3. `bash scripts/gate.sh` 全绿 → 提交 `chore(release): vX.Y.Z` → 打 tag 并推送；
4. `publish.yml` 用 OIDC 发布并附 provenance，自检查 packument `versions` + tarball 直连。
