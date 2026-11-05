# 文档导航与文档体系规则

> 本文件是**唯一的路由入口**，也是文档规矩的唯一之家。想查什么在下表找一行，
> 想知道「写在哪、什么时候必须改、怎么写」看 `docs/README.md §文档体系规则`。

## 一张图

```text
AGENTS.md                       ← agent 入口：开源标准 + 红线 + 设计铁律 + 开发流程
README.md                       ← 用户门面（体感 / 安装 / 安全须知）
CONTRIBUTING.md / SECURITY.md   ← 贡献流程、私密漏洞通道
CODE_OF_CONDUCT.md / LICENSE / CHANGELOG.md
dsh-plugin/README.md            ← 插件说明书（npm 包同款）
docs/
├── README.md                   ← 本文件：路由表 + 文档规矩
├── architecture.md             ← 系统为什么长这样、链路与安全边界
├── specs/
│   ├── README.md               ← spec 流程与编号规则
│   ├── _template.md            ← spec 模板
│   ├── contracts/              ← 冻结契约：API / 配置 / 状态的确切形状
│   ├── active/                 ← 在办 spec（按需创建）
│   └── archive/                ← 已验收 spec（按需创建）
├── decisions/                  ← 拍板记录：选了 A，为什么不是 B
└── implementation/PROGRESS.md  ← 当前断点与发布前待办（新会话第一读取点）
scripts/                        ← 门禁、密钥扫描、文档校验、行数预算
```

## 路由表

| 场景 | 读哪 |
| --- | --- |
| 新会话进来，先搞清楚状况 | `docs/implementation/PROGRESS.md` → `AGENTS.md` |
| 用户怎么装、怎么用、安全须知 | `README.md`、`dsh-plugin/README.md` |
| 链路怎么走、为什么只绑回环 | `docs/architecture.md` |
| 某个接口收什么、回什么 | `docs/specs/contracts/01-api.md` |
| 某个配置键的默认值、范围与优先级 | `docs/specs/contracts/02-config.md` |
| 令牌与隧道状态存哪、权限多少 | `docs/specs/contracts/03-state.md` |
| 要做一个新功能，先写什么 | `docs/specs/_template.md`，编号规则在 `docs/specs/README.md` |
| 某个功能当初为什么这么做 | `docs/decisions/` + 归档 spec |
| 贡献、提交、发版口径 | `CONTRIBUTING.md` / `AGENTS.md` |
| 数据处理与已知风险面 | `SECURITY.md` |
| 跑一遍检查 | `bash scripts/gate.sh --quick`（秒级）/ `bash scripts/gate.sh`（全量） |

## 文档体系规则

### 四条底层判断

1. **文档是写给下一个会话的自己**，不是宣传稿。判断标准：三天后只看文档，能不能不改代码
   就回答「为什么这样、现在到哪了、下一步动哪里」。
2. **一处一家**。同一个事实只允许有一个权威位置，其它地方要么引用，要么不写。
   发现两处都在描述同一件事，删掉较弱的那份，改成引用。
3. **代码是事实，文档是解释**。冲突时以代码为准，并在同一次改动里把文档改对。
   `docs/specs/contracts/` 是唯一例外——那里是**契约**，代码偏离契约就是 bug，
   由 `dsh-plugin/tests/contracts.test.mjs` 拦住。
4. **用户文档先给体感，再给参数**。`README.md` 前几屏先放一条链路与「点一下会发生什么」，
   配置表往后放；示例一律虚构。

### 信息之屋

| 想知道什么 | 唯一之家 | 谁负责更新 |
| --- | --- | --- |
| 系统为什么长这样、组件怎么交互 | `docs/architecture.md` | 改架构的人 |
| 接口 / 配置 / 状态的**确切形状** | `docs/specs/contracts/` | 改路由、配置键、状态字段的人 |
| 要做什么、边界在哪、怎么算做完 | `docs/specs/active/` | 提需求的人先写，再动手 |
| 为什么选 A 不选 B | `docs/decisions/` | 拍板的人当场写 |
| 现在断点在哪、发布前还差什么 | `docs/implementation/PROGRESS.md` | 每次收尾 |
| 每个版本改了什么 | `CHANGELOG.md` | 发版的人 |
| 用户怎么装、怎么用 | `README.md`、`dsh-plugin/README.md` | 改用户可见行为的人 |

### 三类生命周期

| 类型 | 位置 | 写法 | 能不能删 |
| --- | --- | --- | --- |
| **活文档** | `AGENTS.md`、`README.md`、`docs/architecture.md`、契约、各 README、PROGRESS | **就地改写**成当前事实；禁「## 追加」小节、禁「此前：… 现在：…」状态链 | 过时内容直接删 |
| **冻结区** | `CHANGELOG.md`、`docs/specs/archive/`、`docs/decisions/implemented/` 等 | 只追加，不回改；写清日期与当时的事实 | 不删 |
| **一次性** | `docs/specs/active/` 验收后归档、`docs/audits/`（按需） | 一份检查一份文件 | 归档后不删 |

两个机械闸（`scripts/verify_docs.py` 强制）：新增活文档必须在 `scripts/doc_budgets.json`
登记行数上限（没预算 = 无界增长入口）；活文档里出现「追加」标题或「此前：/原先：」判违规。

### spec 流程

1. 非平凡改动先写 `docs/specs/active/NNNN-短名.md`（模板 `docs/specs/_template.md`），
   编号取 `docs/specs/README.md` 的「下一个号」并 +1；大改动另配同名 `-plan.md`。
2. 实施中改主意**先改 spec 再改代码**，不留两套方案。
3. 验收逐条对勾后 `git mv` 到 `docs/specs/archive/`，在归档登记表里写一行结论。
4. 拍过板的选择（有被否掉的备选）单独落 `docs/decisions/`。

「非平凡」= 新接口 / 配置键 / 状态字段 / 状态机 / 鉴权逻辑 / 用户可见交互 / 跨两个以上文件。
改错别字、调样式数值、改注释不算。

### 引用与更新时机

- 文档互引写**仓库相对全路径**（`docs/specs/contracts/02-config.md`），不写 `../`；
  段落引用用 `§标题`，不写行号。`scripts/verify_docs.py` 校验所有相对链接与锚点。
- 时效性指针（当前断点、当前基线）只允许出现在 `docs/implementation/PROGRESS.md`。
- 改路由 / 配置键 / 状态字段 → 同 commit 改契约；改用户可见行为 → 同步 README 与
  `CHANGELOG.md` 未发布段；架构取舍变了 → 同步 `docs/architecture.md` + ADR。
- 收尾只跑一条命令：`bash scripts/gate.sh --quick`；发版前跑全量 `bash scripts/gate.sh`。
