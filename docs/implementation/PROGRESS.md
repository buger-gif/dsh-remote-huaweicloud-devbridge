# 当前断点与发布前待办

> 新会话第一读取点。本文是**唯一允许写时效指针**的地方：就地改写，不做沿革。
> 开源标准与红线在 `AGENTS.md`，文档规矩在 `docs/README.md`。

## 现在到哪了（2026-11-05 18:22 核对）

开源基础文档、开发规范与机械闸门齐备；`dsh-plugin/package.json` 的仓库元数据、
`LICENSE`、私密漏洞通道与 clone 地址都已指向真实仓库。
`README.md`、`SECURITY.md`、`docs/architecture.md` 按**代码现状**写明端到端加密的
接线状态，不把未启用的能力写成已受保护。`.github/workflows/publish.yml` 负责
打 `vX.Y.Z` tag 后自动发布到 `registry.npmjs.org`。

已核对的读数：

- `bash scripts/gate.sh`：**6/6 全绿**（js-check / docs / contracts / secrets / tests / redlines）；
- 全量单测与契约对账（路由 / 配置键 / 状态字段 / 版本 / 构建产物）全绿；
- `npm pack --dry-run` 产物干净；`lib/client.js` 与 `web/panel.js` + 模板一致；
- 仓库里无地址占位符、无真实隧道 URL / 令牌 / Cookie / 个人路径；
- GitHub 账号 `buger-gif`，参考仓库 `cyber-im-avatar` 的 topics 为 `dsh` / `dsh-plugin`。

## 还没做完（不阻塞首发，但要盯）

1. **端到端加密接线**：`dsh-plugin/lib/e2ee.js` 与 `dsh-plugin/tests/e2ee.test.mjs`
   已落地；浏览器侧 WebCrypto 实现、网关握手与面板接线仍缺失，**默认未启用**。
   接线完成前公开表述一律按现状，见 `README.md §传输与加密现状`；动手前先写 spec + ADR。
2. **版本硬编码三处**：`lib/index.js`（2 处）/ `lib/control.js`（1 处）的 `0.1.0`，
   长期改为从 `package.json` 读取；契约测试保证一致且不允许新增第四处。
3. **npm 发布凭据**：`NPM_TOKEN` 只放在 GitHub Actions secret；长期建议切到
   npm Trusted Publishing（OIDC），去掉长期 token。
4. **干净环境验收**：CI 首次运行与全新 clone 上的安装命令仍待实测。

## 0.1.0 首发完成标准

- GitHub 公开仓库已建、代码已推送、topics 含 `dsh` / `dsh-plugin`；
- `v0.1.0` tag 触发 `publish.yml` 全绿，`npm view` 能查到 `0.1.0`；
- 红线清单清零：无真实 URL / 令牌 / Cookie / 二维码 / 个人路径 / 内网信息；
- 仓库描述与 README 说明「华为云只是数据通道」，并如实标注 E2EE 尚未默认启用。
