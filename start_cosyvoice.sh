#!/bin/bash
# CosyVoice 服务启动脚本
# Mac 上默认 CPU：MPS 在 torch 2.3 + CosyVoice2 上会产生噪音/静音

cd "$(dirname "$0")"

export COSYVOICE_REPO_DIR="$(pwd)/CosyVoice"
export COSYVOICE_MODEL_DIR="$(pwd)/pretrained_models/CosyVoice2-0.5B"
export COSYVOICE_PORT="${COSYVOICE_PORT:-8001}"
# cpu = 音质正常（M5 上约 5–15s/句）；mps = 快但当前易出噪音
export COSYVOICE_DEVICE="${COSYVOICE_DEVICE:-cpu}"
export COSYVOICE_FP16="${COSYVOICE_FP16:-false}"
export PYTORCH_ENABLE_MPS_FALLBACK="${PYTORCH_ENABLE_MPS_FALLBACK:-1}"

if [ ! -d "$COSYVOICE_REPO_DIR/.git" ]; then
  echo "❌ CosyVoice 仓库不存在，请先运行 ./setup_cosyvoice.sh"
  exit 1
fi

branch="$(git -C "$COSYVOICE_REPO_DIR" branch --show-current)"
if [ "$branch" != "feat/apple-silicon" ]; then
  echo "⚠️  CosyVoice 当前分支: $branch"
  echo "   推荐 feat/apple-silicon 分支（已 fetch 过可 checkout）"
fi

echo "🚀 启动 CosyVoice TTS 服务"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "仓库目录: $COSYVOICE_REPO_DIR"
echo "模型目录: $COSYVOICE_MODEL_DIR"
echo "监听端口: $COSYVOICE_PORT"
echo "设备:     $COSYVOICE_DEVICE"
echo "fp16:     $COSYVOICE_FP16"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo ""

python3 cosyvoice_server.py
