"""Bounded, streaming Silero VAD inference for EDITMAP's local speech evidence."""
import json
import logging
import os
import subprocess
import tempfile
import time
import urllib.request
from typing import Any, Dict, List, Optional

import numpy as np
import onnxruntime as ort

logger = logging.getLogger("editmap.speech_engine")
SAMPLE_RATE = 16_000
WINDOW_SAMPLES = 512  # Silero v5 ONNX's fixed 16 kHz streaming window.
MODEL_VERSION = "6.2.0"
SETTINGS_VERSION = "vad-1"
MODEL_URL = "https://raw.githubusercontent.com/snakers4/silero-vad/v5.1.2/src/silero_vad/data/silero_vad.onnx"


class SpeechEngine:
    def __init__(self, models_dir: Optional[str] = None):
        self.models_dir = models_dir or os.path.join(os.path.dirname(os.path.abspath(__file__)), "models")
        self.model_path = os.path.join(self.models_dir, "silero-vad-v6.2.0-op16.onnx")
        self.session = None

    def ensure_model(self, progress=None):
        if self.session is not None:
            return False
        os.makedirs(self.models_dir, exist_ok=True)
        if not os.path.isfile(self.model_path):
            if progress: progress("provisioning", 0, "Downloading Silero VAD v6.2.0 model…")
            temporary = self.model_path + ".part"
            try:
                with urllib.request.urlopen(MODEL_URL, timeout=60) as source, open(temporary, "wb") as output:
                    total = int(source.headers.get("Content-Length", 0))
                    received = 0
                    while block := source.read(128 * 1024):
                        output.write(block); received += len(block)
                        if progress and total: progress("provisioning", min(.95, received / total), "Downloading Silero VAD v6.2.0 model…")
                os.replace(temporary, self.model_path)
            finally:
                if os.path.exists(temporary): os.unlink(temporary)
        if progress: progress("provisioning", 1, "Loading Silero VAD v6.2.0…")
        options = ort.SessionOptions(); options.intra_op_num_threads = 1; options.inter_op_num_threads = 1
        self.session = ort.InferenceSession(self.model_path, sess_options=options, providers=["CPUExecutionProvider"])
        logger.info("Silero VAD %s ready", MODEL_VERSION)
        return True

    @staticmethod
    def duration(path: str) -> float:
        probe = subprocess.run(["ffprobe", "-v", "error", "-protocol_whitelist", "file,pipe", "-show_entries", "format=duration", "-of", "json", path], capture_output=True, text=True, timeout=30)
        value = float(json.loads(probe.stdout).get("format", {}).get("duration", 0))
        if not 0 < value <= 14_400: raise ValueError("Speech analysis supports media up to four hours with a known duration.")
        return value

    def scan(self, path: str, cancel_event=None, on_progress=None) -> Dict[str, Any]:
        duration = self.duration(path)
        self.ensure_model(on_progress)
        if cancel_event and cancel_event.is_set(): raise RuntimeError("Speech scan cancelled.")
        command = ["ffmpeg", "-nostdin", "-v", "error", "-protocol_whitelist", "file,pipe", "-i", path, "-vn", "-ac", "1", "-ar", str(SAMPLE_RATE), "-f", "f32le", "pipe:1"]
        started = time.monotonic(); regions: List[Dict[str, float]] = []; state = np.zeros((2, 1, 128), dtype=np.float32)
        active_start = None; speech_frames = 0; silence_frames = 0; position = 0
        threshold, min_speech, min_silence = .35, int(.25 * SAMPLE_RATE), int(.10 * SAMPLE_RATE)
        process = subprocess.Popen(command, stdout=subprocess.PIPE, stderr=subprocess.PIPE)
        try:
            while True:
                if cancel_event and cancel_event.is_set(): raise RuntimeError("Speech scan cancelled.")
                raw = process.stdout.read(WINDOW_SAMPLES * 4) if process.stdout else b""
                if not raw: break
                if len(raw) < WINDOW_SAMPLES * 4: raw += b"\0" * (WINDOW_SAMPLES * 4 - len(raw))
                audio = np.frombuffer(raw, dtype=np.float32).reshape(1, -1)
                output, state = self.session.run(None, {"input": audio, "state": state, "sr": np.array(SAMPLE_RATE, dtype=np.int64)})
                voiced = float(np.asarray(output).reshape(-1)[0]) >= threshold
                if voiced:
                    if active_start is None: active_start = position
                    speech_frames += WINDOW_SAMPLES; silence_frames = 0
                elif active_start is not None:
                    silence_frames += WINDOW_SAMPLES
                    if silence_frames >= min_silence:
                        end = position - silence_frames + WINDOW_SAMPLES
                        if end - active_start >= min_speech: regions.append({"startSeconds": active_start / SAMPLE_RATE, "endSeconds": min(duration, end / SAMPLE_RATE)})
                        active_start = None; speech_frames = silence_frames = 0
                position += WINDOW_SAMPLES
                if on_progress and position % (SAMPLE_RATE * 2) < WINDOW_SAMPLES:
                    elapsed = time.monotonic() - started; completed = min(duration, position / SAMPLE_RATE)
                    eta = elapsed / completed * (duration - completed) if completed >= 2 else None
                    on_progress("scanning", min(.999, completed / duration), "Detecting speech activity…", elapsed, eta)
            if active_start is not None and position - active_start >= min_speech:
                regions.append({"startSeconds": active_start / SAMPLE_RATE, "endSeconds": duration})
            if process.wait(timeout=20): raise RuntimeError(process.stderr.read(4096).decode(errors="replace") or "FFmpeg audio extraction failed.")
        finally:
            if process.poll() is None: process.kill()
            process.wait()
        processing = time.monotonic() - started
        return {"regions": regions, "duration": duration, "model": "silero-vad", "modelVersion": MODEL_VERSION, "settingsVersion": SETTINGS_VERSION, "threshold": threshold, "minSpeechMs": 250, "minSilenceMs": 100, "processingSeconds": processing}
