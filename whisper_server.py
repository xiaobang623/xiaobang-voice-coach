#!/usr/bin/env python3
"""
whisper_server.py — 本地 Whisper ASR HTTP 服务
端口: 8000（可用环境变量 WHISPER_PORT 覆盖）

接口:
  GET  /health        健康检查
  POST /transcribe    上传音频 → 返回文字

用法:
  # 安装依赖（只需一次）
  pip install -r requirements_whisper.txt

  # 启动（默认 base 模型；Mac 上自动用 MPS GPU）
  python whisper_server.py

  # 启动（large-v3 模型，GPU 推荐，质量最高）
  WHISPER_MODEL=large-v3 python whisper_server.py

  # 强制只识别英语（跳过语言检测，速度更快）
  WHISPER_LANG=en python whisper_server.py

  # 手动指定设备：cpu | mps | cuda
  WHISPER_DEVICE=mps WHISPER_LANG=en python whisper_server.py
"""

import os
import time
import logging
import tempfile
from pathlib import Path

import torch
import uvicorn
import whisper
from fastapi import FastAPI, File, UploadFile, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel

# ─────────────────────────────────────────────────────────────────────────────
# 配置（环境变量覆盖）
# ─────────────────────────────────────────────────────────────────────────────

MODEL_NAME = os.getenv("WHISPER_MODEL", "base")
# base    ≈ 1GB 显存 / 快速，本地开发用
# small   ≈ 2GB，比 base 准
# medium  ≈ 5GB，均衡
# large-v3≈ 10GB，最准，生产用

_raw_lang = os.getenv("WHISPER_LANG", "").strip().lower()
# 空 / auto / detect => Whisper 自动检测语言（支持中英混合）
LANGUAGE = None if _raw_lang in ("", "auto", "detect") else _raw_lang

PORT      = int(os.getenv("WHISPER_PORT", "8000"))
LOG_LEVEL = os.getenv("LOG_LEVEL", "info")
REQUESTED_DEVICE = os.getenv("WHISPER_DEVICE", "").strip().lower()

# ─────────────────────────────────────────────────────────────────────────────
# 日志
# ─────────────────────────────────────────────────────────────────────────────

logging.basicConfig(
    level=LOG_LEVEL.upper(),
    format="%(asctime)s [%(levelname)s] %(name)s — %(message)s",
    datefmt="%H:%M:%S",
)
logger = logging.getLogger("whisper_server")


def _resolve_device() -> str:
    """cuda > mps (Apple Silicon) > cpu"""
    if REQUESTED_DEVICE:
        if REQUESTED_DEVICE == "cuda":
            if torch.cuda.is_available():
                return "cuda"
            logger.warning("WHISPER_DEVICE=cuda 但 CUDA 不可用，回退自动检测")
        elif REQUESTED_DEVICE == "mps":
            if torch.backends.mps.is_available():
                return "mps"
            logger.warning("WHISPER_DEVICE=mps 但 MPS 不可用，回退自动检测")
        elif REQUESTED_DEVICE == "cpu":
            return "cpu"
        else:
            logger.warning("未知 WHISPER_DEVICE=%s，回退自动检测", REQUESTED_DEVICE)

    if torch.cuda.is_available():
        return "cuda"
    if torch.backends.mps.is_available():
        return "mps"
    return "cpu"


def _load_whisper_model(preferred_device: str):
    """openai-whisper 在部分 Mac/PyTorch 组合上 MPS 会崩，自动回退 CPU。"""
    candidates = [preferred_device]
    if preferred_device == "mps":
        candidates.append("cpu")

    last_error = None
    for device in candidates:
        use_fp16 = device != "cpu"
        logger.info(
            "正在加载 Whisper 模型 [%s]（device=%s fp16=%s），首次下载需要几分钟...",
            MODEL_NAME,
            device,
            use_fp16,
        )
        load_start = time.time()
        try:
            loaded = whisper.load_model(MODEL_NAME, device=device)
            if device != preferred_device:
                logger.warning(
                    "Whisper 在 %s 上不可用（%s），已回退到 %s",
                    preferred_device,
                    last_error,
                    device,
                )
            logger.info("模型加载完成，耗时 %.1fs", time.time() - load_start)
            return loaded, device, use_fp16
        except (NotImplementedError, RuntimeError) as error:
            last_error = error
            logger.warning("Whisper 在 %s 上加载失败: %s", device, error)

    raise RuntimeError(f"Whisper 模型加载失败，最后错误: {last_error}")


PREFERRED_DEVICE = _resolve_device()
model, DEVICE, USE_FP16 = _load_whisper_model(PREFERRED_DEVICE)

# ─────────────────────────────────────────────────────────────────────────────
# FastAPI 应用
# ─────────────────────────────────────────────────────────────────────────────

app = FastAPI(title="Whisper ASR Server", version="1.0.0")

# CORS：本地开发全放开，生产环境改成具体域名
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


# ─────────────────────────────────────────────────────────────────────────────
# 数据模型
# ─────────────────────────────────────────────────────────────────────────────

class Segment(BaseModel):
    start: float
    end: float
    text: str


class TranscribeResult(BaseModel):
    text: str           # 完整转录文本
    language: str       # 检测到的语言（如 "en", "zh"）
    segments: list[Segment]  # 带时间戳的分段（可选用）
    duration_ms: int    # 推理耗时（毫秒）


# ─────────────────────────────────────────────────────────────────────────────
# 路由
# ─────────────────────────────────────────────────────────────────────────────

@app.get("/health")
def health():
    """健康检查，backend/server.js 启动时可 ping 这里确认 ASR 服务就绪"""
    return {
        "status": "ok",
        "model": MODEL_NAME,
        "language": LANGUAGE or "auto",
        "device": DEVICE,
        "fp16": USE_FP16,
    }


@app.post("/transcribe", response_model=TranscribeResult)
async def transcribe(audio: UploadFile = File(...)):
    """
    接受浏览器录音（webm/opus、wav、mp3、ogg、m4a 等格式均可）
    返回 transcript、检测语言和逐段文本

    前端调用示例（backend/server.js 里这样发）:
        const form = new FormData()
        form.append('audio', audioBlob, 'recording.webm')
        const res = await fetch('http://localhost:8000/transcribe', {
            method: 'POST', body: form
        })
        const { text } = await res.json()
    """
    # ── 1. 读取上传内容 ────────────────────────────────────────────────────
    data = await audio.read()
    if not data:
        raise HTTPException(status_code=400, detail="上传的音频文件为空")

    logger.debug(f"收到音频: {audio.filename}, 大小: {len(data)/1024:.1f} KB")

    # ── 2. 写入临时文件（whisper.transcribe 需要文件路径，不接受 bytes）──────
    # 保留原始后缀，帮助 ffmpeg 识别格式；浏览器 webm 默认是 opus 编码
    suffix = Path(audio.filename or "audio.webm").suffix or ".webm"
    tmp_path = None
    try:
        with tempfile.NamedTemporaryFile(delete=False, suffix=suffix) as tmp:
            tmp.write(data)
            tmp_path = tmp.name

        # ── 3. 推理 ───────────────────────────────────────────────────────
        t0 = time.time()
        result = model.transcribe(
            tmp_path,
            language=LANGUAGE,   # None = 自动检测
            task="transcribe",   # "transcribe" 保原语言；"translate" 译成英文
            fp16=USE_FP16,
            verbose=False,
            # 口语陪练优先延迟：单 beam、不依赖上文、不产出词级时间戳
            beam_size=1,
            best_of=1,
            condition_on_previous_text=False,
            word_timestamps=False,
        )
        elapsed_ms = int((time.time() - t0) * 1000)

        text = result["text"].strip()
        lang = result.get("language", "unknown")
        logger.info(f"[{elapsed_ms}ms] lang={lang} | {text[:100]}{'...' if len(text)>100 else ''}")

        # ── 4. 返回结果 ───────────────────────────────────────────────────
        return TranscribeResult(
            text=text,
            language=lang,
            segments=[
                Segment(start=s["start"], end=s["end"], text=s["text"])
                for s in result.get("segments", [])
            ],
            duration_ms=elapsed_ms,
        )

    except Exception as e:
        logger.error(f"转录失败: {e}", exc_info=True)
        raise HTTPException(status_code=500, detail=f"转录失败: {str(e)}")

    finally:
        # 清理临时文件，不留磁盘垃圾
        if tmp_path:
            try:
                os.unlink(tmp_path)
            except OSError:
                pass


# ─────────────────────────────────────────────────────────────────────────────
# 入口
# ─────────────────────────────────────────────────────────────────────────────

if __name__ == "__main__":
    logger.info(f"Whisper ASR 服务启动 → http://localhost:{PORT}")
    logger.info(f"  模型: {MODEL_NAME}  语言: {LANGUAGE or '自动检测'}  设备: {DEVICE}")
    uvicorn.run(app, host="0.0.0.0", port=PORT, log_level=LOG_LEVEL)
