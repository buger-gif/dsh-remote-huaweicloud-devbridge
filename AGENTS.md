# dsh-remote-huaweicloud-devbridge — 项目指引（给 AI 会话）

> 这是**公开开源仓库**（MIT）。给下一个会话的入口：用户视角在 `README.md`，
> 文档规矩在 `docs/README.md`，当前断点与开源前阻塞项在 `docs/implementation/PROGRESS.md`。
> 本文件是约定名 `AGENTS.md`（大写）；`agents.md` 只是口语写法，不要另建同名小写文件。

## 项目目标

只做一件事：**把本机 DSH 的 Web 界面安全地交给远端设备远控**，不把 DSH 直接暴露到公网。
华为云 DevBridge 提供出站隧道，插件自己承担公网侧的门禁。

- 链路：远端浏览器 → DevBridge 中继 → 本机 `devbridge host` → `127.0.0.1:gatePort`（鉴权网关）
  → `127.0.0.1:3080`（DSH Web，Host/Origin 已被重写成 loopback）。
- 两种入口：DSH 侧边栏席位，以及不依赖客户端注入的独立控制页 `/plugins/devbridge-remote/`。
- 做对的标准：**默认不联网、默认不匿名放行、失败要说清原因**；宁可不给访问，也不静默把
  DSH 敞开。`autoStart` 默认 false，必须由人在面板上点「开启远控」。

非目标：不做通用内网穿透工具，不做多用户账号体系，不代管华为云凭据，不改写 DSH 启动参数，
不在仓库里提供任何真实隧道地址或可用令牌。

## 开源标准（发布到公开仓库前逐条对照）

1. **许可证**：MIT。根目录 `LICENSE`（Copyright 写「项目 contributors」，不写个人姓名），
   `dsh-plugin/package.json` 的 `license` 必须为 `MIT`。引入第三方代码要带上游许可证，
   且不得让 `npm pack` 悄悄打包未声明来源的文件。
2. **必备文件**：`README.md`、`LICENSE`、`CONTRIBUTING.md`、`SECURITY.md`、
   `CODE_OF_CONDUCT.md`、`CHANGELOG.md`、`AGENTS.md`、`dsh-plugin/README.md`、
   `.gitignore`、`.editorconfig`、CI 工作流、提交钩子。缺任一项不算可开源。
3. **包元数据**：`repository` / `bugs` / `homepage` / `author` / `keywords` / `engines` /
   `files` 齐全且与真实仓库地址一致；仓库里不得残留地址占位符。
   `files` 里列的路径必须真实存在（`npm pack --dry-run` 会验）。
4. **可复现**：`git clone` 后不需要华为云账号、不需要装 devbridge CLI 就能跑通
   `npm test` 与 `bash scripts/gate.sh --quick`。测试用注入的 `exec` / `spawn` 模拟 CLI，
   绝不连真实中继。运行时**零第三方依赖**，只用 Node 标准库（Node >= 22.5）。
5. **隐私与脱敏**：示例一律虚构。隧道地址用 `tunnel.example.com`，令牌用 `TOK123` /
   `<TOKEN>` 这类一眼假的占位；真实 URL、Cookie、二维码、截图不进仓库，也不进 issue / PR。
6. **版本**：`dsh-plugin/package.json` 的 `version` 是唯一真源；SemVer；git tag `vX.Y.Z`；
   `CHANGELOG.md` 的「未发布」段在发版时改标题。详见 `AGENTS.md §版本号管理`。
7. **CI**：push / PR 跑静态门禁 + 全量测试，全绿才可合并。打 `vX.Y.Z` tag 后由
   `.github/workflows/publish.yml` 校验版本一致、跑全量门禁并发布到
   `registry.npmjs.org`；发布凭据只放 GitHub Actions secret，绝不进仓库。
8. **贡献与安全**：贡献流程、行为准则、私密漏洞通道齐备；安全修复只对最新 main 与最新 Release。
9. **提交**：Conventional Commits、一个提交一件事、中文正文写「现象 → 根因 → 改法」；
   不夹带无关格式化，不用 `--no-verify` 绕过钩子。
10. **发版门槛**：红线清单清零、契约对账绿、全量测试绿、`npm pack --dry-run` 干净、
    占位符替换完、README 里的安装命令在干净环境实测过。任何一条不满足就不打 tag。

## 开源仓库红线（每次 commit 前自查）

公开仓库里**一律不得出现**：

- **真实运行标识**：隧道公网 URL、`tunnelId`、访问令牌、会话 Cookie、扫码二维码图、
  DSH 的 `~/.dsh/web-token`、`HW_API_KEY` 的值、AK/SK、devbridge 登录态。
- **本机运行数据**：`~/.dsh/devbridge-remote/` 下的 `state.json` / `config.json`、
  带令牌的日志、二维码缓存、截图与录屏——已在 `.gitignore`，禁止 `git add -f` 绕过。
- **个人痕迹**：`/Users/<名字>/...` 这类本机路径（文档写 `~/dsh-remote-huaweicloud-devbridge`）、
  个人邮箱、公司内网域名、真实主机名与工作区名。
- **未经脱敏的对话与面板截图**：示例数据只用虚构值，示例人物不对应真人。

`bash scripts/gate.sh --quick` 的 `secrets` 步骤拦常见凭据形状；这是兜底，不是免责。
误提交令牌：**先在面板点「轮换令牌」或删掉 `state.json` 重启使之失效**，再处理历史——
只删 commit 不够。面向人类的完整清单与处置见 `CONTRIBUTING.md §不要带进来的东西`。

## 设计铁律（改代码前先背下来）

1. **只绑回环。** 鉴权网关只监听 `gateHost: 127.0.0.1`；公网入口**只能**是 DevBridge 的
   出站隧道。给网关加 `0.0.0.0` / 公网监听、或直接把 DSH 的 3080 挂出去，等于把整个
   DSH 与本机会话能力一起公开，属于架构翻案，需新 ADR。
2. **门禁由插件自己兜底。** `allowAnonymous: true` 只是让远端浏览器免华为云登录，
   **不是**免鉴权。任何请求必须先过令牌 / HMAC 会话 Cookie / 失败限流；
   轮换令牌要让旧链接与旧会话立刻失效。
3. **外部身份头全部剥离。** 转发给 DSH 前重写 `Host` / `Origin` / `Referer` 为 loopback，
   剥掉 `Authorization`、`X-Forwarded-*`、`X-Real-IP` 与网关自身会话 Cookie；
   HTTP 与 WebSocket 两条路都要过同一套校验。
4. **控制面同源。** `/plugins/devbridge-remote` 走 DSH 的 `webServer` 同源路由，
   三层校验：回环来源 + 回环 Host + 页面注入的一次性 `x-devbridge-api` token。
   不为面板另起服务，不把 API token 落盘。
5. **运行时零第三方依赖。** 宿主半只用 Node 标准库；前端 `React` 由宿主 `require` 提供；
   `lib/client.js` 是 `web/panel.js` 的构建产物，**禁止手改**。
6. **不猜 CLI。** devbridge CLI 只支持 v0.2.x（v0.1.x 域名已失效）；每个子命令先读
   `--help` 再拼 flag，遇 unknown flag 回退最小参数集；隧道 URL 一律取 `host` 实际输出，
   绝不按文档拼域名。平台事实写进 `docs/architecture.md`，不写死在调用点。
7. **URL 与状态只在本机。** 隧道 URL、访问令牌、环形日志只落 `~/.dsh/devbridge-remote/`
   （目录 `700`、文件 `600`）；不上传、不进第三方日志，不在错误信息里回显令牌。
8. **失败要说人话。** 缺 CLI / 版本过旧 / 未登录 / 端口占用 / host 没吐 URL 都要给
   `blocker` 与可执行的修复指引，不静默重试、不假装已连接。
9. **安全声明必须与接线状态一致。** 端到端加密目前只有 `lib/e2ee.js` 核心与单测，
   浏览器侧 / 网关 / 面板未接入、默认未启用；README、仓库描述、issue 与 PR 不得把它
   写成「已受保护」或「中继不可解密」。接线完成并默认开启前，公开表述一律标注现状与
   边界（`README.md §传输与加密现状`）。

## 开发流程

1. **先 spec 后代码。** 非平凡改动（新接口 / 配置键 / 状态字段 / 鉴权逻辑 / 用户可见交互 /
   跨两个以上文件）先写 `docs/specs/active/NNNN-短名.md`（模板 `docs/specs/_template.md`，
   编号规则见 `docs/specs/README.md`）；大改动另配同名 `-plan.md`，一步一验证。
2. **同 commit 改契约。** 动 `/api/*` 路由、`DEFAULTS` 配置键、`state.json` 字段，
   必须同时改 `docs/specs/contracts/` 对应文件；三类都有 `dsh-plugin/tests/contracts.test.mjs`
   自动对账，漏改则 `bash scripts/gate.sh --quick` 红。
3. **实施中改主意先改 spec**，不留两套方案；验收逐条对勾后 `git mv` 进
   `docs/specs/archive/` 并登记。拍板过的备选方案落 `docs/decisions/`。
4. **提交前**：仓库根执行 `bash scripts/gate.sh --quick` 全绿（秒级；
   `bash scripts/install-hooks.sh` 一次性接上钩子）。
5. **收尾**：更新 `docs/implementation/PROGRESS.md` 断点；用户可见行为变了改
   `CHANGELOG.md` 的「未发布」与 `README.md` / `dsh-plugin/README.md`；
   架构取舍变了补 `docs/architecture.md` + ADR。
6. **发版**：全量 `bash scripts/gate.sh` 全绿，按 `AGENTS.md §版本号管理` 走。

## 版本号管理

- **真源只有一个**：`dsh-plugin/package.json` 的 `version`。git tag、`CHANGELOG.md`
  顶部版本小节必须与它一致。当前 `lib/index.js` / `lib/control.js` 内还有三处
  `0.1.0` 硬编码，属于**待清理项**；`tests/contracts.test.mjs` 会强制它们与 package.json
  一致，**不允许再新增第四处**。
- **没发版不涨号**：日常改动只往 `CHANGELOG.md` 的 `## 未发布` 追加小节，`version`
  保持上一个已发布版本；只有发版提交才动它。
- **SemVer**：`MAJOR` = 对外契约不兼容（API / `state.json` / 配置键删改）；`MINOR` =
  向后兼容的新功能；`PATCH` = 只修 bug、文案、样式。1.0 前用 `0.MINOR.PATCH`。
- **发版一次做齐**：未发布小节改成 `## X.Y.Z — YYYY-MM-DD` → 改 `package.json` →
  全量 gate 全绿 → 提交 `chore(release): vX.Y.Z` → 打 `vX.Y.Z` tag 推送 →
  `.github/workflows/publish.yml` 校验 tag 与版本一致、跑全量门禁、打包预演、
  发布到 `registry.npmjs.org` 并回查 `npm view`。发布凭据是仓库 Actions secret，
  长期可切到 npm Trusted Publishing（OIDC）。tag 不移动、不复用；出问题发新 PATCH。
- 文档不写版本快照（时效指针只放 `docs/implementation/PROGRESS.md`）。

## 格式要求

- **代码**：`.editorconfig` 为准（UTF-8、LF、2 空格、文件末换行）；ESM，`node:` 前缀引入
  标准库；纯函数与 I/O 分离，方便离线自测。
- **文案**：文档、注释、提交信息用中文；标识符、配置键、API 路径用英文。
  用户可见文案不出现 `tunnelId`、`gatePort` 等内部字段名。
- **文档**：活文档就地改写（禁「追加」小节与「此前：」状态链）；新增活文档必须在
  `scripts/doc_budgets.json` 登记行数上限；互引写仓库相对全路径 + `§标题`，不写行号。
  规则全文见 `docs/README.md`。
- **测试**：一个文件一个关注点，用 `node:test` + `node:assert/strict`；
  涉及 CLI / 端口的测试必须注入假实现，不开真实隧道、不占固定端口。

## 环境速查

```bash
# 仓库根
bash scripts/gate.sh --quick              # 提交前静态层：语法 / 文档 / 契约 / 密钥
bash scripts/gate.sh                      # 发版前全量（含全部测试）
bash scripts/install-hooks.sh             # 一次性接上 pre-commit

# 插件目录
cd dsh-plugin
npm test                                  # node --test tests/*.test.mjs
npm run doctor                            # 独立体检：CLI / 登录态 / 端口 / 文件权限
npm run build:client                      # 重建 lib/client.js（改了 web/panel.js 就跑）
node --test tests/contracts.test.mjs      # 只跑契约对账
npm pack --dry-run                        # 检查发布产物
```

## 停下来问用户的时机

- 要引入任何第三方运行时依赖，或提高 Node 版本下限
- 要把网关绑到非回环地址、放宽令牌 / Cookie 校验，或改动 `allowAnonymous` 的默认语义
- 要把运行数据（URL、令牌、日志、面板内容）发到仓库之外的任何服务
- 要翻已 `implemented` 的架构决策，或突破 spec 的「非目标」
- 要在红线未清零、全量测试未绿的情况下打 tag、公开仓库或发布 npm 包
