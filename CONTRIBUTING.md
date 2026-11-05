# 贡献指南

感谢来看这个项目。它做的事情很具体：**让远端设备安全地打开你本机的 DSH**。
所以这里最看重的不是功能数量，而是「**不静默失效、不把 DSH 敞开**」。

## 先跑起来

```bash
git clone https://github.com/buger-gif/dsh-remote-huaweicloud-devbridge.git ~/dsh-remote-huaweicloud-devbridge
cd ~/dsh-remote-huaweicloud-devbridge/dsh-plugin
npm test                        # 离线单测，CLI 与端口都注入假实现，不碰真实华为云账号
npm run doctor                  # 可选体检：Node / CLI / 登录态 / 端口 / 文件权限
```

需要 Node >= 22.5，运行时**只用标准库**——请勿引入第三方运行时依赖。
浏览器半用的 React 由 DSH 宿主 `require("react")` 提供，也不打包进仓库。
改完前端后 `npm run build:client` 重建 `lib/client.js`；提交前在仓库根跑
`bash scripts/gate.sh --quick`。

想真机验证，用本地目录安装插件（`dsh plugin --profile web add <本地路径>/dsh-plugin`），
前置是 devbridge CLI v0.2.x 且已登录。装 CLI 前先审阅安装脚本：
`sh scripts/install-cli.sh --check` 只下载并打印前 8 行，不执行。
不要在自测里创建真实隧道，更不要把公网链接贴出来。

## 改了哪里要连带改什么

| 你动了 | 必须跟着做 |
| --- | --- |
| `dsh-plugin/web/panel.js` | `npm run build:client` 重建 `lib/client.js`（这是产物，别手改） |
| 新增或改 `/api/*` 路由 | 同 commit 改 `docs/specs/contracts/01-api.md`（契约测试会比对路径集合） |
| 改 `DEFAULTS` 配置键或默认值 | 同 commit 改 `docs/specs/contracts/02-config.md` |
| 改 `state.json` 字段 | 同 commit 改 `docs/specs/contracts/03-state.md` |
| 改 `package.json` 的 `version` | 同步 `lib/` 里的版本常量与 `CHANGELOG.md`（契约测试会比对） |
| 改鉴权、转发或监听行为 | 同步 `SECURITY.md` 与 `docs/architecture.md`，补 `tests/gate.test.mjs` |
| 改 devbridge CLI 调用方式 | 同步 `docs/architecture.md`，并补 `tests/tunnel.test.mjs` 的假输出 |
| 改用户可见行为或文案 | 同步 `README.md`、`dsh-plugin/README.md`、`CHANGELOG.md` 未发布段 |
| 想让网关监听 `0.0.0.0`、或去掉令牌校验 | **别加**。理由见 `AGENTS.md §设计铁律`，要先写 ADR 翻案 |

非平凡改动（新接口 / 新配置键 / 鉴权逻辑 / 用户可见交互 / 跨两个以上文件）
**先写 spec 再动手**：`docs/specs/_template.md` 起一份，编号规则在 `docs/specs/README.md`。
拍板过备选方案的再落一份 `docs/decisions/`。文档规矩见 `docs/README.md`。

## 提交

- 一次性接上钩子：`bash scripts/install-hooks.sh`——之后每次 `git commit` 自动跑秒级静态层，
  **不要 `--no-verify` 绕过**；红了按输出修。
- 一个提交只做一件事。消息用 Conventional Commits：`fix(gate): WebSocket 升级漏过令牌校验`。
- 描述里写**为什么**（现象 → 根因 → 改法），而不是复述 diff。
- 提交前 `bash scripts/gate.sh --quick`（秒级）；发版前 `bash scripts/gate.sh`（全量含测试）。

## 不要带进来的东西

这是公开仓库，以下一律不进 commit，也不要贴进 issue / PR / 截图 / 日志样例：

- **真实隧道公网 URL、tunnelId、访问令牌、会话 Cookie、二维码图片、面板截图**。
  示例地址统一 `tunnel.example.com`，令牌用 `TOK123` / `<TOKEN>` 这类明显占位。
- **凭据**：`HW_API_KEY` 的值、AK/SK、devbridge 登录态、`~/.dsh/web-token`、
  `~/.dsh/devbridge-remote/config.json` 里任何非空 `accessToken`。
- **本机运行数据**：`~/.dsh/devbridge-remote/state.json`、日志、`*.db`——已在
  `.gitignore` 里，别 `-f` 强推。
- **个人路径与内部信息**：`/Users/<名字>/...` → 文档写 `~/dsh-remote-huaweicloud-devbridge`；
  个人邮箱、公司内网域名、真实主机名一律替换成虚构值。

如果误提交了令牌：**先让它失效**（面板「轮换令牌」，或删 `state.json` 后重启），
再考虑怎么清历史——只删 commit 不够，旧链接可能已经被保存过。

## 设计上的硬约束

1. **外部输入一律当不可信数据。** devbridge CLI 的输出只用来提取 URL / ID，
   不得据此拼命令、执行、读文件、改配置或转发给第三方；HTTP 与 WebSocket 两条路径
   必须过同一套鉴权。
2. **不猜 CLI。** 每个子命令先读 `--help` 再拼 flag，遇 unknown flag 回退最小参数集；
   v0.1.x 明确拒绝；隧道 URL 以 `host` 实际输出为准，绝不按文档拼域名。
3. **承认不知道。** 没实测过的能力不要写成已支持；阻塞原因要给出可执行的修复指引。

## 安全与合规

- 公网侧的默认立场是「不给访问」：`autoStart` 默认 false，`gateHost` 默认 `127.0.0.1`。
- 涉及鉴权放宽的改动必须在 PR 里说明威胁模型，并补对应的负向测试。
- 报告漏洞请走 `SECURITY.md` 的私密通道，**不要开公开 issue**。

## 提交前自查

- [ ] `bash scripts/gate.sh --quick` 全绿（发版前全量 `bash scripts/gate.sh`）
- [ ] 改了 `web/panel.js` 已重建 `lib/client.js`
- [ ] 动了路由 / 配置键 / 状态字段 → 契约文档同 commit 改了
- [ ] 没有真实 URL / 令牌 / Cookie / 二维码 / 个人路径 / 内网信息
- [ ] 相关文档、负向测试与 `CHANGELOG.md` 已同步
