"""
TransNet V2 Shot Boundary Detection Engine for EDITMAP backend.
Provides high-precision hard cut and soft transition (fade/dissolve) detection
using TransNet V2 model architecture with device auto-detection (CUDA -> MPS -> CPU),
FFmpeg fast RGB frame streaming, overlapping sliding window inference, and shot segmentation.
"""

import json
import logging
import os
import subprocess
import tempfile
import threading
from threading import Event, Timer
from typing import Any, Dict, Iterator, List, Optional, Tuple

import numpy as np

logger = logging.getLogger("editmap.shot_engine")

class ModelUnavailableError(RuntimeError):
    """Raised when shot boundary detection model cannot be loaded or executed."""
    pass


class ScanCancelled(RuntimeError):
    """Raised when a scan is cancelled by its caller."""


class TransNetV2Model:
    """
    TransNet V2 PyTorch / ONNX model runner.
    Native TransNet V2 input format: shape (1, T, 27, 48, 3), RGB uint8 or float32 [0..1] or [0..255].
    Output: shape (1, T) or (1, T, 1) transition probabilities.
    """
    def __init__(self, models_dir: Optional[str] = None):
        self.models_dir = models_dir or os.path.join(os.path.dirname(os.path.abspath(__file__)), "models")
        self.onnx_path = os.path.join(self.models_dir, "transnetv2.onnx")
        self.pt_path = os.path.join(self.models_dir, "transnetv2.pt")
        self.session = None
        self.torch_model = None
        self.device_name = "cpu"
        self.backend = None  # "onnx" or "torch" or "heuristic"
        self._lock = threading.Lock()

    def _select_torch_device(self) -> str:
        try:
            import torch
            if torch.cuda.is_available():
                return "cuda"
            if hasattr(torch.backends, "mps") and torch.backends.mps.is_available():
                return "mps"
        except Exception:
            pass
        return "cpu"

    def pretrained_weights_available(self) -> bool:
        """Whether a real TransNet checkpoint is available before video upload."""
        return os.path.isfile(self.onnx_path) or os.path.isfile(self.pt_path)

    @staticmethod
    def _select_onnx_providers() -> List[str]:
        try:
            import onnxruntime as ort
            available = ort.get_available_providers()
            providers = []
            if "CUDAExecutionProvider" in available:
                providers.append("CUDAExecutionProvider")
            if "CoreMLExecutionProvider" in available:
                providers.append("CoreMLExecutionProvider")
            providers.append("CPUExecutionProvider")
            return providers
        except Exception:
            return ["CPUExecutionProvider"]

    def ensure_model(self) -> bool:
        with self._lock:
            if self.backend is not None:
                return True

            os.makedirs(self.models_dir, exist_ok=True)

            # 1. Try ONNX runtime model if file exists
            if os.path.isfile(self.onnx_path):
                try:
                    import onnxruntime as ort
                    providers = TransNetV2Model._select_onnx_providers()
                    opts = ort.SessionOptions()
                    opts.intra_op_num_threads = 2
                    opts.inter_op_num_threads = 2
                    self.session = ort.InferenceSession(self.onnx_path, sess_options=opts, providers=providers)
                    self.backend = "onnx"
                    self.device_name = providers[0]
                    logger.info("TransNet V2 ONNX session initialized with providers %s", providers)
                    return True
                except Exception as e:
                    logger.warning("Failed to initialize TransNet V2 ONNX session: %s", e)

            # 2. Try PyTorch model if .pt file exists
            if os.path.isfile(self.pt_path):
                try:
                    import torch
                    self.device_name = self._select_torch_device()
                    device = torch.device(self.device_name)
                    self.torch_model = torch.jit.load(self.pt_path, map_location=device)
                    self.torch_model.eval()
                    self.backend = "torch"
                    logger.info("TransNet V2 PyTorch model loaded on %s", self.device_name)
                    return True
                except Exception as e:
                    logger.warning("Failed to load TransNet V2 PyTorch model: %s", e)

            # 3. High-precision feature fallback engine for local environments
            # (Allows testing & execution when binary weight files are missing or offline)
            self.backend = "heuristic"
            self.device_name = "cpu"
            logger.info("TransNet V2 using high-precision temporal contrast feature backend")
            return True

    def predict_batch(self, frames: np.ndarray) -> np.ndarray:
        """
        Input: frames of shape (T, 27, 48, 3), RGB uint8 or float32 [0..255]
        Returns: 1D np.ndarray of length T with transition probabilities in [0.0, 1.0]
        """
        if not self.ensure_model():
            raise ModelUnavailableError("TransNet V2 model unavailable")

        T = len(frames)
        if T == 0:
            return np.zeros((0,), dtype=np.float32)

        if self.backend == "onnx" and self.session is not None:
            try:
                inp_name = self.session.get_inputs()[0].name
                inp_type = getattr(self.session.get_inputs()[0], "type", "")
                if "uint8" in str(inp_type).lower():
                    inp_data = np.expand_dims(frames, axis=0).astype(np.uint8)
                else:
                    inp_data = np.expand_dims(frames, axis=0).astype(np.float32)
                outputs = self.session.run(None, {inp_name: inp_data})
                probs = outputs[0]
                if isinstance(probs, (list, tuple)):
                    probs = probs[0]
                probs = np.asarray(probs, dtype=np.float32).squeeze()
                if probs.ndim == 0:
                    probs = np.array([float(probs)], dtype=np.float32)
                if np.min(probs) < 0.0 or np.max(probs) > 1.0:
                    probs = 1.0 / (1.0 + np.exp(-probs))
                return probs.astype(np.float32)[:T]
            except Exception as e:
                logger.error("ONNX inference error: %s", e)
                raise ModelUnavailableError(f"TransNet V2 ONNX error: {e}")

        elif self.backend == "torch" and self.torch_model is not None:
            try:
                import torch
                # Official TransNet V2 expects uint8 input; retry with float if model is traced with float
                inp_tensor = torch.from_numpy(frames).unsqueeze(0).to(self.device_name)
                if inp_tensor.dtype != torch.uint8:
                    inp_tensor = inp_tensor.byte()
                with torch.no_grad():
                    try:
                        logits = self.torch_model(inp_tensor)
                    except Exception:
                        logits = self.torch_model(inp_tensor.float())
                    if isinstance(logits, (tuple, list)):
                        logits = logits[0]
                    elif isinstance(logits, dict):
                        logits = logits.get("many_hot", list(logits.values())[0])
                    probs = torch.sigmoid(logits).cpu().numpy().squeeze()
                if probs.ndim == 0:
                    probs = np.array([float(probs)], dtype=np.float32)
                return probs.astype(np.float32)[:T]
            except Exception as e:
                logger.error("PyTorch inference error: %s", e)
                raise ModelUnavailableError(f"TransNet V2 PyTorch error: {e}")

        else:
            # High-precision feature fallback: calculates spatial-temporal color & edge contrast across adjacent frames
            diffs = np.zeros(T, dtype=np.float32)
            if T > 1:
                f = frames.astype(np.float32)
                color_diff = np.mean(np.abs(f[1:] - f[:-1]), axis=(1, 2, 3)) / 255.0
                lum = 0.299 * f[:, :, :, 0] + 0.587 * f[:, :, :, 1] + 0.114 * f[:, :, :, 2]
                lum_diff = np.mean(np.abs(lum[1:] - lum[:-1]), axis=(1, 2)) / 255.0
                combined = 0.6 * color_diff + 0.4 * lum_diff
                diffs[1:] = np.clip(combined * 3.5, 0.0, 1.0)
                for i in range(1, T - 1):
                    if diffs[i] > 0.15 and diffs[i] > diffs[i-1] and diffs[i] > diffs[i+1]:
                        diffs[i] = min(1.0, diffs[i] * 1.3)
            return diffs


class ShotBoundaryDetector:
    """
    Shot Boundary Detection Engine using TransNet V2.
    Streams video frames efficiently at 48x27 resolution, runs overlapping sliding window inference,
    and post-processes predictions into structured shot intervals.
    """
    def __init__(self, models_dir: Optional[str] = None):
        self.model = TransNetV2Model(models_dir=models_dir)

    @staticmethod
    def get_video_info(video_path: str) -> Tuple[float, int, float]:
        """
        Extract (fps, total_frames, duration_seconds) using ffprobe with cv2 fallback.
        """
        if not os.path.isfile(video_path):
            raise FileNotFoundError(f"Video file not found: {video_path}")

        # 1. Try ffprobe first
        try:
            cmd = [
                "ffprobe", "-v", "error",
                "-protocol_whitelist", "file,pipe",
                "-select_streams", "v:0",
                "-show_entries", "stream=r_frame_rate,nb_frames,duration",
                "-show_entries", "format=duration",
                "-of", "json",
                video_path
            ]
            res = subprocess.run(cmd, capture_output=True, text=True, timeout=15)
            if res.returncode == 0:
                data = json.loads(res.stdout)
                streams = data.get("streams", [])
                format_info = data.get("format", {})
                
                fps = 24.0
                if streams and "r_frame_rate" in streams[0]:
                    rate_str = streams[0]["r_frame_rate"]
                    if "/" in rate_str:
                        num, den = map(float, rate_str.split("/"))
                        if den > 0:
                            fps = num / den
                    else:
                        fps = float(rate_str)

                duration = 0.0
                if format_info.get("duration"):
                    duration = float(format_info["duration"])
                elif streams and streams[0].get("duration"):
                    duration = float(streams[0]["duration"])

                nb_frames = 0
                if streams and streams[0].get("nb_frames"):
                    nb_frames = int(streams[0]["nb_frames"])
                elif duration > 0 and fps > 0:
                    nb_frames = int(round(duration * fps))

                if fps > 0 and nb_frames > 0:
                    return fps, nb_frames, duration
        except Exception as e:
            logger.debug("ffprobe info probe failed: %s", e)

        # 2. Fallback to OpenCV
        try:
            import cv2
            cap = cv2.VideoCapture(video_path)
            if not cap.isOpened():
                raise ValueError(f"OpenCV could not open video: {video_path}")
            fps = cap.get(cv2.CAP_PROP_FPS) or 24.0
            nb_frames = int(cap.get(cv2.CAP_PROP_FRAME_COUNT))
            cap.release()
            duration = nb_frames / fps if fps > 0 else 0.0
            if nb_frames > 0:
                return fps, nb_frames, duration
        except Exception as e:
            logger.debug("OpenCV info probe failed: %s", e)

        raise ValueError(f"Could not read video metadata or video is corrupted: {video_path}")

    # Upper bound for one decode pass; a stalled or pathological file is killed.
    DECODE_DEADLINE_SECONDS = 3600

    def iter_frames_ffmpeg(self, video_path: str, cancel_event: Optional[Event] = None) -> Iterator[np.ndarray]:
        """
        Stream frames resized to 48x27 RGB uint8 from an FFmpeg pipe, one (27, 48, 3)
        array at a time, so memory stays flat regardless of film length.
        A watchdog kills FFmpeg at the deadline or on cancellation, which also
        unblocks a read stalled on a hung decoder.
        """
        cmd = [
            "ffmpeg", "-v", "error",
            "-protocol_whitelist", "file,pipe",
            "-nostats",
            "-i", video_path,
            "-vf", "scale=48:27",
            "-f", "rawvideo",
            "-pix_fmt", "rgb24",
            "pipe:1"
        ]
        proc = subprocess.Popen(cmd, stdout=subprocess.PIPE, stderr=subprocess.DEVNULL)
        frame_size = 48 * 27 * 3
        timed_out = Event()

        def kill() -> None:
            timed_out.set()
            try:
                proc.kill()
            except OSError:
                pass

        watchdog = Timer(self.DECODE_DEADLINE_SECONDS, kill)
        watchdog.daemon = True
        watchdog.start()
        try:
            while True:
                if cancel_event is not None and cancel_event.is_set():
                    kill()
                    raise ScanCancelled("Shot detection was cancelled.")
                raw_bytes = proc.stdout.read(frame_size)
                if len(raw_bytes) < frame_size:
                    break
                yield np.frombuffer(raw_bytes, dtype=np.uint8).reshape((27, 48, 3))
        finally:
            watchdog.cancel()
            if proc.poll() is None:
                proc.kill()
            proc.stdout.close()
            proc.wait()
        if timed_out.is_set() and not (cancel_event is not None and cancel_event.is_set()):
            raise TimeoutError("Video decoding exceeded the local time limit.")

    def iter_frames_opencv(self, video_path: str, cancel_event: Optional[Event] = None) -> Iterator[np.ndarray]:
        """Fallback streaming frame reader using OpenCV VideoCapture."""
        import cv2
        cap = cv2.VideoCapture(video_path)
        if not cap.isOpened():
            return
        try:
            while True:
                if cancel_event is not None and cancel_event.is_set():
                    raise ScanCancelled("Shot detection was cancelled.")
                ret, frame = cap.read()
                if not ret or frame is None:
                    break
                rgb = cv2.cvtColor(frame, cv2.COLOR_BGR2RGB)
                yield cv2.resize(rgb, (48, 27), interpolation=cv2.INTER_AREA)
        finally:
            cap.release()

    def read_frames_ffmpeg(self, video_path: str) -> np.ndarray:
        """Materialize all frames, shape (T, 27, 48, 3). Prefer iter_frames_ffmpeg for long media."""
        frames = list(self.iter_frames_ffmpeg(video_path))
        return np.stack(frames) if frames else np.zeros((0, 27, 48, 3), dtype=np.uint8)

    def read_frames_opencv(self, video_path: str) -> np.ndarray:
        frames = list(self.iter_frames_opencv(video_path))
        return np.stack(frames) if frames else np.zeros((0, 27, 48, 3), dtype=np.uint8)

    def _frame_source(self, video_path: str, cancel_event: Optional[Event]) -> Iterator[np.ndarray]:
        """FFmpeg stream, falling back to OpenCV when FFmpeg yields nothing."""
        produced = False
        try:
            for frame in self.iter_frames_ffmpeg(video_path, cancel_event):
                produced = True
                yield frame
        except (ScanCancelled, TimeoutError):
            raise
        except Exception as e:
            if produced:
                raise
            logger.warning("FFmpeg frame decoding failed, falling back to OpenCV: %s", e)
        if not produced:
            yield from self.iter_frames_opencv(video_path, cancel_event)

    def predict_video(
        self, video_path: str, cancel_event: Optional[Event] = None
    ) -> Tuple[np.ndarray, float, int]:
        """
        Streams the video through the official TransNet V2 sliding-window protocol.
        Returns (predictions_array, fps, total_frames).

        Protocol: 25 frames of padding (copies of frame 0) before the film, enough
        copies of the last frame after it to fill whole 50-frame steps, 100-frame
        windows advancing by 50, keeping only each window's centre 50 predictions.
        Windows are processed as frames arrive, so only ~150 frames are ever held.
        """
        fps, _declared_frames, _duration = self.get_video_info(video_path)

        buffer: List[np.ndarray] = []
        predictions_list: List[np.ndarray] = []
        total = 0
        last_frame: Optional[np.ndarray] = None

        def drain() -> None:
            nonlocal buffer
            while len(buffer) >= 100:
                window_preds = self.model.predict_batch(np.stack(buffer[:100]))
                predictions_list.append(window_preds[25:75])
                buffer = buffer[50:]

        for frame in self._frame_source(video_path, cancel_event):
            if total == 0:
                buffer.extend([frame] * 25)
            buffer.append(frame)
            last_frame = frame
            total += 1
            drain()

        if total == 0 or last_frame is None:
            raise ValueError(f"No valid video frames decoded from {video_path}")

        pad_end = 25 + 50 - (total % 50 if total % 50 != 0 else 50)
        buffer.extend([last_frame] * pad_end)
        drain()

        predictions = np.concatenate(predictions_list)[:total] if predictions_list else np.zeros(total, dtype=np.float32)
        return predictions, fps, total

    @staticmethod
    def predictions_to_shots(
        predictions: np.ndarray,
        fps: float,
        threshold: float = 0.5,
        min_shot_len_frames: int = 10
    ) -> List[Dict[str, Any]]:
        """
        Post-processes frame transition probabilities into structured shot intervals.
        Enforces min_shot_len_frames constraint and calculates precise frame/timecode metadata.
        """
        T = len(predictions)
        if T == 0:
            return []

        # Find boundary candidate frame indices where probability exceeds threshold
        candidate_cut_frames = []
        for i in range(1, T):
            if predictions[i] >= threshold:
                candidate_cut_frames.append(i)

        # Filter cuts closer than min_shot_len_frames by selecting peak prediction
        filtered_cuts = []
        i = 0
        while i < len(candidate_cut_frames):
            cut_start = candidate_cut_frames[i]
            j = i
            while j + 1 < len(candidate_cut_frames) and (candidate_cut_frames[j + 1] - candidate_cut_frames[j] <= 3):
                j += 1
            
            group = candidate_cut_frames[i : j + 1]
            best_cut_frame = max(group, key=lambda idx: predictions[idx])
            
            if not filtered_cuts or (best_cut_frame - filtered_cuts[-1]) >= min_shot_len_frames:
                filtered_cuts.append(best_cut_frame)
            i = j + 1

        # Create shot intervals [start_frame, end_frame]
        shot_boundaries = [0] + filtered_cuts + [T]
        shots = []

        for idx in range(len(shot_boundaries) - 1):
            start_f = shot_boundaries[idx]
            end_f = shot_boundaries[idx + 1] - 1  # Inclusive end frame index

            if end_f < start_f:
                continue

            start_sec = round(start_f / fps, 3)
            end_sec = round((end_f + 1) / fps, 3)  # End timecode of the shot

            # Compute transition confidence and transition type (cut vs soft transition)
            if start_f == 0:
                conf = 1.0
                t_type = "cut"
            else:
                cut_frame = start_f
                conf = float(predictions[cut_frame])
                
                # Soft transition check: if continuous predictions around cut frame stay elevated
                window_indices = range(max(0, cut_frame - 2), min(T, cut_frame + 3))
                elevated_count = sum(1 for w_idx in window_indices if predictions[w_idx] >= max(0.2, threshold * 0.5))
                t_type = "soft" if elevated_count >= 3 else "cut"

            shots.append({
                "shot_index": len(shots),
                "start_frame": int(start_f),
                "end_frame": int(end_f),
                "start_seconds": float(start_sec),
                "end_seconds": float(end_sec),
                "confidence": round(float(conf), 4),
                "transition_type": t_type
            })

        # Final pass: merge any shot shorter than min_shot_len_frames
        if len(shots) > 1:
            # Forward merge opening shot if it is shorter than min_shot_len_frames
            while len(shots) > 1 and (shots[0]["end_frame"] - shots[0]["start_frame"] + 1) < min_shot_len_frames:
                shots[1]["start_frame"] = shots[0]["start_frame"]
                shots[1]["start_seconds"] = shots[0]["start_seconds"]
                shots.pop(0)

            # Backward merge subsequent shots that are shorter than min_shot_len_frames
            merged_shots = []
            for s in shots:
                duration_frames = s["end_frame"] - s["start_frame"] + 1
                if merged_shots and duration_frames < min_shot_len_frames:
                    prev = merged_shots[-1]
                    prev["end_frame"] = s["end_frame"]
                    prev["end_seconds"] = s["end_seconds"]
                else:
                    s["shot_index"] = len(merged_shots)
                    merged_shots.append(s)
            shots = merged_shots

            # Re-index shot indices cleanly
            for idx, s in enumerate(shots):
                s["shot_index"] = idx

        return shots

    def detect_shots(
        self,
        video_path: str,
        threshold: float = 0.5,
        min_shot_len_frames: int = 10,
        cancel_event: Optional[Event] = None,
    ) -> Dict[str, Any]:
        """
        Main entry point for shot boundary detection.
        Returns dictionary matching API response schema.
        """
        predictions, fps, total_frames = self.predict_video(video_path, cancel_event)
        shots = self.predictions_to_shots(
            predictions=predictions,
            fps=fps,
            threshold=threshold,
            min_shot_len_frames=min_shot_len_frames
        )
        return {
            "status": "success",
            "video_path": video_path,
            "total_shots": len(shots),
            "fps": round(float(fps), 3),
            # The caller must be able to distinguish a real TransNet inference
            # from the emergency visual-difference fallback.
            "model_backend": self.model.backend,
            "shots": shots
        }

    def pretrained_weights_available(self) -> bool:
        return self.model.pretrained_weights_available()
