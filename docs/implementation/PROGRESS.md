# 当前断点与发布前待办

> 新会话第一读取点。本文是**唯一允许写时效指针**的地方：就地改写，不做沿革。
> 开源标准与红线在 `AGENTS.md`，文档规矩在 `docs/README.md`。

## 现在到哪了（2026-11-07 09:05 核对）

**已公开发布 0.1.4，发布通道仍是 OIDC。** GitHub 公开仓库
<https://github.com/buger-gif/dsh-remote-huaweicloud-devbridge>（topics `dsh` / `dsh-plugin`）；
npm 包最新版 `dsh-remote-huaweicloud-devbridge@0.1.4`，由 `v0.1.4` tag 经
Trusted Publishing 发布，仓库与账号里都不存在长期发布令牌。

已核对的读数：

- `bash scripts/gate.sh`：**6/6 全绿**（js-check / docs / contracts / secrets / tests / redlines）；
  `v0.1.4` 的 GitHub Actions `test` 与 `publish` 工作流均 success；
- npm 侧：`dist-tags.latest = 0.1.4`，tarball 直连 **HTTP 200 / 61,385 字节**，
  22 个文件；`0.1.4` 带 SLSA provenance（`dist.attestations`）；
- 包页 <https://www.npmjs.com/package/dsh-remote-huaweicloud-devbridge> 正常渲染 `0.1.4` 与中文 README；
- 0.1.2 的端口自动对账已在临时隧道实测；spec 0001 已归档；
- 0.1.3 修复 DSH 重启后的旧会话 Cookie：网关内存缓存 launch token 兑换结果，并在每个
  已鉴权 HTTP / WebSocket 请求转发前注入上游。已重启实测根路径 200；spec 0002 已归档；
- 0.1.4 修复控制面 DNS rebinding：`hostIsLocal` 只接受精确 `127.0.0.1` / `localhost` /
  `::1`，伪造 Host 即使带正确 API token 也 403；spec 0003 待重启后归档；
- 本机 desktop profile 已安装 `0.1.4`，但运行进程仍是 `0.1.3`；重启前伪造 Host 仍返回
  200，重启后应变为 403；
- 包设置页 Trusted Publisher：`buger-gif` / 本仓库 / `publish.yml`，状态 **Valid**，
  权限 `npm publish` + `npm stage publish` + `npm dist-tag`；
- 发布访问策略已收紧为 **disallow bypass 2fa tokens**（npm 推荐项）；
- `NPM_TOKEN` secret 已删除；历史 granular token 已全部吊销；
- 仓库描述已按实际改为「中继只是数据管道、可见明文；保护来自令牌网关而非加密」；
- 插件市场：已向 `awesome-dsh-plugin/awesome-dsh-plugin` 提交收录 PR
  [#12334](https://github.com/awesome-dsh-plugin/awesome-dsh-plugin/pull/12334)，
  单文件 `data/plugins/buger-gif__dsh-remote-huaweicloud-devbridge--dsh-plugin.yml`，
  分类 `remote`；PR 只加了一个文件，README 不手改。2026-11-07 09:00 复核：regate
  重跑后 **PR check 与 Submission gate 均 pass**（gate 判定 `2026-11-07T01:01Z`），
  PR 为 `MERGEABLE`、无评论、无 `held` 标签，等维护者评审合并；合并后再更新本节。

## 还没做完（不阻塞首发，但要盯）

1. **应用层加密已否决（ADR 0001）**：密码学核心与单测已随决策移除，`lib/` 下不再有
   `e2ee.js`。对外一律按「中继可见明文」表述；这不是待办，翻案须新起 ADR。
2. **`0.0.0-stage` 残留版本**：仍在版本列表（`6 Versions`），但不指向 `latest`、
   不影响安装、不再出现在包页首屏。删除它需要 OTP，而 `npm unpublish` 被 npm 新策略
   拒绝（bypass-2FA 令牌不得执行该操作），网页亦不提供删除单版本入口。
   需要清掉时用支持 WebAuthn 的设备带 OTP 执行 `npm unpublish ...@0.0.0-stage`。
3. **版本硬编码三处**：`lib/index.js`（2 处）/ `lib/control.js`（1 处），当前 `0.1.4`，
   长期改为从 `package.json` 读取；契约测试保证一致且不允许新增第四处。
4. **本地发版已不可用 bypass 令牌**：策略收紧后只能走 OIDC（打 tag）或带 OTP 的交互式发布。
   这是预期行为，不要为了「图方便」把策略调回去。
5. **端口对账假设隧道专用**：启动时会删除 `gatePort` 以外的端口；若未来允许把其他服务
   挂进同一条隧道，必须先重新设计清理边界并补 ADR。
6. **spec 0003 待重启验收**：0.1.4 已安装，运行进程仍是 0.1.3；重启后复测伪造 Host
   必须 403，再归档 spec 0003。
7. **安全硬化项（不阻塞，但记着）**：`/__devbridge__/health` 对公网返回 upstream/stats
   （低敏信息）；限流键在隧道后恒为 `127.0.0.1`，恶意请求可全局锁住登录（可用性 DoS）；
   `POST /__devbridge__/login` 的错误令牌未计入失败限流；`dbr_session` 未加 `Secure`。
8. **市场收录 PR #12334 待合并**：gate 已转绿（`2026-11-07T01:01Z`），等维护者评审
   合并；若被打回，只改自己那条 YAML，不碰别人的条目，也不手工改生成的 README。
   合并后再来更新本节。

## 发布流程（现状）

1. 改 `CHANGELOG.md`「未发布」小节 → 改成 `## X.Y.Z — YYYY-MM-DD`；
2. 同步 `dsh-plugin/package.json` 与 `lib/index.js`（2 处）、`lib/control.js`（1 处）的版本号；
3. `bash scripts/gate.sh` 全绿 → 提交 `chore(release): vX.Y.Z` → 打 tag 并推送；
4. `publish.yml` 用 OIDC 发布并附 provenance，自检查 packument `versions` + tarball 直连。
