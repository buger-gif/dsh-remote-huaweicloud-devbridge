# 当前断点与发布前待办

> 新会话第一读取点。本文是**唯一允许写时效指针**的地方：就地改写，不做沿革。
> 开源标准与红线在 `AGENTS.md`，文档规矩在 `docs/README.md`。

## 现在到哪了（2026-11-05 18:45 核对）

**已公开发布。** GitHub 公开仓库 <https://github.com/buger-gif/dsh-remote-huaweicloud-devbridge>
（topics `dsh` / `dsh-plugin`）已推送；npm 包 `dsh-remote-huaweicloud-devbridge@0.1.0`
已进入 `registry.npmjs.org`。

已核对的读数：

- `bash scripts/gate.sh`：**6/6 全绿**（js-check / docs / contracts / secrets / tests / redlines）；
- 全量单测与契约对账（路由 / 配置键 / 状态字段 / 版本 / 构建产物）全绿；
- `npm pack --dry-run` 产物干净；`lib/client.js` 与 `web/panel.js` + 模板一致；
- 仓库里无地址占位符、无真实隧道 URL / 令牌 / Cookie / 个人路径；
- npm 侧：packument `dist-tags.latest = 0.1.0`，tarball 直连 **HTTP 200 / 60,615 字节**，
  23 个文件含 `LICENSE` / `cordis.patch.yml` / `lib` / `web` / `scripts`；
- 干净目录 `npm i dsh-remote-huaweicloud-devbridge` 实测成功（224K，0 vulnerabilities）；
- 发布 workflow 的「发布到 npmjs.org」步骤为 success，仅「发布后自检」因 registry
  传播慢超时，已重跑修正为绿。

## 还没做完（不阻塞首发，但要盯）

1. **端到端加密接线**：`dsh-plugin/lib/e2ee.js` 与 `dsh-plugin/tests/e2ee.test.mjs`
   已落地；浏览器侧 WebCrypto 实现、网关握手与面板接线仍缺失，**默认未启用**。
   接线完成前公开表述一律按现状，见 `README.md §传输与加密现状`；动手前先写 spec + ADR。
2. **npm 可信发布（OIDC）**：npm 包设置页的 Trusted Publisher 表单已填好
   （GitHub Actions / `buger-gif` / 本仓库 / `publish.yml`），提交时需再过一次 2FA，
   **待用户本人在场完成**。完成后删除 `NPM_TOKEN` secret 与对应 granular token
   （该 token 为 bypass-2FA、有效期 7 天、权限覆盖全部包）。
3. **`0.0.0-stage` 残留版本**：npm 首次 staged publish 产生的占位版本，仍在版本列表里，
   但不指向 `latest`、不影响安装。可信发布落地后用 `npm unpublish ...@0.0.0-stage`
   清掉，使包页恢复正常展示（包页当前仍渲染占位版本，属 npm 站点数据滞后）。
4. **版本硬编码三处**：`lib/index.js`（2 处）/ `lib/control.js`（1 处）的 `0.1.0`，
   长期改为从 `package.json` 读取；契约测试保证一致且不允许新增第四处。
5. **自检窗口偏短**：`publish.yml` 的「发布后自检」为 18×10s（3 分钟），
   registry 慢时会给假红；下次发版前改查 packument `versions` 并把窗口拉到 6 分钟。

## 0.1.0 首发完成标准

- GitHub 公开仓库已建、代码已推送、topics 含 `dsh` / `dsh-plugin`；**已完成**
- `v0.1.0` tag 触发 `publish.yml`，`npm view` 能查到 `0.1.0`；**已完成**
- 红线清单清零：无真实 URL / 令牌 / Cookie / 二维码 / 个人路径 / 内网信息；**已完成**
- 仓库描述与 README 说明「华为云只是数据通道」，并如实标注 E2EE 尚未默认启用；**已完成**
