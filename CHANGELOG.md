# Changelog

本文件记录用户可见的变化。格式遵循 Keep a Changelog，版本规则见 `AGENTS.md §版本号管理`。
日常改动只追加到「未发布」；只有发版提交才动 `dsh-plugin/package.json` 的 `version`。

## 0.1.3 — 2026-11-05

### 修复

- **DSH 重启后远端页面不再要求重新扫码**：网关把 launch token 兑换到的 DSH 会话 Cookie
  只缓存在内存，并在每个已鉴权 HTTP / WebSocket 请求转发前注入上游，覆盖浏览器里上一次
  进程留下的旧 `dsh-auth-*`；缓存为空时按需兑换，失败冷却 5 秒。
- DSH Cookie 与 launch token 仍不落盘、不进日志、不出现在 `/api/status`；网关自己的
  `dbr_session` 校验逻辑不变。

## 0.1.2 — 2026-11-05

### 修复

- **隧道端口自动对账**：每次开启/重启远控时，自动清理隧道里网关端口以外的历史残留端口，
  再启动 `host`；不再需要手动执行 `devbridge port delete`，也不再为每个残留端口生成链接。
- **多入口只发布可用 URL**：`host` 输出多条 `Tunnel URL` 时，优先选择网关端口那一条；
  跨 chunk 断行也能正确拼接，不再把不可达端口写进 `state.tunnelUrl`、面板与二维码。
- 清理能力缺失或单个端口删除失败只降级并继续启动；端口级日志降为 `debug`，
  默认面板不展示清理细节。

## 0.1.1 — 2026-11-05

### 变更

- **移除应用层加密核心**（`lib/e2ee.js` 与对应单测）。在「手机纯浏览器 + 保留原生 UI +
  中继不可信」三条同时成立时，这层只能防被动留存、防不了中继改写下发脚本窃取密钥，
  已按 ADR 0001 否决。README、`SECURITY.md`、架构文档统一声明「中继可见明文」，
  不再保留默认未启用的加密设施。推理与被否决的备选见
  `docs/decisions/rejected/0001-drop-application-layer-e2ee.md`。
- **发布凭据改为 OIDC 可信发布**：`publish.yml` 不再读取 `NPM_TOKEN`，改用 npm
  Trusted Publishing（GitHub Actions OIDC + `id-token: write`），发布时附 provenance。
  仓库与包设置里都不再需要长期令牌。

### 修复

- 发布后自检改用 packument `versions` + tarball 直连判定，轮询窗口从 3 分钟拉到 6 分钟，
  避免 registry 传播慢导致的假红。

## 0.1.0 — 2026-11-05

首个公开版本。

### 功能（现状）

- DSH 插件形态：DevBridge 出站隧道 + 回环鉴权网关（令牌 / HMAC 会话 Cookie / 失败限流 /
  外部身份头剥离）、侧边栏席位与不依赖客户端注入的独立控制页。
- 隧道生命周期：CLI v0.2.x 预检、隧道与端口复用、host 看护与重连、`blocker` 归因；
  DSH 启动令牌多来源发现与面板手工兑换。
- 安装体验：npm 包按需安装 devbridge CLI、DSH 侧懒安装兜底、`npm run doctor` 独立体检。
- 应用层端到端加密**核心**：`dsh-plugin/lib/e2ee.js`（ECDH P-256 / HKDF-SHA256 /
  AES-256-GCM，AAD 绑定会话、方向与序号防重放，二维码带网关公钥指纹）与
  `dsh-plugin/tests/e2ee.test.mjs`。**浏览器侧实现与网关 / 面板接线进行中，默认未启用**，
  见 `README.md §传输与加密现状`。

### 开源与工程

- 新增 `AGENTS.md`（开源标准十条、仓库红线、设计铁律、开发流程）与
  README / CONTRIBUTING / SECURITY / CODE_OF_CONDUCT / LICENSE / 插件 README。
- 新增 `docs/`：文档导航与规矩、架构、API / 配置 / 状态三份冻结契约、spec 与 ADR 流程、
  当前断点与发布前待办。
- 新增机械闸门：`scripts/gate.sh`、`verify_docs.py`、`scan-secrets.sh`、提交钩子、
  CI 回归工作流，以及 `dsh-plugin/tests/contracts.test.mjs`（路由 / 配置 / 状态 / 版本 /
  构建产物对账）。
- 新增自动发布：`.github/workflows/publish.yml` 在打 `vX.Y.Z` tag 后校验版本一致、
  跑全量门禁、打包预演，并发布到 `registry.npmjs.org`。
