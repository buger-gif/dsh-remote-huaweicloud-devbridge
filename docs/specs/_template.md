# NNNN · 一句话标题

- 状态：待实施（待实施 / 实施中 / 已验收 / 已放弃）
- 目标版本：0.1.0
- 日期：YYYY-MM-DD

## 背景

现在是什么行为、谁被卡住、为什么要动它。写事实，不写方案。

## 方案

要改成什么样，分几步，每步怎么验证。跨文件改动列出会动到的文件。

## 非目标

这次明确不做的事。突破 `AGENTS.md §设计铁律` 的，先停下来问用户并写 ADR。

## 验收

- [ ] 条件一（可机械验证，写清命令或现象）
- [ ] 条件二
- [ ] `bash scripts/gate.sh --quick` 全绿
- [ ] 相关文档与 `CHANGELOG.md` 未发布段已同步

## 契约影响

- [ ] `docs/specs/contracts/01-api.md`（路由）
- [ ] `docs/specs/contracts/02-config.md`（配置键 / 默认值）
- [ ] `docs/specs/contracts/03-state.md`（状态字段）
- [ ] 都不涉及（写明理由）
