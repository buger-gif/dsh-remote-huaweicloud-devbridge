#!/usr/bin/env bash
# scan-secrets.sh — 开源红线扫描。
#
#   bash scripts/scan-secrets.sh         # 提交前口径：凭据形状 + 文档里的真实隧道域名
#   bash scripts/scan-secrets.sh --all   # 发版前口径：额外扫代码里的真实隧道域名
#
# 规则刻意「宁漏勿误」：只抓高置信度形状；误报改这里的规则，不要 --no-verify 绕过。
# 不依赖 git（仓库可能还没 init），只扫白名单扩展名，跳过本地私有目录。
set -u
cd "$(dirname "$0")/.."

MODE="${1:-}"
FAIL=0

FILES=$(find . -type f \
  \( -name '*.js' -o -name '*.mjs' -o -name '*.md' -o -name '*.json' \
     -o -name '*.yml' -o -name '*.sh' -o -name '*.py' \) \
  -not -path './.git/*' -not -path './.workbuddy/*' -not -path './.zcode/*' \
  -not -path '*/node_modules/*' -not -path '*/__pycache__/*' \
  -not -path '*/screenshots/*' | sort)

PATTERNS=(
  'sk-[A-Za-z0-9]{20,}'
  'ghp_[A-Za-z0-9]{20,}'
  'github_pat_[A-Za-z0-9_]{20,}'
  'AKIA[0-9A-Z]{16}'
  'xox[bap]-[A-Za-z0-9-]{10,}'
  'npm_[A-Za-z0-9]{30,}'
  'BEGIN [A-Z ]*PRIVATE KEY'
  '(HW_API_KEY|accessToken|api_key)[[:space:]]*[:=][[:space:]]*[A-Za-z0-9_-]{24,}'
)
PATTERN=$(IFS='|'; echo "${PATTERNS[*]}")

TUNNEL_DOMAIN='devbridge-s2\.hwtunnel\.com'

hits=$(printf '%s\n' "$FILES" | xargs grep -nE -i "$PATTERN" 2>/dev/null \
  | grep -v 'scripts/scan-secrets.sh' || true)
if [ -n "$hits" ]; then
  echo "发现疑似凭据（确认是误报就改 scripts/scan-secrets.sh 的规则）："
  printf '%s\n' "$hits" | head -20
  FAIL=1
fi

# 文档里不许出现真实隧道域名；示例统一用 tunnel.example.com。
DOC_FILES=$(printf '%s\n' "$FILES" | grep '\.md$' || true)
doc_hits=""
if [ -n "$DOC_FILES" ]; then
  doc_hits=$(printf '%s\n' "$DOC_FILES" | xargs grep -nE "$TUNNEL_DOMAIN" 2>/dev/null || true)
fi
if [ -n "$doc_hits" ]; then
  echo "文档里出现真实隧道域名（换成 tunnel.example.com）："
  printf '%s\n' "$doc_hits" | head -20
  FAIL=1
fi

# 发版前严格口径：测试 fixture 里残留的真实形状域名也必须清掉。
if [ "$MODE" = "--all" ]; then
  code_hits=$(printf '%s\n' "$FILES" | xargs grep -nE "$TUNNEL_DOMAIN" 2>/dev/null \
    | grep -v 'scripts/scan-secrets.sh' || true)
  if [ -n "$code_hits" ]; then
    echo "代码 / 测试里仍有真实形状隧道域名（开源前替换为虚构值，见 docs/implementation/PROGRESS.md）："
    printf '%s\n' "$code_hits" | head -20
    FAIL=1
  fi
fi

if [ "$FAIL" -eq 0 ]; then
  echo "secrets: 干净"
fi
exit "$FAIL"
