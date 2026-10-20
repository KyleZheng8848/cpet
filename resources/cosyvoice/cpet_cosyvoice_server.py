#!/usr/bin/env python3
# Copyright (c) CPET — local CosyVoice sidecar (stdlib HTTP, no FastAPI required).
"""
本机 CosyVoice 侧车：仅监听 127.0.0.1。
环境变量：
  CPET_COSYVOICE_ROOT  CosyVoice 仓库根目录
  CPET_COSYVOICE_MODEL 模型目录或 ModelScope id（默认 iic/CosyVoice-300M）
  CPET_COSYVOICE_PORT  端口（默认 18765）
"""

from __future__ import annotations

import argparse
import hashlib
import json
import logging
import os
import struct
import sys
import tempfile
import threading
import traceback
import wave
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from typing import Any, Dict, Iterator, Optional
from urllib.parse import urlparse

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s %(levelname)s %(message)s",
)
log = logging.getLogger("cpet-cosyvoice")

MODEL = None
SAMPLE_RATE = 22050
READY_ERROR: Optional[str] = None
# CosyVoice 推理非线程安全；并行请求会互相拖慢到十几秒
INFER_LOCK = threading.Lock()
# prompt wav → zero_shot_spk_id（避免每句重新编码参考音色）
_SPK_IDS: Dict[str, str] = {}


def pcm16_to_wav_bytes(pcm: bytes, sample_rate: int) -> bytes:
    buf = tempfile.SpooledTemporaryFile(max_size=8 * 1024 * 1024)
    with wave.open(buf, "wb") as wf:
        wf.setnchannels(1)
        wf.setsampwidth(2)
        wf.setframerate(sample_rate)
        wf.writeframes(pcm)
    buf.seek(0)
    return buf.read()


def float_tensor_to_pcm16(tts_speech) -> bytes:
    import numpy as np

    arr = tts_speech.detach().cpu().numpy().reshape(-1)
    arr = np.clip(arr, -1.0, 1.0)
    return (arr * (2**15)).astype(np.int16).tobytes()


def load_model(model_dir: str, cosy_root: str) -> None:
    global MODEL, SAMPLE_RATE, READY_ERROR
    READY_ERROR = None
    root = Path(cosy_root).expanduser().resolve()
    if not root.is_dir():
        READY_ERROR = f"CosyVoice 根目录不存在：{root}"
        raise FileNotFoundError(READY_ERROR)

    sys.path.insert(0, str(root))
    sys.path.insert(0, str(root / "third_party" / "Matcha-TTS"))
    try:
        from cosyvoice.cli.cosyvoice import AutoModel  # type: ignore
    except Exception as e:
        READY_ERROR = (
            f"无法导入 CosyVoice（请确认仓库完整且依赖已安装）：{e}"
        )
        raise

    log.info("loading model %s from %s", model_dir, root)
    MODEL = AutoModel(model_dir=model_dir)
    SAMPLE_RATE = int(getattr(MODEL, "sample_rate", 22050) or 22050)
    log.info("model ready, sample_rate=%s", SAMPLE_RATE)


def _ensure_zero_shot_spk(prompt_text: str, prompt_wav: str) -> str:
    """注册/复用参考音色，后续推理走 spk2info 缓存，显著降低每句前置开销。"""
    assert MODEL is not None
    path = str(Path(prompt_wav).expanduser().resolve())
    try:
        mtime = os.path.getmtime(path)
    except OSError:
        mtime = 0.0
    cache_key = f"{path}:{mtime}:{prompt_text}"
    hit = _SPK_IDS.get(cache_key)
    if hit and hit in getattr(MODEL.frontend, "spk2info", {}):
        return hit
    spk_id = "cpet_" + hashlib.md5(cache_key.encode("utf-8")).hexdigest()[:16]
    if spk_id not in getattr(MODEL.frontend, "spk2info", {}):
        log.info("register zero_shot spk %s from %s", spk_id, path)
        MODEL.add_zero_shot_spk(prompt_text, path, spk_id)
    _SPK_IDS[cache_key] = spk_id
    return spk_id


def _iter_pcm(
    text: str,
    *,
    prompt_text: str = "",
    prompt_wav: str = "",
    spk_id: str = "",
    mode: str = "zero_shot",
) -> Iterator[bytes]:
    if MODEL is None:
        raise RuntimeError(READY_ERROR or "模型未就绪")

    text = (text or "").strip()
    if not text:
        raise ValueError("文本为空")

    if mode == "sft" and spk_id:
        # stream=False：整段合成完再吐，避免「几个字一卡」
        for item in MODEL.inference_sft(text, spk_id, stream=False):
            yield float_tensor_to_pcm16(item["tts_speech"])
        return

    if not prompt_wav or not Path(prompt_wav).is_file():
        raise ValueError("zero_shot 需要有效的参考音频 prompt_wav")
    ptext = (prompt_text or "").strip() or "希望你以后能够做的比我还好呦。"
    zero_shot_spk_id = _ensure_zero_shot_spk(ptext, prompt_wav)
    # text_frontend=False：禁止模型再切碎
    # stream=False：本机 RTF>>1 时边推边播必卡；整段完成后再推连续 PCM
    for item in MODEL.inference_zero_shot(
        text,
        ptext,
        prompt_wav,
        zero_shot_spk_id=zero_shot_spk_id,
        stream=False,
        text_frontend=False,
    ):
        yield float_tensor_to_pcm16(item["tts_speech"])


def synthesize(
    text: str,
    *,
    prompt_text: str = "",
    prompt_wav: str = "",
    spk_id: str = "",
    mode: str = "zero_shot",
) -> bytes:
    chunks: list[bytes] = []
    with INFER_LOCK:
        for pcm in _iter_pcm(
            text,
            prompt_text=prompt_text,
            prompt_wav=prompt_wav,
            spk_id=spk_id,
            mode=mode,
        ):
            if pcm:
                chunks.append(pcm)
    if not chunks:
        raise RuntimeError("模型未返回音频")
    return pcm16_to_wav_bytes(b"".join(chunks), SAMPLE_RATE)


def synthesize_stream(
    text: str,
    *,
    prompt_text: str = "",
    prompt_wav: str = "",
    spk_id: str = "",
    mode: str = "zero_shot",
) -> Iterator[bytes]:
    """持锁流式产出 PCM；调用方必须耗尽迭代器以释放锁。"""
    with INFER_LOCK:
        yielded = False
        for pcm in _iter_pcm(
            text,
            prompt_text=prompt_text,
            prompt_wav=prompt_wav,
            spk_id=spk_id,
            mode=mode,
        ):
            if pcm:
                yielded = True
                yield pcm
        if not yielded:
            raise RuntimeError("模型未返回音频")


class Handler(BaseHTTPRequestHandler):
    server_version = "CPET-CosyVoice/1.1"

    def log_message(self, fmt: str, *args: Any) -> None:
        log.info("%s - " + fmt, self.address_string(), *args)

    def _send(self, code: int, body: bytes, content_type: str) -> None:
        self.send_response(code)
        self.send_header("Content-Type", content_type)
        self.send_header("Content-Length", str(len(body)))
        self.send_header("Cache-Control", "no-store")
        self.end_headers()
        self.wfile.write(body)

    def _json(self, code: int, obj: dict) -> None:
        data = json.dumps(obj, ensure_ascii=False).encode("utf-8")
        self._send(code, data, "application/json; charset=utf-8")

    def do_GET(self) -> None:
        path = urlparse(self.path).path
        if path in ("/health", "/"):
            self._json(
                200,
                {
                    "ok": True,
                    "ready": MODEL is not None,
                    "error": READY_ERROR,
                    "sampleRate": SAMPLE_RATE,
                },
            )
            return
        self._json(404, {"ok": False, "error": "not found"})

    def _parse_speak_payload(self) -> dict:
        length = int(self.headers.get("Content-Length") or "0")
        raw = self.rfile.read(length) if length > 0 else b"{}"
        return json.loads(raw.decode("utf-8") or "{}")

    def do_POST(self) -> None:
        path = urlparse(self.path).path
        if path == "/v1/speak":
            try:
                payload = self._parse_speak_payload()
                wav = synthesize(
                    str(payload.get("text") or ""),
                    prompt_text=str(payload.get("promptText") or ""),
                    prompt_wav=str(payload.get("promptWav") or ""),
                    spk_id=str(payload.get("spkId") or ""),
                    mode=str(payload.get("mode") or "zero_shot"),
                )
                self._send(200, wav, "audio/wav")
            except Exception as e:
                log.error("speak failed: %s\n%s", e, traceback.format_exc())
                self._json(500, {"ok": False, "error": str(e)})
            return

        if path == "/v1/speak-stream":
            # 帧格式：uint32 BE length + pcm16le mono；length=0 结束
            headers_sent = False
            try:
                payload = self._parse_speak_payload()
                self.send_response(200)
                self.send_header("Content-Type", "application/octet-stream")
                self.send_header("X-Sample-Rate", str(SAMPLE_RATE))
                self.send_header("Cache-Control", "no-store")
                self.end_headers()
                headers_sent = True
                for pcm in synthesize_stream(
                    str(payload.get("text") or ""),
                    prompt_text=str(payload.get("promptText") or ""),
                    prompt_wav=str(payload.get("promptWav") or ""),
                    spk_id=str(payload.get("spkId") or ""),
                    mode=str(payload.get("mode") or "zero_shot"),
                ):
                    self.wfile.write(struct.pack(">I", len(pcm)))
                    self.wfile.write(pcm)
                    self.wfile.flush()
                self.wfile.write(struct.pack(">I", 0))
                self.wfile.flush()
            except Exception as e:
                log.error("speak-stream failed: %s\n%s", e, traceback.format_exc())
                if headers_sent:
                    try:
                        self.wfile.write(struct.pack(">I", 0))
                        self.wfile.flush()
                    except Exception:
                        pass
                else:
                    self._json(500, {"ok": False, "error": str(e)})
            return

        self._json(404, {"ok": False, "error": "not found"})


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--port", type=int, default=int(os.environ.get("CPET_COSYVOICE_PORT") or 18765))
    parser.add_argument(
        "--model-dir",
        default=os.environ.get("CPET_COSYVOICE_MODEL") or "iic/CosyVoice-300M",
    )
    parser.add_argument(
        "--cosy-root",
        default=os.environ.get("CPET_COSYVOICE_ROOT") or "",
    )
    args = parser.parse_args()
    if not args.cosy_root:
        log.error("缺少 --cosy-root / CPET_COSYVOICE_ROOT")
        return 2
    global READY_ERROR
    try:
        load_model(args.model_dir, args.cosy_root)
    except Exception as e:
        log.error("load failed: %s", e)
        READY_ERROR = str(e)

    host = "127.0.0.1"
    httpd = ThreadingHTTPServer((host, args.port), Handler)
    log.info("listening on http://%s:%s", host, args.port)
    try:
        httpd.serve_forever()
    except KeyboardInterrupt:
        pass
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
