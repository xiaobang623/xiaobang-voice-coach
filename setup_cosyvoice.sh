#!/bin/bash
set -e

echo "🚀 CosyVoice 官方环境自动安装"
echo "================================================"

PROJECT_DIR="/Users/cyforia/xiaobang-voice-coach"
cd "$PROJECT_DIR"

# 1. Clone 官方仓库（如果还没有）
if [ ! -d "CosyVoice" ]; then
    echo "📥 Clone CosyVoice 官方仓库（含子模块）..."
    git clone --recursive https://github.com/FunAudioLLM/CosyVoice.git
    cd CosyVoice
    git submodule update --init --recursive
    cd ..
    echo "✅ Clone 完成"
else
    echo "✅ CosyVoice 仓库已存在"
fi

# 2. 安装官方依赖（这很重要，版本依赖挑剔）
echo ""
echo "📦 安装 CosyVoice 官方依赖..."
python3 -m pip install -r CosyVoice/requirements.txt -q
echo "✅ 官方依赖安装完成"

# 3. 安装补充依赖（HTTP 服务需要）
echo ""
echo "📦 安装补充依赖（fastapi, uvicorn 等）..."
python3 -m pip install -r requirements_cosyvoice.txt -q
echo "✅ 补充依赖安装完成"

# 4. 验证模型文件
echo ""
echo "🔍 验证模型文件..."
if [ -f "pretrained_models/CosyVoice2-0.5B/cosyvoice2.yaml" ]; then
    echo "✅ 模型文件齐全"
else
    echo "❌ 模型文件不完整"
    exit 1
fi

echo ""
echo "================================================"
echo "✅ CosyVoice 环境安装完成！"
echo ""
echo "Apple GPU（M5/M系列）请切换到 MPS 分支："
echo "  cd CosyVoice"
echo "  git fetch origin pull/1869/head:feat/apple-silicon"
echo "  git checkout feat/apple-silicon"
echo ""
echo "下一步，启动 CosyVoice 服务："
echo "  ./start_cosyvoice.sh"
echo "================================================"
