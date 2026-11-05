#!/bin/sh
# 安装华为云 DevBridge CLI v0.2.x（官方渠道）。
# 先把安装脚本落到本地文件再执行，便于审阅；-s 用于无交互环境。
set -eu

URL="https://gitcode.com/CloudDeveloperDepartment/devbrige/releases/download/latest/install.sh"
TMP="${TMPDIR:-/tmp}/devbridge-install-$$.sh"

echo "下载安装脚本：$URL"
if ! curl -fsSL --max-time 60 "$URL" -o "$TMP"; then
  echo "下载失败：请检查网络或手动从 https://devstation.connect.huaweicloud.com/space/devbridge 获取安装命令。" >&2
  rm -f "$TMP"
  exit 1
fi

if [ ! -s "$TMP" ]; then
  echo "安装脚本为空，已中止。" >&2
  rm -f "$TMP"
  exit 1
fi

echo "---- 脚本摘要（前 8 行）----"
head -8 "$TMP"
echo "----------------------------"

if [ "${1:-}" = "--check" ]; then
  echo "仅检查模式，未执行。完整脚本保留在 $TMP"
  exit 0
fi

# 官方脚本头部要求 BASH_VERSION，用 bash 而非 sh 执行。
bash "$TMP" -s
rm -f "$TMP"

export PATH="$HOME/.huawei/bin:$PATH"
if command -v devbridge >/dev/null 2>&1; then
  echo "已安装：$(command -v devbridge)"
  devbridge version
  echo "下一步：devbridge auth login（或设置 HW_API_KEY 后 devbridge auth login --api-key \"\$HW_API_KEY\"）"
else
  echo "安装脚本已执行，但 PATH 中仍找不到 devbridge。检查 ~/.huawei/bin 后重跑 node scripts/doctor.mjs" >&2
  exit 1
fi
