# 当前断点与发布前待办

> 新会话第一读取点。本文是**唯一允许写时效指针**的地方：就地改写，不做沿革。
> 开源标准与红线在 `AGENTS.md`，文档规矩在 `docs/README.md`。

## 现在到哪了（2026-11-05 19:20 核对）

**已公开发布，且发布通道已切换到 OIDC。** GitHub 公开仓库
<https://github.com/buger-gif/dsh-remote-huaweicloud-devbridge>（topics `dsh` / `dsh-plugin`）；
npm 包最新版 `dsh-remote-huaweicloud-devbridge@0.1.1`，由 `v0.1.1` tag 经
Trusted Publishing 发布，仓库与账号里都不存在长期发布令牌。

已核对的读数：

- `bash scripts/gate.sh`：**6/6 全绿**（js-check / docs / contracts / secrets / tests / redlines）；
- npm 侧：`dist-tags.latest = 0.1.1`，tarball 直连 **HTTP 200 / 58,185 字节**，
  22 个文件，**已无 `e2ee` 相关文件**；`0.1.1` 带 SLSA provenance（`dist.attestations`）；
- 包设置页 Trusted Publisher：`buger-gif` / 本仓库 / `publish.yml`，状态 **Valid**，
  权限 `npm publish` + `npm stage publish` + `npm dist-tag`；
- 发布访问策略已收紧为 **disallow bypass 2fa tokens**（npm 推荐项）；
- `NPM_TOKEN` secret 已删除；本轮创建的两个 granular token 已全部吊销；
- 包页 <https://www.npmjs.com/package/dsh-remote-huaweicloud-devbridge> 正常渲染 `0.1.1` 与中文 README；
- 仓库描述已按实际改为「中继只是数据管道、可见明文；保护来自令牌网关而非加密」。

## 还没做完（不阻塞首发，但要盯）

1. **应用层加密已否决（ADR 0001）**：密码学核心与单测已随决策移除，`lib/` 下不再有
   `e2ee.js`。对外一律按「中继可见明文」表述；这不是待办，翻案须新起 ADR。
2. **`0.0.0-stage` 残留版本**：仍在版本列表（`3 Versions`），但不指向 `latest`、
   不影响安装、不再出现在包页首屏。删除它需要 OTP，而 `npm unpublish` 被 npm 新策略
   拒绝（bypass-2FA 令牌不得执行该操作），网页亦不提供删除单版本入口。
   需要清掉时用支持 WebAuthn 的设备带 OTP 执行 `npm unpublish ...@0.0.0-stage`。
3. **版本硬编码三处**：`lib/index.js`（2 处）/ `lib/control.js`（1 处），当前 `0.1.1`，
   长期改为从 `package.json` 读取；契约测试保证一致且不允许新增第四处。
4. **本地发版已不可用 bypass 令牌**：策略收紧后只能走 OIDC（打 tag）或带 OTP 的交互式发布。
   这是预期行为，不要为了「图方便」把策略调回去。

## 发布流程（现状）

1. 改 `CHANGELOG.md`「未发布」小节 → 改成 `## X.Y.Z — YYYY-MM-DD`；
2. 同步 `dsh-plugin/package.json` 与 `lib/index.js`（2 处）、`lib/control.js`（1 处）的版本号；
3. `bash scripts/gate.sh` 全绿 → 提交 `chore(release): vX.Y.Z` → 打 tag 并推送；
4. `publish.yml` 用 OIDC 发布并附 provenance，自检查 packument `versions` + tarball 直连。
