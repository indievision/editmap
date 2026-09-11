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

    def extract_audio_to_wav(self, input_path: str, output_wav_path: str) -> None:
        """Extracts audio to 44.1kHz stereo 16-bit PCM WAV using ffmpeg."""
        cmd = [
            "ffmpeg",
            "-y",
            "-i", input_path,
            "-vn",
            "-acodec", "pcm_s16le",
            "-ar", "44100",
            "-ac", "2",
            output_wav_path
        ]
        logger.info("Extracting audio with ffmpeg: %s -> %s", input_path, output_wav_path)
        result = subprocess.run(cmd, capture_output=True, text=True)
        if result.returncode != 0:
            raise RuntimeError(f"FFmpeg audio extraction failed: {result.stderr}")

    def separate(
        self,
        input_media_path: str,
        bin_count: int = 1400,
        output_dir: Optional[str] = None,
        segment: float = 7.8,
        overlap: float = 0.1
    ) -> Dict[str, Any]:
        """
        Separates a video or audio file into Dialogue, Music, and Effects (DME).
        Returns normalized waveform bins and metadata.
        """
        self.ensure_model()

        with tempfile.TemporaryDirectory() as tmpdir:
            temp_wav = os.path.join(tmpdir, "extracted.wav")
            self.extract_audio_to_wav(input_media_path, temp_wav)

            audio_data, sr = sf.read(temp_wav, dtype="float32")
            if sr != self.model.samplerate:
                raise RuntimeError(f"Audio sample rate {sr} does not match model sample rate {self.model.samplerate}")

            # Audio shape expected: (channels, samples)
            if audio_data.ndim == 1:
                tensor = torch.tensor(np.stack([audio_data, audio_data]), dtype=torch.float32)
            else:
                tensor = torch.tensor(audio_data.T, dtype=torch.float32)

            duration = tensor.shape[1] / float(sr)
            logger.info("Processing %0.2f seconds of audio with Demucs...", duration)

            with torch.no_grad():
                sources = apply_model(
                    self.model,
                    tensor[None],
                    device=self.device,
                    segment=segment,
                    overlap=overlap,
                    split=True
                )[0]

            source_names = self.model.sources
            stems: Dict[str, np.ndarray] = {}
            for idx, name in enumerate(source_names):
                stem_tensor = sources[idx].cpu().numpy()
                stems[name] = stem_tensor

            dme_mapping = {
                "dialogue": stems.get("speech"),
                "music": stems.get("music"),
                "effects": stems.get("sfx")
            }

            results: Dict[str, Any] = {
                "duration": duration,
                "binCount": bin_count,
                "sampleRate": sr
            }

            if output_dir:
                os.makedirs(output_dir, exist_ok=True)
                for stem_name, stem_audio in dme_mapping.items():
                    if stem_audio is not None:
                        out_path = os.path.join(output_dir, f"{stem_name}.wav")
                        sf.write(out_path, stem_audio.T, sr)
                        logger.info("Saved stem WAV to %s", out_path)

            for stem_name, stem_audio in dme_mapping.items():
                if stem_audio is not None:
                    mono = np.mean(stem_audio, axis=0)
                    results[stem_name] = compute_waveform_bins(mono, bin_count=bin_count)
                else:
                    results[stem_name] = [0.0] * bin_count

            return results
