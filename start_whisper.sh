#!/bin/bash
# Whisper ASR 服务启动脚本（Mac 默认 MPS + 自动语言检测）

cd "$(dirname "$0")"

# 留空 = 自动检测（支持中英混合）；可 export WHISPER_LANG=en 仅练纯英文时再用
export WHISPER_LANG="${WHISPER_LANG:-}"
# cpu 更稳；可 export WHISPER_DEVICE=mps 尝试 Apple GPU（部分环境会回退 cpu）
export WHISPER_DEVICE="${WHISPER_DEVICE:-cpu}"
export WHISPER_PORT="${WHISPER_PORT:-8000}"

echo "🚀 启动 Whisper ASR 服务"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "模型:     ${WHISPER_MODEL:-base}"
echo "语言:     ${WHISPER_LANG:-自动检测}"
echo "设备:     ${WHISPER_DEVICE}"
echo "监听端口: ${WHISPER_PORT}"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo ""

python3 whisper_server.py
