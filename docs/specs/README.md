# spec 流程与编号规则

> 非平凡改动**先写 spec 再动手**。模板是 `docs/specs/_template.md`；
> 总规矩见 `docs/README.md §spec 流程`，设计铁律见 `AGENTS.md`。

**下一个号：0002**

## 什么时候要写

新接口 / 配置键 / 状态字段 / 状态机 / 鉴权逻辑 / 用户可见交互 / 跨两个以上文件。
改错别字、调样式数值、补注释不算。拿不准就写一份短的，比返工便宜。

## 流程

1. 从 `docs/specs/_template.md` 复制成 `docs/specs/active/NNNN-短名.md`，
   取上面的「下一个号」，写完把指针 +1（同一份 spec 全程不改号）。
2. 大改动另配 `NNNN-短名-plan.md`，按「一步一验证」列可勾选的步骤。
3. 实施中改主意 → **先改 spec 再改代码**，放弃的方案写明原因，不留两套。
4. 验收逐条对勾 → `git mv` 到 `docs/specs/archive/`，在
   `docs/specs/archive/README.md` 登记一行（编号 / 标题 / 版本 / 一句话结论）。
5. 有被否掉的备选方案 → 单独落一份 `docs/decisions/`。

## 生命周期

| 位置 | 含义 | 写法 |
| --- | --- | --- |
| `active/` | 在办 | 就地改写，状态行随之更新 |
| `archive/` | 已验收 | 冻结，只登记不回改 |
| `active/` 里标「已放弃」 | 不做了 | 写清原因，随验收批次归档 |

`active/` 与 `archive/` 目录按需创建，空目录不必入库。

## 必备小节

`## 背景`、`## 方案`、`## 非目标`、`## 验收`、`## 契约影响`。
「契约影响」里明确是否要动 `docs/specs/contracts/` 的三份文件；
动路由 / 配置键 / 状态字段却没在同一 commit 改契约，`bash scripts/gate.sh --quick` 会红。

## 版本口径

spec 的「目标版本」写**准备发到哪个版本**，不写当前代码里的版本快照；
时效指针（现在到哪了）只放 `docs/implementation/PROGRESS.md`。
