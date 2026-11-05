#!/usr/bin/env python3
"""verify_docs.py — 文档一致性 gate（只依赖标准库，Python 3.9+）。

检查项：
  1. 开源必备文件齐备（AGENTS / README / LICENSE / 契约 / 门禁脚本 / CI）。
  2. 链接与路径引用：markdown 相对链接 + 反引号里的 docs/ 与 dsh-plugin/ 下的 .md 路径必须存在，
     带锚点的还要能在目标文件里对上标题。
  3. 活文档行数预算：每份活文档必须在 scripts/doc_budgets.json 登记上限且不超。
  4. 反流水账：活文档禁「追加」式标题、禁「此前：/原先：」状态链（引号内的示例不算）。
  5. 契约文件格式：三份契约的必备小节与表头必须保持可被 contracts.test.mjs 解析的形状。
  6. spec / ADR 编号：active/ 与 archive/ 编号连续不重复，「下一个号」指针 = 最大号 + 1；
     决策记录的状态行必须与所在目录一致。

冻结区（CHANGELOG.md、docs/specs/archive/**、docs/decisions/{proposed,implemented,rejected}/**）
不做预算与反流水账检查——历史不改写；但指向它们的链接仍会校验。
"""
import json
import re
import sys
from pathlib import Path

REPO = Path(__file__).resolve().parent.parent
BUDGETS = REPO / "scripts" / "doc_budgets.json"

SKIP_DIRS = {".git", ".workbuddy", ".zcode", "node_modules", "__pycache__", "screenshots"}
REQUIRED = (
    "AGENTS.md", "README.md", "LICENSE", "CONTRIBUTING.md", "SECURITY.md",
    "CODE_OF_CONDUCT.md", "CHANGELOG.md", "dsh-plugin/README.md",
    "dsh-plugin/scripts/doctor.mjs", "dsh-plugin/scripts/install-cli.sh",
    ".gitignore", ".editorconfig", ".githooks/pre-commit",
    ".github/workflows/test.yml", ".github/workflows/publish.yml",
    "scripts/gate.sh", "scripts/scan-secrets.sh",
    "scripts/install-hooks.sh", "scripts/verify_docs.py", "scripts/doc_budgets.json",
    "docs/README.md", "docs/architecture.md", "docs/specs/README.md",
    "docs/specs/_template.md", "docs/specs/archive/README.md",
    "docs/decisions/README.md", "docs/implementation/PROGRESS.md",
    "docs/specs/contracts/01-api.md", "docs/specs/contracts/02-config.md",
    "docs/specs/contracts/03-state.md",
)

# 活文档：随代码演进、必须就地改写、必须登记行数预算。
LIVING_EXACT = (
    "AGENTS.md", "README.md", "CONTRIBUTING.md", "SECURITY.md",
    "dsh-plugin/README.md", "docs/README.md", "docs/architecture.md",
    "docs/specs/README.md", "docs/decisions/README.md",
    "docs/implementation/PROGRESS.md",
)
LIVING_PREFIXES = ("docs/specs/contracts/",)
LIVING_EXCLUDED = ("docs/implementation/log/", "docs/specs/archive/", "docs/decisions/implemented/",
                   "docs/decisions/rejected/", "docs/decisions/proposed/", "docs/audits/")

APPEND_HEADING_RE = re.compile(r"^#{1,6}\s+.*追加")
STALE_CHAIN_RE = re.compile(r"此前[:：]|原先[:：]")
QUOTED_SPAN_RE = re.compile(r"`[^`]*`|「[^」]*」")
LINK_RE = re.compile(r"\[[^\]]*\]\(([^)\s]+)\)")
BACKTICK_RE = re.compile(r"`([^`]+)`")
HEADING_RE = re.compile(r"^(#{1,6})\s+(.*?)\s*#*\s*$")
PLACEHOLDER_RE = re.compile(r"[<>*]|NNNN|YYYY|\{")
SPEC_FILE_RE = re.compile(r"^(\d{4})-.+\.md$")
NEXT_NO_RE = re.compile(r"^\*\*下一个号[：:]\s*(\d{4})\*\*", re.M)
CONTRACT_HEADERS = {
    "docs/specs/contracts/01-api.md": ("| 方法 |", "## 读接口（GET）", "## 写接口（POST）"),
    "docs/specs/contracts/02-config.md": ("| 键 |", "## 键与默认值", "## 取值范围"),
    "docs/specs/contracts/03-state.md": ("| 键 |", "## 顶层", "## 落盘位置"),
}
DECISION_SECTIONS = ("## 背景", "## 决策", "## 备选", "## 后果")


def md_files():
    out = []
    for p in sorted(REPO.rglob("*.md")):
        if any(part in SKIP_DIRS for part in p.parts):
            continue
        out.append((p.relative_to(REPO).as_posix(), p))
    return out


def is_living(rel):
    if rel.startswith(LIVING_EXCLUDED) or rel == "CHANGELOG.md":
        return False
    if rel.endswith("_template.md") or Path(rel).name.startswith("_"):
        return False
    return rel in LIVING_EXACT or any(rel.startswith(x) for x in LIVING_PREFIXES)


def github_anchor(heading):
    t = re.sub(r"[`*_~]", "", heading.strip())
    t = "".join(ch for ch in t if ch.isalnum() or ch in (" ", "-", "_"))
    return t.lower().replace(" ", "-")


def check_required(errors):
    for rel in REQUIRED:
        if not (REPO / rel).is_file():
            errors.append(f"缺少开源必备文件: {rel}")


def check_links(files, errors):
    headings = {}
    for rel, path in files:
        hs = set()
        for line in path.read_text(encoding="utf-8").splitlines():
            m = HEADING_RE.match(line)
            if m:
                hs.add(github_anchor(m.group(2)))
        headings[rel] = hs

    for rel, path in files:
        text = path.read_text(encoding="utf-8")
        for m in LINK_RE.finditer(text):
            target = m.group(1)
            if target.startswith(("http://", "https://", "mailto:", "#")):
                continue
            file_part, _, anchor = target.partition("#")
            f = (path.parent / file_part).resolve()
            if not f.is_file():
                errors.append(f"{rel}: 链接目标不存在 -> {target}")
                continue
            target_rel = f.relative_to(REPO).as_posix()
            if anchor and anchor not in headings.get(target_rel, set()):
                errors.append(f"{rel}: 锚点不存在 -> {target}")

        for m in BACKTICK_RE.finditer(text):
            token = m.group(1).strip().split()[0] if m.group(1).strip() else ""
            if not token.endswith(".md"):
                continue
            if not token.startswith(("docs/", "dsh-plugin/")):
                continue
            if PLACEHOLDER_RE.search(token):
                continue
            if not (REPO / token).is_file():
                errors.append(f"{rel}: 引用的文档不存在 -> {token}")


def check_budgets(files, errors):
    if not BUDGETS.is_file():
        errors.append("缺少 scripts/doc_budgets.json")
        return
    budgets = json.loads(BUDGETS.read_text(encoding="utf-8"))
    for rel, path in files:
        if not is_living(rel):
            continue
        if rel not in budgets:
            errors.append(f"{rel}: 活文档未登记行数预算（scripts/doc_budgets.json）")
            continue
        lines = len(path.read_text(encoding="utf-8").splitlines())
        if lines > budgets[rel]:
            errors.append(f"{rel}: {lines} 行 > 预算 {budgets[rel]} 行（就地精简，别追加）")
    for rel, limit in budgets.items():
        if rel.startswith("_") or not isinstance(limit, int):
            continue
        if not (REPO / rel).is_file():
            errors.append(f"doc_budgets.json 登记了不存在的文件: {rel}")


def check_no_journal(files, errors):
    for rel, path in files:
        if not is_living(rel):
            continue
        for i, line in enumerate(path.read_text(encoding="utf-8").splitlines(), 1):
            clean = QUOTED_SPAN_RE.sub("", line)
            if APPEND_HEADING_RE.match(clean):
                errors.append(f"{rel}:{i}: 活文档出现「追加」式标题（就地改写）")
            if STALE_CHAIN_RE.search(clean):
                errors.append(f"{rel}:{i}: 活文档出现状态链（写当前事实，不写沿革）")


def check_contracts(errors):
    for rel, required in CONTRACT_HEADERS.items():
        text = (REPO / rel).read_text(encoding="utf-8")
        for marker in required:
            if marker not in text:
                errors.append(f"{rel}: 契约缺少必备标记 {marker}")


def check_specs(errors):
    specs_readme = (REPO / "docs/specs/README.md").read_text(encoding="utf-8")
    decisions_readme = (REPO / "docs/decisions/README.md").read_text(encoding="utf-8")
    for name, text in (("docs/specs/README.md", specs_readme),
                       ("docs/decisions/README.md", decisions_readme)):
        if not NEXT_NO_RE.search(text):
            errors.append(f"{name}: 缺少「**下一个号：NNNN**」指针")

    numbers = []
    dirs = [REPO / "docs/specs/active", REPO / "docs/specs/archive"]
    for d in dirs:
        if not d.is_dir():
            continue
        for p in d.glob("*.md"):
            m = SPEC_FILE_RE.match(p.name)
            if m:
                numbers.append(int(m.group(1)))
    if numbers and len(numbers) != len(set(numbers)):
        errors.append("spec 编号重复")
    expected = max(numbers) + 1 if numbers else 1
    m = NEXT_NO_RE.search(specs_readme)
    if m and int(m.group(1)) != expected:
        errors.append(f"spec「下一个号」应为 {expected:04d}，当前 {m.group(1)}")

    for state in ("proposed", "implemented", "rejected"):
        d = REPO / "docs/decisions" / state
        if not d.is_dir():
            continue
        for p in sorted(d.glob("*.md")):
            text = p.read_text(encoding="utf-8")
            if f"状态：{state}" not in text and f"状态: {state}" not in text:
                errors.append(f"{p.relative_to(REPO)}: 状态行与目录 {state} 不一致")
            for section in DECISION_SECTIONS:
                if section not in text:
                    errors.append(f"{p.relative_to(REPO)}: ADR 缺少 {section}")


def main():
    errors = []
    files = md_files()
    check_required(errors)
    check_links(files, errors)
    check_budgets(files, errors)
    check_no_journal(files, errors)
    check_contracts(errors)
    check_specs(errors)
    if errors:
        print(f"docs: {len(errors)} 处问题")
        for e in errors:
            print(f"  - {e}")
        return 1
    print(f"docs: 干净（{len(files)} 份文档、{len(REQUIRED)} 项必备文件）")
    return 0


if __name__ == "__main__":
    sys.exit(main())
