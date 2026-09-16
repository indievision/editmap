import io
import os
import subprocess
import tempfile
import unittest
from types import SimpleNamespace
from fastapi.testclient import TestClient

from main import app
from loudness_engine import LoudnessEngine
from loudness_jobs import LoudnessJobs
from local_access import SESSION_TOKEN


class TestLoudnessEngine(unittest.TestCase):
    def setUp(self):
        self.engine = LoudnessEngine()
        self.client = TestClient(app)
        self.headers = {
            "Origin": "http://127.0.0.1:5173",
            "X-Editmap-Token": SESSION_TOKEN,
        }

    def test_loudness_scan_on_synthetic_audio(self):
        with tempfile.TemporaryDirectory() as tmpdir:
            test_wav = os.path.join(tmpdir, "test.wav")
            # Generate a 2-second sine tone at 1000Hz (-20 dBFS volume)
            subprocess.run(
                [
                    "ffmpeg", "-nostdin", "-y",
                    "-f", "lavfi", "-i", "sine=frequency=1000:duration=2",
                    "-c:a", "pcm_s16le",
                    test_wav,
                ],
                stdout=subprocess.DEVNULL,
                stderr=subprocess.DEVNULL,
                check=True,
            )

            result = self.engine.scan(test_wav, bin_count=100)

            self.assertEqual(result["model"], "ffmpeg-ebur128")
            self.assertEqual(result["binCount"], 100)
            self.assertAlmostEqual(result["duration"], 2.0, places=1)
            self.assertIsInstance(result["integratedLoudness"], float)
            self.assertIsInstance(result["loudnessRange"], float)
            self.assertIsInstance(result["truePeak"], float)
            self.assertIsInstance(result["momentary"], list)
            self.assertEqual(len(result["momentary"]), 100)
            self.assertEqual(len(result["shortTerm"]), 100)
            self.assertEqual(len(result["truePeaks"]), 100)
            self.assertIsInstance(result["transitions"], list)

    def test_loudness_jobs_lifecycle_and_cancellation(self):
        class SlowEngine:
            def scan(self, path, bin_count=1400, cancel_event=None, on_progress=None):
                import time
                for _ in range(50):
                    if cancel_event and cancel_event.is_set():
                        raise RuntimeError("Loudness scan cancelled.")
                    time.sleep(0.02)
                return {"duration": 10.0}

        jobs = LoudnessJobs(SlowEngine())
        started = jobs.start(io.BytesIO(b"dummy audio"), "loud-job-1")
        self.assertEqual(started["jobId"], "loud-job-1")

        # Conflict on concurrent start
        with self.assertRaises(Exception):
            jobs.start(io.BytesIO(b"audio 2"), "loud-job-2")

        # Cancel
        cancelled = jobs.cancel("loud-job-1")
        self.assertEqual(cancelled["status"], "cancelling")

        import time
        for _ in range(20):
            status = jobs.status("loud-job-1")
            if status["status"] == "cancelled":
                break
            time.sleep(0.05)

        self.assertEqual(jobs.status("loud-job-1")["status"], "cancelled")

    def test_loudness_api_endpoints(self):
        # Health includes loudness
        res = self.client.get("/health")
        self.assertEqual(res.status_code, 200)
        self.assertIn("loudness", res.json()["engines"])
        self.assertEqual(res.json()["engines"]["loudness"]["status"], "ready")

        # Missing token rejected
        res = self.client.post("/api/scan-loudness", files={"file": ("test.wav", b"riff")})
        self.assertEqual(res.status_code, 401)


if __name__ == "__main__":
    unittest.main()
