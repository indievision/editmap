"""EBU R128 loudness and dynamic contrast analysis using FFmpeg's ebur128 filter."""
import json
import logging
import re
import subprocess
import time
from typing import Any, Dict, List, Optional

logger = logging.getLogger("editmap.loudness_engine")

FRAME_RE = re.compile(
    r"t:\s*([\d\.]+)\s+TARGET:\s*([-\d\.]+)\s+LUFS\s+"
    r"M:\s*([-\d\.]+|-\w+|\w+)\s+S:\s*([-\d\.]+|-\w+|\w+)\s+"
    r"I:\s*([-\d\.]+|-\w+|\w+)\s+LUFS\s+LRA:\s*([-\d\.]+)\s+LU\s+"
    r"FTPK:\s*([-\d\.]+|-\w+|\w+)\s+dBFS\s+TPK:\s*([-\d\.]+|-\w+|\w+)\s+dBFS"
)

SUMMARY_I_RE = re.compile(r"Integrated loudness:\s+I:\s+([-\d\.]+|-\w+)\s+LUFS")
SUMMARY_THRESH_RE = re.compile(r"Threshold:\s+([-\d\.]+|-\w+)\s+LUFS")
SUMMARY_LRA_RE = re.compile(r"Loudness range:\s+LRA:\s+([-\d\.]+|-\w+)\s+LU")
SUMMARY_LRA_LOW_RE = re.compile(r"LRA low:\s+([-\d\.]+|-\w+)\s+LUFS")
SUMMARY_LRA_HIGH_RE = re.compile(r"LRA high:\s+([-\d\.]+|-\w+)\s+LUFS")
SUMMARY_TRUE_PEAK_RE = re.compile(r"True peak:\s+Peak:\s+([-\d\.]+|-\w+)\s+dBFS")


def _parse_val(val: str, default: float = -70.0) -> float:
    low = val.lower()
    if "-inf" in low or "-infinity" in low:
        return -70.0
    if "inf" in low or "infinity" in low:
        return 0.0
    try:
        return float(val)
    except (ValueError, TypeError):
        return default


class LoudnessEngine:
    """Executes FFmpeg with ebur128=peak=true:framelog=verbose and parses metrics."""

    @staticmethod
    def duration(path: str) -> float:
        probe = subprocess.run(
            ["ffprobe", "-v", "error", "-show_entries", "format=duration", "-of", "json", path],
            capture_output=True,
            text=True,
            timeout=30,
        )
        val = float(json.loads(probe.stdout).get("format", {}).get("duration", 0))
        if not 0 < val <= 14_400:
            raise ValueError("Loudness analysis supports media up to four hours with a known duration.")
        return val

    def scan(
        self,
        path: str,
        bin_count: int = 1400,
        cancel_event=None,
        on_progress=None,
    ) -> Dict[str, Any]:
        duration = self.duration(path)
        if cancel_event and cancel_event.is_set():
            raise RuntimeError("Loudness scan cancelled.")

        cmd = [
            "ffmpeg",
            "-nostdin",
            "-loglevel", "verbose",
            "-y",
            "-i", path,
            "-filter_complex", "ebur128=peak=true:framelog=verbose",
            "-f", "null",
            "-",
        ]

        started = time.monotonic()
        raw_samples: List[Dict[str, float]] = []
        stderr_lines: List[str] = []

        process = subprocess.Popen(
            cmd,
            stdout=subprocess.DEVNULL,
            stderr=subprocess.PIPE,
            text=True,
            bufsize=1,
            universal_newlines=True,
        )

        try:
            last_progress_time = started
            while True:
                if cancel_event and cancel_event.is_set():
                    raise RuntimeError("Loudness scan cancelled.")

                line = process.stderr.readline()
                if not line:
                    if process.poll() is not None:
                        break
                    continue

                stderr_lines.append(line)
                match = FRAME_RE.search(line)
                if match:
                    t = float(match.group(1))
                    m = _parse_val(match.group(3))
                    s = _parse_val(match.group(4))
                    ftpk = _parse_val(match.group(7))
                    tpk = _parse_val(match.group(8))
                    raw_samples.append({"t": t, "m": m, "s": s, "ftpk": ftpk, "tpk": tpk})

                    now = time.monotonic()
                    if on_progress and (now - last_progress_time >= 0.5):
                        last_progress_time = now
                        elapsed = now - started
                        progress = min(0.999, max(0.01, t / duration))
                        eta = (elapsed / progress) * (1.0 - progress) if progress > 0.05 else None
                        on_progress(
                            "measuring",
                            progress,
                            f"Measuring EBU R128 loudness ({progress * 100:.0f}%)…",
                            elapsed,
                            eta,
                        )

            ret = process.wait(timeout=20)
            if ret != 0:
                recent_err = "".join(stderr_lines[-30:])
                raise RuntimeError(f"FFmpeg loudness analysis failed (exit code {ret}): {recent_err}")

        finally:
            if process.stderr:
                try:
                    process.stderr.close()
                except Exception:
                    pass
            if process.poll() is None:
                process.kill()
            process.wait()

        full_stderr = "".join(stderr_lines)

        # Parse final summary
        match_i = SUMMARY_I_RE.search(full_stderr)
        match_lra = SUMMARY_LRA_RE.search(full_stderr)
        match_low = SUMMARY_LRA_LOW_RE.search(full_stderr)
        match_high = SUMMARY_LRA_HIGH_RE.search(full_stderr)
        match_tp = SUMMARY_TRUE_PEAK_RE.search(full_stderr)
        match_thresh = SUMMARY_THRESH_RE.search(full_stderr)

        integrated = _parse_val(match_i.group(1), -70.0) if match_i else -23.0
        loudness_range = _parse_val(match_lra.group(1), 0.0) if match_lra else 0.0
        lra_low = _parse_val(match_low.group(1), -70.0) if match_low else -70.0
        lra_high = _parse_val(match_high.group(1), -70.0) if match_high else -70.0
        true_peak = _parse_val(match_tp.group(1), -70.0) if match_tp else -70.0
        threshold = _parse_val(match_thresh.group(1), -70.0) if match_thresh else -70.0

        max_m = max((sample["m"] for sample in raw_samples), default=-70.0)
        max_s = max((sample["s"] for sample in raw_samples), default=-70.0)

        # Resample into standard bin_count
        bins_m = [-70.0] * bin_count
        bins_s = [-70.0] * bin_count
        bins_tp = [-70.0] * bin_count

        if raw_samples and duration > 0:
            bin_duration = duration / bin_count
            sample_idx = 0
            num_samples = len(raw_samples)

            for b in range(bin_count):
                bin_end = (b + 1) * bin_duration

                bucket_m: List[float] = []
                bucket_s: List[float] = []
                bucket_tp: List[float] = []

                while sample_idx < num_samples and raw_samples[sample_idx]["t"] <= bin_end:
                    s_data = raw_samples[sample_idx]
                    bucket_m.append(s_data["m"])
                    bucket_s.append(s_data["s"])
                    bucket_tp.append(s_data["ftpk"])
                    sample_idx += 1

                if bucket_m:
                    bins_m[b] = round(sum(bucket_m) / len(bucket_m), 2)
                    bins_s[b] = round(sum(bucket_s) / len(bucket_s), 2)
                    bins_tp[b] = round(max(bucket_tp), 2)
                elif b > 0:
                    bins_m[b] = bins_m[b - 1]
                    bins_s[b] = bins_s[b - 1]
                    bins_tp[b] = bins_tp[b - 1]

        # Detect quiet-to-loud and loud-to-quiet transitions
        transitions = self._detect_transitions(raw_samples, min_delta=6.0)

        processing_seconds = time.monotonic() - started

        return {
            "integratedLoudness": round(integrated, 2),
            "loudnessRange": round(loudness_range, 2),
            "lraLow": round(lra_low, 2),
            "lraHigh": round(lra_high, 2),
            "truePeak": round(true_peak, 2),
            "maxMomentary": round(max_m, 2),
            "maxShortTerm": round(max_s, 2),
            "threshold": round(threshold, 2),
            "momentary": bins_m,
            "shortTerm": bins_s,
            "truePeaks": bins_tp,
            "transitions": transitions,
            "binCount": bin_count,
            "duration": round(duration, 3),
            "model": "ffmpeg-ebur128",
            "modelVersion": "EBU-R128-BS.1770-4",
            "processingSeconds": round(processing_seconds, 2),
        }

    @staticmethod
    def _detect_transitions(
        samples: List[Dict[str, float]],
        min_delta: float = 6.0,
        window_seconds: float = 0.8,
    ) -> List[Dict[str, Any]]:
        """Finds prominent quiet-to-loud jumps and loud-to-quiet drops."""
        if not samples or len(samples) < 2:
            return []

        candidates: List[Dict[str, Any]] = []
        n = len(samples)
        i = 0

        while i < n:
            current = samples[i]
            j = i + 1
            while j < n and (samples[j]["t"] - current["t"]) <= window_seconds:
                diff = samples[j]["m"] - current["m"]
                if abs(diff) >= min_delta:
                    trans_type = "quiet-to-loud" if diff > 0 else "loud-to-quiet"
                    candidates.append({
                        "time": round(samples[j]["t"], 2),
                        "duration": round(samples[j]["t"] - current["t"], 2),
                        "fromLufs": round(current["m"], 1),
                        "toLufs": round(samples[j]["m"], 1),
                        "deltaLufs": round(diff, 1),
                        "type": trans_type,
                    })
                    i = j
                    break
                j += 1
            i += 1

        deduped: List[Dict[str, Any]] = []
        for cand in candidates:
            if not deduped:
                deduped.append(cand)
                continue
            prev = deduped[-1]
            if cand["time"] - prev["time"] < 1.5:
                if abs(cand["deltaLufs"]) > abs(prev["deltaLufs"]):
                    deduped[-1] = cand
            else:
                deduped.append(cand)

        return deduped[:50]
