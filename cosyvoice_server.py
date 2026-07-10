#!/usr/bin/env python3
"""
cosyvoice_server.py — 本地 CosyVoice TTS HTTP 服务
端口: 8001（可用环境变量 COSYVOICE_PORT 覆盖）

前置条件（CosyVoice 官方仓库依赖较重，无法只靠 pip install 一个包解决）：
  1. git clone --recursive https://github.com/FunAudioLLM/CosyVoice.git
     cd CosyVoice && git submodule update --init --recursive
  2. 把 CosyVoice 仓库目录传给 COSYVOICE_REPO_DIR（脚本会自动 sys.path.append，
     包括它的 third_party/Matcha-TTS 子模块，官方仓库就是这么依赖的）
  3. 下载预训练模型（推荐 CosyVoice2-0.5B，中英文效果都不错，体积小)：
       from modelscope import snapshot_download
       snapshot_download('iic/CosyVoice2-0.5B', local_dir='pretrained_models/CosyVoice2-0.5B')
  4. pip install -r requirements_cosyvoice.txt
     （强烈建议先用 CosyVoice 官方仓库自带的 requirements.txt 装一遍环境，
      版本依赖很挑，这里只是补充 HTTP 服务需要的部分）

接口:
  GET  /health        健康检查 + 当前模型信息
  GET  /speakers      列出预置音色（sft / instruct 模式可用）
  POST /synthesize    文字 → 音频（wav），核心接口

用法:
  # 默认模型目录 pretrained_models/CosyVoice2-0.5B
  python cosyvoice_server.py

  # 指定 CosyVoice 仓库路径 / 模型目录 / 端口
  COSYVOICE_REPO_DIR=/path/to/CosyVoice \
  COSYVOICE_MODEL_DIR=pretrained_models/CosyVoice2-0.5B \
  COSYVOICE_PORT=8001 \
  python cosyvoice_server.py

  # Mac Apple GPU（需 CosyVoice feat/apple-silicon 分支）
  PYTORCH_ENABLE_MPS_FALLBACK=1 COSYVOICE_FP16=true ./start_cosyvoice.sh

/synthesize 支持三种模式（form 字段 mode）：
  - sft         用预置音色直接合成，最简单最快。字段：text, spk_id, speed
  - zero_shot   用一段参考音频克隆音色。字段：text, prompt_text, prompt_audio(文件), speed
  - instruct    自然语言描述语气/风格。字段：text, instruct_text, spk_id 或 prompt_audio, speed
                （CosyVoice2 的 instruct 需要 prompt_audio 决定音色；
                 CosyVoice v1 的 instruct 用 spk_id 决定音色）
"""

import os
import io
import sys
import time
import logging
import tempfile
import random
from pathlib import Path
from typing import Optional

import numpy as np

# ── CosyVoice 仓库不是 pip 包，需要把仓库目录加进 sys.path ──────────────────
REPO_DIR = os.getenv("COSYVOICE_REPO_DIR", "./CosyVoice")
for _p in (REPO_DIR, os.path.join(REPO_DIR, "third_party", "Matcha-TTS")):
    if _p not in sys.path:
        sys.path.append(_p)

import torch
import torchaudio
import uvicorn
from fastapi import FastAPI, File, Form, UploadFile, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import StreamingResponse

try:
    from cosyvoice.cli.cosyvoice import CosyVoice2 as _CosyVoiceCls
    IS_V2 = True
except ImportError:
    from cosyvoice.cli.cosyvoice import CosyVoice as _CosyVoiceCls
    IS_V2 = False

try:
    from cosyvoice.utils.device import get_device, is_gpu_available
except ImportError:
    def get_device():
        if torch.cuda.is_available():
            return torch.device("cuda")
        if hasattr(torch.backends, "mps") and torch.backends.mps.is_available():
            return torch.device("mps")
        return torch.device("cpu")

    def is_gpu_available() -> bool:
        return get_device().type != "cpu"

# ─────────────────────────────────────────────────────────────────────────────
# 配置（环境变量覆盖）
# ─────────────────────────────────────────────────────────────────────────────

MODEL_DIR    = os.getenv("COSYVOICE_MODEL_DIR", "pretrained_models/CosyVoice2-0.5B")
PORT         = int(os.getenv("COSYVOICE_PORT", "8001"))
LOG_LEVEL    = os.getenv("LOG_LEVEL", "info")
OUTPUT_PCM_SAMPLE_RATE = int(os.getenv("COSYVOICE_PCM_SAMPLE_RATE", "16000"))
DEFAULT_SPK  = os.getenv("COSYVOICE_DEFAULT_SPK", None)  # None = 自动取第一个预置音色
DEFAULT_PROMPT_WAV = os.getenv(
    "COSYVOICE_PROMPT_WAV",
    os.path.join(REPO_DIR, "asset", "zero_shot_prompt.wav"),
)
DEFAULT_PROMPT_TEXT = os.getenv(
    "COSYVOICE_PROMPT_TEXT",
    "希望你以后能够做的比我还好呦。",
)
DEFAULT_ENGLISH_INSTRUCT = os.getenv(
    "COSYVOICE_ENGLISH_INSTRUCT",
    "Speak at a calm, moderate pace in warm, natural American English like a friendly speaking coach.<|endofprompt|>",
)
DEFAULT_COSYVOICE_SPEED = float(os.getenv("COSYVOICE_DEFAULT_SPEED", "0.85"))
INFERENCE_SEED = int(os.getenv("COSYVOICE_SEED", "1986"))


def _parse_bool_env(name: str, default: bool) -> bool:
    raw = os.getenv(name)
    if raw is None:
        return default
    return raw.strip().lower() in {"1", "true", "yes", "on"}


INFERENCE_DEVICE = get_device()
USE_FP16 = _parse_bool_env("COSYVOICE_FP16", INFERENCE_DEVICE.type == "cuda")

# ─────────────────────────────────────────────────────────────────────────────
# 日志
# ─────────────────────────────────────────────────────────────────────────────

logging.basicConfig(
    level=LOG_LEVEL.upper(),
    format="%(asctime)s [%(levelname)s] %(name)s — %(message)s",
    datefmt="%H:%M:%S",
)
logger = logging.getLogger("cosyvoice_server")

# ─────────────────────────────────────────────────────────────────────────────
# 模型加载（启动时加载一次，常驻内存，后续请求不重复加载）
# ─────────────────────────────────────────────────────────────────────────────

logger.info(
    "正在加载 CosyVoice%s 模型 [%s]（device=%s fp16=%s）...",
    "2" if IS_V2 else "",
    MODEL_DIR,
    INFERENCE_DEVICE,
    USE_FP16,
)
_load_start = time.time()
cosyvoice = _CosyVoiceCls(MODEL_DIR, load_jit=False, load_trt=False, fp16=USE_FP16)
logger.info(
    "模型加载完成，耗时 %.1fs，采样率 %sHz，实际 fp16=%s",
    time.time() - _load_start,
    cosyvoice.sample_rate,
    cosyvoice.fp16,
)

def _ensure_default_speaker() -> None:
    """CosyVoice2 没有 SFT 预置音色，启动时用官方示例音频注册一个默认克隆音色。"""
    global DEFAULT_SPK, AVAILABLE_SPKS

    candidate = DEFAULT_SPK or "xiaobang_default"
    if candidate in cosyvoice.list_available_spks():
        DEFAULT_SPK = candidate
        AVAILABLE_SPKS = cosyvoice.list_available_spks()
        return

    if not os.path.exists(DEFAULT_PROMPT_WAV):
        logger.warning("默认参考音频不存在: %s", DEFAULT_PROMPT_WAV)
        return

    cosyvoice.add_zero_shot_spk(DEFAULT_PROMPT_TEXT, DEFAULT_PROMPT_WAV, candidate)
    try:
        cosyvoice.save_spkinfo()
        logger.info("默认音色已写入 spk2info.pt")
    except Exception as error:
        logger.warning("写入 spk2info.pt 失败（不影响本次运行）: %s", error)
    AVAILABLE_SPKS = cosyvoice.list_available_spks()
    DEFAULT_SPK = candidate
    logger.info("已注册默认克隆音色 [%s]，参考音频: %s", candidate, DEFAULT_PROMPT_WAV)


def _set_inference_seed() -> None:
    """固定采样种子，减少每次合成的音色漂移。"""
    torch.manual_seed(INFERENCE_SEED)
    np.random.seed(INFERENCE_SEED)
    random.seed(INFERENCE_SEED)


def _resolve_spk_id(spk_id: Optional[str]) -> Optional[str]:
    """忽略豆包等外部 voice id，回退到 CosyVoice 可用音色。"""
    candidate = spk_id or DEFAULT_SPK
    if candidate and candidate in AVAILABLE_SPKS:
        return candidate
    if spk_id and spk_id not in AVAILABLE_SPKS:
        logger.warning("未知音色 %s，回退到 %s", spk_id, DEFAULT_SPK)
    return DEFAULT_SPK


def _is_mostly_english(text: str) -> bool:
    letters = [c for c in text if c.isalpha()]
    if not letters:
        return True
    ascii_letters = sum(1 for c in letters if c.isascii())
    return ascii_letters / len(letters) > 0.7


AVAILABLE_SPKS = cosyvoice.list_available_spks()
if not DEFAULT_SPK:
    DEFAULT_SPK = AVAILABLE_SPKS[0] if AVAILABLE_SPKS else None
if not AVAILABLE_SPKS:
    _ensure_default_speaker()
elif DEFAULT_SPK and DEFAULT_SPK not in AVAILABLE_SPKS:
    _ensure_default_speaker()
logger.info(f"预置音色: {AVAILABLE_SPKS} | 默认: {DEFAULT_SPK}")

# ─────────────────────────────────────────────────────────────────────────────
# FastAPI 应用
# ─────────────────────────────────────────────────────────────────────────────

app = FastAPI(title="CosyVoice TTS Server", version="1.0.0")

# CORS：本地开发全放开，生产环境改成具体域名
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.get("/health")
def health():
    """健康检查，backend/server.js 启动时可 ping 这里确认 TTS 服务就绪"""
    return {
        "status": "ok",
        "model": MODEL_DIR,
        "version": "v2" if IS_V2 else "v1",
        "sample_rate": cosyvoice.sample_rate,
        "device": str(INFERENCE_DEVICE),
        "fp16": cosyvoice.fp16,
        "default_spk": DEFAULT_SPK,
        "english_instruct": DEFAULT_ENGLISH_INSTRUCT,
        "inference_seed": INFERENCE_SEED,
    }


@app.get("/speakers")
def speakers():
    """列出 sft / instruct(v1) 模式可用的预置音色 id"""
    return {"speakers": AVAILABLE_SPKS}


def _tensor_to_pcm16_bytes(speech: torch.Tensor, sample_rate: int, target_sr: int = OUTPUT_PCM_SAMPLE_RATE) -> bytes:
    """把 tensor 转成 16-bit mono PCM 字节流，供流式推送（跳过 wav + ffmpeg）。"""
    if speech.dim() == 1:
        speech = speech.unsqueeze(0)
    # MPS/CUDA tensor → CPU float32，避免半精度/设备张量转 PCM 失真
    speech = speech.detach().to(device="cpu", dtype=torch.float32)
    if sample_rate != target_sr:
        speech = torchaudio.transforms.Resample(orig_freq=sample_rate, new_freq=target_sr)(speech)
    pcm = (speech.squeeze().clamp(-1.0, 1.0) * 32767.0).to(torch.int16)
    return pcm.contiguous().numpy().tobytes()


def _tensor_to_wav_bytes(speech: torch.Tensor, sample_rate: int) -> bytes:
    """把推理输出的 tensor 编码成 wav 字节流（用临时文件中转，兼容各版本 torchaudio）"""
    with tempfile.NamedTemporaryFile(suffix=".wav", delete=False) as tmp:
        tmp_path = tmp.name
    try:
        torchaudio.save(tmp_path, speech, sample_rate)
        return Path(tmp_path).read_bytes()
    finally:
        try:
            os.unlink(tmp_path)
        except OSError:
            pass


def _save_uploaded_audio(upload_bytes: bytes, filename: str) -> str:
    """把上传的参考音频写入临时文件；CosyVoice 推理接口需要文件路径，不是 tensor。"""
    suffix = Path(filename or "prompt.wav").suffix or ".wav"
    with tempfile.NamedTemporaryFile(suffix=suffix, delete=False) as tmp:
        tmp.write(upload_bytes)
        return tmp.name


def _unlink_quiet(path: str) -> None:
    try:
        os.unlink(path)
    except OSError:
        pass


def _parse_bool(value) -> bool:
    if isinstance(value, bool):
        return value
    return str(value).strip().lower() in {"1", "true", "yes", "on"}


def _build_inference_generator(
    *,
    mode: str,
    text: str,
    spk_id: Optional[str],
    speed: float,
    instruct_text: Optional[str],
    prompt_text: Optional[str],
    prompt_path: Optional[str],
    use_stream: bool,
):
    if mode == "sft":
        use_spk = _resolve_spk_id(spk_id)
        if not use_spk:
            raise HTTPException(status_code=400, detail="没有可用的预置音色，请改用 zero_shot 模式")
        if IS_V2 and _is_mostly_english(text):
            tts_text = text if text.strip().startswith("<|") else f"<|en|>{text}"
            # cross_lingual 会剥离 prompt 文本，避免把参考音频里的中文 prompt 念出来
            return cosyvoice.inference_cross_lingual(
                tts_text,
                DEFAULT_PROMPT_WAV,
                zero_shot_spk_id=use_spk,
                stream=use_stream,
                speed=speed,
            )
        return cosyvoice.inference_sft(text, use_spk, stream=use_stream, speed=speed)

    if mode == "zero_shot":
        if not prompt_path or not prompt_text:
            raise HTTPException(status_code=400, detail="zero_shot 模式需要 prompt_audio + prompt_text")
        return cosyvoice.inference_zero_shot(
            text, prompt_text, prompt_path, stream=use_stream, speed=speed
        )

    if mode == "instruct":
        if not instruct_text:
            raise HTTPException(status_code=400, detail="instruct 模式需要 instruct_text（如 '用开心的语气说'）")
        if IS_V2:
            if prompt_path:
                return cosyvoice.inference_instruct2(
                    text, instruct_text, prompt_path, stream=use_stream, speed=speed
                )
            if not os.path.exists(DEFAULT_PROMPT_WAV):
                raise HTTPException(status_code=400, detail="CosyVoice2 的 instruct 模式需要 prompt_audio 决定音色")
            use_spk = _resolve_spk_id(spk_id)
            return cosyvoice.inference_instruct2(
                text,
                instruct_text,
                DEFAULT_PROMPT_WAV,
                zero_shot_spk_id=use_spk or "",
                stream=use_stream,
                speed=speed,
            )
        use_spk = spk_id or DEFAULT_SPK
        if not use_spk:
            raise HTTPException(status_code=400, detail="没有可用的预置音色")
        return cosyvoice.inference_instruct(text, use_spk, instruct_text, stream=use_stream, speed=speed)

    raise HTTPException(status_code=400, detail=f"未知 mode: {mode}（支持 sft / zero_shot / instruct）")


@app.post("/synthesize")
async def synthesize(
    text: str = Form(...),
    mode: str = Form("sft"),                       # sft | zero_shot | instruct
    spk_id: Optional[str] = Form(None),
    speed: float = Form(1.0),
    stream: bool = Form(False),
    output_format: str = Form("wav"),              # wav | pcm
    instruct_text: Optional[str] = Form(None),
    prompt_text: Optional[str] = Form(None),
    prompt_audio: Optional[UploadFile] = File(None),
):
    """
    文字 → 音频（wav，二进制流）

    前端调用示例（backend/server.js 里这样发）:
        const form = new FormData()
        form.append('text', replyText)
        form.append('mode', 'sft')
        form.append('spk_id', '中文女')
        form.append('speed', '1.0')
        const res = await fetch('http://localhost:8001/synthesize', {
            method: 'POST', body: form
        })
        const audioBuf = await res.arrayBuffer()
    """
    if not text or not text.strip():
        raise HTTPException(status_code=400, detail="text 不能为空")

    use_stream = _parse_bool(stream)
    fmt = (output_format or "wav").strip().lower()
    t0 = time.time()
    prompt_path: Optional[str] = None
    try:
        _set_inference_seed()
        if mode == "zero_shot" or (mode == "instruct" and IS_V2 and prompt_audio is not None):
            if prompt_audio is None or (mode == "zero_shot" and not prompt_text):
                raise HTTPException(status_code=400, detail="zero_shot 模式需要 prompt_audio + prompt_text")
            prompt_path = _save_uploaded_audio(await prompt_audio.read(), prompt_audio.filename)

        outputs = _build_inference_generator(
            mode=mode,
            text=text,
            spk_id=spk_id,
            speed=speed,
            instruct_text=instruct_text,
            prompt_text=prompt_text,
            prompt_path=prompt_path,
            use_stream=use_stream or fmt == "pcm",
        )

        if fmt == "pcm":
            first_chunk_at: Optional[float] = None

            def pcm_generator():
                nonlocal first_chunk_at
                chunk_count = 0
                for item in outputs:
                    chunk_count += 1
                    if first_chunk_at is None:
                        first_chunk_at = time.time()
                        logger.info(
                            "[%.0fms] first pcm chunk | mode=%s | %s",
                            (first_chunk_at - t0) * 1000,
                            mode,
                            text[:60],
                        )
                    yield _tensor_to_pcm16_bytes(item["tts_speech"], cosyvoice.sample_rate)

                elapsed_ms = int((time.time() - t0) * 1000)
                logger.info(
                    "[%dms] streamed %d pcm chunks | mode=%s | %s",
                    elapsed_ms,
                    chunk_count,
                    mode,
                    text[:60],
                )

            return StreamingResponse(
                pcm_generator(),
                media_type="application/octet-stream",
                headers={
                    "X-Audio-Format": "pcm_s16le",
                    "X-Sample-Rate": str(OUTPUT_PCM_SAMPLE_RATE),
                    "X-Channels": "1",
                },
            )

        chunks = [o["tts_speech"] for o in outputs]
        if not chunks:
            raise HTTPException(status_code=500, detail="模型没有产出音频，检查输入文本")
        speech = torch.cat(chunks, dim=1)

        elapsed_ms = int((time.time() - t0) * 1000)
        logger.info(f"[{elapsed_ms}ms] mode={mode} | {text[:60]}{'...' if len(text) > 60 else ''}")

        wav_bytes = _tensor_to_wav_bytes(speech, cosyvoice.sample_rate)
        return StreamingResponse(
            io.BytesIO(wav_bytes),
            media_type="audio/wav",
            headers={"X-Duration-Ms": str(elapsed_ms)},
        )

    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"合成失败: {e}", exc_info=True)
        raise HTTPException(status_code=500, detail=f"合成失败: {str(e)}")
    finally:
        if prompt_path:
            _unlink_quiet(prompt_path)


# ─────────────────────────────────────────────────────────────────────────────
# 入口
# ─────────────────────────────────────────────────────────────────────────────

if __name__ == "__main__":
    logger.info(f"CosyVoice TTS 服务启动 → http://localhost:{PORT}")
    logger.info(
        "  模型: %s  版本: %s  设备: %s  fp16: %s  默认音色: %s",
        MODEL_DIR,
        "v2" if IS_V2 else "v1",
        INFERENCE_DEVICE,
        cosyvoice.fp16,
        DEFAULT_SPK,
    )
    uvicorn.run(app, host="0.0.0.0", port=PORT, log_level=LOG_LEVEL)
