#!/usr/bin/env bash
# gate — 本仓库的收尾闸门（零第三方依赖）。
#
# 用法:
#   bash scripts/gate.sh            # 全量：静态层 + 全部测试 + 严格红线扫描（发版前口径）
#   bash scripts/gate.sh --quick    # 静态层 only（秒级，提交前口径；pre-commit 调的就是它）
#
# 设计:
# - 静态层：JS 语法、文档校验、契约对账、凭据扫描，都不需要真实账号或网络。
# - 契约对账（dsh-plugin/tests/contracts.test.mjs）拦四类漂移：路由、配置键、
#   状态字段、版本与构建产物新鲜度。
# - 全量层额外跑全部单测（带超时，防止未关闭的 socket 把 CI 挂死），
#   并严格扫描代码里残留的真实隧道域名。
# - 一步失败不中断其余步骤，末尾汇总统一判结果；任何一步红都算 gate 红。
set -u
cd "$(dirname "$0")/.."

MODE="full"
[[ "${1:-}" == "--quick" ]] && MODE="quick"

declare -a NAMES=() RESULTS=() DETAILS=()
GATE_PASS=true

run_step() {
  local name="$1"; shift
  local out rc
  out=$("$@" 2>&1); rc=$?
  NAMES+=("$name")
  if [ "$rc" -eq 0 ]; then
    RESULTS+=("PASS")
    printf 'PASS  %s\n' "$name"
  else
    GATE_PASS=false
    RESULTS+=("FAIL")
    DETAILS+=("$name")
    printf 'FAIL  %s\n' "$name"
    printf '%s\n' "$out" | tail -20 | sed 's/^/      /'
  fi
}

echo "== gate ($MODE) =="

# ---- 静态层（秒级）----
run_step "js-check"    bash -c 'for f in dsh-plugin/lib/*.js dsh-plugin/web/panel.js dsh-plugin/scripts/*.mjs dsh-plugin/tests/*.mjs; do node --check "$f" || exit 1; done'
run_step "docs"        python3 scripts/verify_docs.py
run_step "contracts"   node --test dsh-plugin/tests/contracts.test.mjs
run_step "secrets"     bash scripts/scan-secrets.sh

if [ "$MODE" = "full" ]; then
  # ---- 套件层 ----
  # --test-timeout 是防挂死保险：正常测试应在几秒内结束。
  run_step "tests"     bash -c 'cd dsh-plugin && node --test --test-timeout=20000 tests/*.test.mjs'
  run_step "redlines"  bash scripts/scan-secrets.sh --all
fi

echo
echo "== 汇总 =="
for i in "${!NAMES[@]}"; do
  printf '%-6s %s\n' "${RESULTS[$i]}" "${NAMES[$i]}"
done
if $GATE_PASS; then
  echo "gate: 通过"
  exit 0
fi
echo "gate: 未通过（${DETAILS[*]:-}）——按上面各步输出修，不要 --no-verify 绕过"
exit 1
