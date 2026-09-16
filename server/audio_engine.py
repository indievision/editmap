import os
import subprocess
import tempfile
import logging
from typing import Dict, List, Optional, Any
import numpy as np
import soundfile as sf
import torch

from demucs.states import load_model
from demucs.apply import apply_model

logger = logging.getLogger("editmap.audio_engine")

MODEL_FILENAME = "97d170e1-dbb4db15.th"
MODEL_DOWNLOAD_URL = (
    "https://github.com/ZFTurbo/MVSEP-CDX23-Cinematic-Sound-Demixing/releases/download/v.1.0.0/"
    + MODEL_FILENAME
)


def compute_waveform_bins(samples: np.ndarray, bin_count: int = 1400) -> List[float]:
    """
    Computes peak amplitude bins matching EDITMAP's client-side waveform resolution.
    Returns a list of floats clamped to [0.0, 1.0].
    """
    if len(samples) == 0 or bin_count < 1:
        return []
    
    bins: List[float] = []
    n = len(samples)
    for b in range(bin_count):
        start = int(b * n / bin_count)
        end = max(start + 1, int((b + 1) * n / bin_count))
        peak = float(np.max(np.abs(samples[start:end])))
        bins.append(min(1.0, round(peak, 4)))
    return bins


class DmeSeparator:
    def __init__(self, models_dir: Optional[str] = None):
        if models_dir is None:
            models_dir = os.path.join(os.path.dirname(os.path.abspath(__file__)), "models")
        self.models_dir = models_dir
        self.model_path = os.path.join(self.models_dir, MODEL_FILENAME)
        self.model = None
        # On Apple Silicon, Demucs HT4 uses standard CPU threads because
        # MPS F.conv1d has a 65536 channel limitation.
        self.device = "cpu"
        num_cores = os.cpu_count() or 8
        torch.set_num_threads(max(4, min(12, num_cores)))

    def ensure_model(self):
        """Loads model into memory, downloading weights if necessary."""
        if self.model is not None:
            return

        if not os.path.isfile(self.model_path):
            os.makedirs(self.models_dir, exist_ok=True)
            logger.info("Downloading DnR Demucs model checkpoint to %s...", self.model_path)
            torch.hub.download_url_to_file(MODEL_DOWNLOAD_URL, self.model_path)

        logger.info("Loading DnR Demucs model from %s on %s...", self.model_path, self.device)
        self.model = load_model(self.model_path)
        self.model.to(self.device)
        self.model.eval()
        logger.info("DnR Demucs model ready. Sources: %s", self.model.sources)

    def extract_audio_to_wav(self, input_path: str, output_wav_path: str, cancel_event=None) -> None:
        """Extracts audio to 44.1kHz stereo 16-bit PCM WAV using ffmpeg."""
        import json
        probe = subprocess.run(["ffprobe", "-v", "error", "-show_entries", "format=duration", "-of", "json", input_path], capture_output=True, text=True, timeout=30)
        duration = float(json.loads(probe.stdout).get("format", {}).get("duration", 0))
        if not 0 < duration <= 14400:
            raise ValueError("DME supports media up to four hours with a known duration.")
        cmd = [
            "ffmpeg", "-nostdin",
            "-y",
            "-i", input_path,
            "-vn",
            "-acodec", "pcm_s16le",
            "-ar", "44100",
            "-ac", "2",
            output_wav_path
        ]
        logger.info("Extracting audio with ffmpeg: %s -> %s", input_path, output_wav_path)
        import time
        with tempfile.TemporaryFile() as errors:
            process = subprocess.Popen(cmd, stdout=subprocess.DEVNULL, stderr=errors)
            deadline = time.monotonic() + 600
            try:
                while process.poll() is None:
                    if (cancel_event and cancel_event.is_set()) or time.monotonic() > deadline:
                        raise RuntimeError("Audio extraction cancelled or timed out.")
                    time.sleep(.1)
                if process.returncode:
                    errors.seek(0)
                    raise RuntimeError(f"FFmpeg audio extraction failed: {errors.read(4096).decode(errors='replace')}")
            finally:
                if process.poll() is None:
                    process.kill()
                process.wait()

    def separate(
        self,
        input_media_path: str,
        bin_count: int = 1400,
        output_dir: Optional[str] = None,
        segment: float = 7.8,
        overlap: float = 0.1,
        cancel_event=None,
        on_progress=None,
    ) -> Dict[str, Any]:
        """
        Separates a video or audio file into Dialogue, Music, and Effects (DME).
        Returns normalized waveform bins and metadata.
        """
        def check_cancel():
            if cancel_event and cancel_event.is_set():
                raise RuntimeError("DME separation cancelled.")
        check_cancel()
        self.ensure_model()
        check_cancel()
        with tempfile.TemporaryDirectory() as tmpdir:
            temp_wav = os.path.join(tmpdir, "extracted.wav")
            self.extract_audio_to_wav(input_media_path, temp_wav, cancel_event)
            with sf.SoundFile(temp_wav) as audio:
                sr, total = audio.samplerate, len(audio)
                if sr != self.model.samplerate or total < 1:
                    raise RuntimeError("Invalid audio or model sample rate mismatch.")
                duration = total / sr
                bins = {name: np.zeros(bin_count, dtype=np.float32) for name in ("dialogue", "music", "effects")}
                source_map = {"dialogue": "speech", "music": "music", "effects": "sfx"}
                missing = set(source_map.values()) - set(self.model.sources)
                if missing:
                    raise RuntimeError(f"DME model is missing sources: {sorted(missing)}")
                # Thirty-second interiors plus context bound RAM independently of film length.
                block_size, context = 30 * sr, sr
                outputs = {}
                try:
                    if output_dir:
                        os.makedirs(output_dir, exist_ok=True)
                        outputs = {name: sf.SoundFile(os.path.join(output_dir, name + ".wav"), mode="w", samplerate=sr, channels=2) for name in bins}
                    for start in range(0, total, block_size):
                        check_cancel()
                        end = min(total, start + block_size)
                        read_start, read_end = max(0, start-context), min(total, end+context)
                        audio.seek(read_start)
                        data = audio.read(read_end-read_start, dtype="float32", always_2d=True)
                        tensor = torch.from_numpy(data.T.copy())
                        if tensor.shape[0] == 1:
                            tensor = tensor.repeat(2, 1)
                        with torch.no_grad():
                            sources = apply_model(self.model, tensor[None], device=self.device, segment=segment, overlap=overlap, split=True, shifts=0)[0]
                        check_cancel()
                        for name, source in source_map.items():
                            stem = sources[self.model.sources.index(source), :, start-read_start:end-read_start].cpu().numpy()
                            if name in outputs:
                                outputs[name].write(stem.T)
                            # Stereo peak avoids cancellation from opposite-phase channels.
                            peaks = np.max(np.abs(stem), axis=0)
                            first_bin = min(bin_count-1, start * bin_count // total)
                            last_bin = min(bin_count-1, (end-1) * bin_count // total)
                            for b in range(first_bin, last_bin+1):
                                lo = max(start, int(b * total / bin_count))
                                hi = min(end, max(lo+1, int((b+1) * total / bin_count)))
                                if hi > lo:
                                    bins[name][b] = max(bins[name][b], float(np.max(peaks[lo-start:hi-start])))
                        del sources, tensor, data
                        if on_progress:
                            on_progress(end / total)
                finally:
                    for output in outputs.values(): output.close()
                return {"duration": duration, "binCount": bin_count, "sampleRate": sr, **{name: np.round(np.clip(values, 0, 1), 4).tolist() for name, values in bins.items()}}
