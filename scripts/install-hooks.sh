#!/usr/bin/env bash
# 一次性：把本仓库的 git 钩子接上（提交前自动跑 gate --quick）。
set -eu
cd "$(dirname "$0")/.."

if ! git rev-parse --is-inside-work-tree >/dev/null 2>&1; then
  echo "尚未初始化 git 仓库：先在项目根目录执行 git init，再运行本脚本。" >&2
  exit 1
fi

chmod +x .githooks/pre-commit scripts/gate.sh scripts/scan-secrets.sh
git config core.hooksPath .githooks
echo "已启用 pre-commit（每次 git commit 自动跑 scripts/gate.sh --quick）"
