import io
import threading
import time
import unittest
from unittest.mock import patch
import numpy as np
from PIL import Image
from fastapi.testclient import TestClient
import main
from cv_engine import CharacterRecognizer, CinemaShotScaleClassifier, ShotClassifier, ModelUnavailableError, encode_image_to_base64
from dme_jobs import DmeJobs
from speech_jobs import SpeechJobs

class ApiTests(unittest.TestCase):
    def setUp(self):
        self.client = TestClient(main.app)
        self.headers = {"X-Editmap-Token": main.SESSION_TOKEN, "Origin": "http://127.0.0.1:5179"}
        self.frame = encode_image_to_base64(Image.new("RGB", (32, 32), (50, 60, 70)))

    def test_local_access_and_cors(self):
        self.assertEqual(self.client.get("/api/session", headers={"Origin": "https://untrusted.example"}).status_code, 403)
        self.assertEqual(self.client.get("/api/session", headers={"Host": "untrusted.example"}).status_code, 403)
        response = self.client.get("/api/dme-status", headers={"Origin": "http://127.0.0.1:5179"})
        self.assertEqual(response.status_code, 401)
        self.assertEqual(response.headers["access-control-allow-origin"], "http://127.0.0.1:5179")
        self.assertEqual(self.client.get("/api/dme-status", headers=self.headers).status_code, 200)

    def test_missing_model_is_not_empty_success(self):
        with patch.object(main.shot_classifier, "analyze_frames", side_effect=ModelUnavailableError("offline")):
            response = self.client.post("/api/analyze-shot", headers=self.headers, json={"image": self.frame})
        self.assertEqual(response.status_code, 503)
        self.assertEqual(response.json()["code"], "model_unavailable")
        classifier = ShotClassifier()
        with patch.object(classifier.framing_classifier, "classify_frames", side_effect=ModelUnavailableError("offline")):
            with self.assertRaises(ModelUnavailableError): classifier.analyze(Image.new("RGB", (32, 32)))
        # YOLO enriches people/content evidence; it must not erase a valid
        # CinemaCLIP framing result when that secondary detector is offline.
        with patch.object(classifier.framing_classifier, "classify_frames", return_value=("Medium", False, .9)), patch.object(classifier, "_get_model", side_effect=RuntimeError("offline")):
            self.assertEqual(classifier.analyze(Image.new("RGB", (32, 32)))["shotSize"], "Medium")
        recognizer = CharacterRecognizer(); recognizer._engine = "fallback"; recognizer._engine_type = "fallback"
        with self.assertRaises(ModelUnavailableError): recognizer.analyze(Image.new("RGB", (32, 32)), [])

    def test_cinemaclip_framing_maps_and_aggregates_three_samples(self):
        class Prediction:
            def __init__(self, label, confidence):
                self.label = [label]
                self.confidence = [confidence]

        class Model:
            def __init__(self, predictions):
                self.predictions = iter(predictions)
            def predict_image(self, _image):
                return {"classifier_preds": {"shot.framing": next(self.predictions)}}

        classifier = CinemaShotScaleClassifier()
        classifier._model = Model([
            Prediction("shot.framing.medium", .82),
            Prediction("shot.framing.medium-closeup", .76),
            Prediction("shot.framing.closeup", .91),
        ])
        size, uncertain, confidence = classifier.classify_frames([Image.new("RGB", (20, 20))] * 3)
        self.assertEqual(size, "Medium")
        self.assertFalse(uncertain)
        self.assertAlmostEqual(confidence, 1.58 / 3)

    def test_invalid_cluster_requests_and_paths(self):
        face = {"shotId": "s1", "time": 1, "embedding": [1, 0], "crop": "a", "score": 1, "area": 100}
        self.assertEqual(self.client.post("/api/cluster-faces", headers=self.headers, json={"faces": [face]}).status_code, 422)
        self.assertEqual(self.client.post("/api/cluster-faces", headers=self.headers, json={"faces": [], "similarityThreshold": 2}).status_code, 422)
        self.assertEqual(self.client.post("/api/separate-dme", headers=self.headers, data={"filepath": "/etc/passwd"}).status_code, 422)

    def test_reordered_clusters_preserve_existing_identity(self):
        recognizer = CharacterRecognizer()
        existing = [{"id": "anna", "name": "Anna", "references": [{"id": "ref-a", "image": "a"}]}, {"id": "ben", "name": "Ben", "references": [{"id": "ref-b", "image": "b"}]}]
        a = {"shotId": "s1", "time": 1, "embedding": [1., 0.], "crop": "a", "score": 1, "area": 100}
        b = {**a, "shotId": "s2", "embedding": [0., 1.], "crop": "b"}
        with patch.object(recognizer, "_get_reference_embeddings", side_effect=lambda id, image: [np.array([1.,0.] if image == "a" else [0.,1.])]):
            for faces in ([a,b], [b,a]):
                result = recognizer.cluster_faces(faces, existing_cast=existing)
                self.assertEqual({c["avatar"]: (c["id"], c["name"]) for c in result["characters"]}, {"a": ("anna", "Anna"), "b": ("ben", "Ben")})

    def test_arcface_auto_discovery_keeps_pose_variations_in_one_character(self):
        recognizer = CharacterRecognizer()
        frontal = np.zeros(512, dtype=float); frontal[0] = 1.0
        # A deliberately difficult profile/down-facing view of the same actor:
        # it is below the previous fixed .50 cutoff but above the ArcFace default.
        profile = np.zeros(512, dtype=float); profile[0] = .42; profile[1] = np.sqrt(1 - .42 ** 2)
        faces = [
            {"shotId": "s1", "time": 1, "embedding": frontal.tolist(), "crop": "front", "score": 1, "area": 100},
            {"shotId": "s2", "time": 2, "embedding": profile.tolist(), "crop": "profile", "score": 1, "area": 100},
        ]
        result = recognizer.cluster_faces(faces)
        self.assertEqual(len(result["characters"]), 1)
        self.assertEqual(result["characters"][0]["appearances"], [{"shotId": "s1", "time": 1}, {"shotId": "s2", "time": 2}])
        self.assertEqual(len(recognizer.cluster_faces(faces, similarity_threshold=.50)["characters"]), 2)

    def test_dme_job_does_not_block_health_and_can_cancel(self):
        entered = threading.Event()
        class Separator:
            def separate(self, path, **kwargs):
                entered.set()
                kwargs["cancel_event"].wait(3)
                raise RuntimeError("cancelled")
        jobs = DmeJobs(Separator())
        try:
            with patch.object(main, "jobs", jobs):
                response = self.client.post("/api/separate-dme", headers=self.headers, files={"file": ("test.wav", b"audio")})
                self.assertEqual(response.status_code, 202)
                job_id = response.json()["jobId"]
                self.assertTrue(entered.wait(1))
                self.assertEqual(self.client.get("/health").status_code, 200)
                self.assertEqual(self.client.post("/api/separate-dme", headers=self.headers, files={"file": ("test.wav", b"audio")}).status_code, 409)
                self.client.delete("/api/dme-jobs/" + job_id, headers=self.headers)
                for _ in range(100):
                    state = jobs.status(job_id)["status"]
                    if state == "cancelled": break
                    time.sleep(.01)
                self.assertEqual(state, "cancelled")
        finally:
            jobs.executor.shutdown(wait=True)

    def test_body_geometry_does_not_call_full_body_a_closeup(self):
        with patch.dict("sys.modules", {"cv2": None}):
            image = Image.new("RGB", (100, 100))
            self.assertEqual(ShotClassifier._estimate_person_size(image, {"xyxy": [30, 5, 70, 95], "h": 90}), "FS")
            self.assertEqual(ShotClassifier._estimate_person_size(image, {"xyxy": [0, 0, 100, 100], "h": 100}), "Unknown")

    def test_cancel_before_upload_prevents_the_job_from_starting(self):
        jobs = DmeJobs(None)
        try:
            job_id = "5f1a987d-1a92-413a-8d39-8a674a10293e"
            self.assertEqual(jobs.cancel(job_id)["status"], "cancelled")
            self.assertEqual(jobs.start(io.BytesIO(b"audio"), 20, job_id), {"jobId": job_id})
            self.assertEqual(jobs.status(job_id)["status"], "cancelled")
        finally:
            jobs.executor.shutdown(wait=True)

    def test_speech_job_cancels_at_a_bounded_worker_boundary(self):
        entered = threading.Event()
        class Engine:
            def scan(self, _path, cancel_event, _progress):
                entered.set(); cancel_event.wait(2)
                raise RuntimeError("cancelled")
        jobs = SpeechJobs(Engine())
        try:
            started = jobs.start(io.BytesIO(b"audio"), "speech-test")
            self.assertEqual(started["jobId"], "speech-test")
            self.assertTrue(entered.wait(1))
            self.assertEqual(jobs.cancel("speech-test")["status"], "cancelling")
            for _ in range(100):
                if jobs.status("speech-test")["status"] == "cancelled": break
                time.sleep(.01)
            self.assertEqual(jobs.status("speech-test")["status"], "cancelled")
        finally:
            jobs.executor.shutdown(wait=True)

    def test_chunked_dme_keeps_stereo_peaks_and_global_bin_alignment(self):
        import torch
        import soundfile as sf
        from types import SimpleNamespace
        from audio_engine import DmeSeparator
        separator = DmeSeparator()
        separator.model = SimpleNamespace(samplerate=100, sources=["speech", "music", "sfx"])
        lengths = []
        def extract(_input, output, _cancel):
            # More than one chunk, opposite phase channels, and a peak at the join.
            data = np.zeros((4000, 2), dtype=np.float32)
            data[2999] = [.75, -.75]
            data[3000] = [.5, -.5]
            sf.write(output, data, 100, subtype="FLOAT")
        def apply(_model, tensor, **kwargs):
            lengths.append(tensor.shape[-1])
            return tensor[:, None].repeat(1, 3, 1, 1)
        with patch.object(separator, "extract_audio_to_wav", side_effect=extract), patch("audio_engine.apply_model", side_effect=apply):
            result = separator.separate("fixture", bin_count=40)
        self.assertEqual(lengths, [3100, 1100])
        self.assertEqual(result["duration"], 40)
        self.assertEqual(result["dialogue"][29], .75)
        self.assertEqual(result["dialogue"][30], .5)
        self.assertEqual(len(result["dialogue"]), 40)

    def test_speech_engine_detects_speech(self):
        from speech_engine import SpeechEngine
        import tempfile, wave, struct, os
        engine = SpeechEngine()
        with tempfile.NamedTemporaryFile(suffix=".wav", delete=False) as temp_wav:
            wav_path = temp_wav.name
            with wave.open(temp_wav, "wb") as wav_file:
                wav_file.setnchannels(1)
                wav_file.setsampwidth(2)
                wav_file.setframerate(16000)
                frames = bytearray()
                for i in range(16000):
                    val = int(16000 * np.sin(2 * np.pi * 440 * i / 16000))
                    frames.extend(struct.pack("<h", val))
                wav_file.writeframes(frames)
        try:
            result = engine.scan(wav_path)
            self.assertIn("regions", result)
            self.assertEqual(result["duration"], 1.0)
        finally:
            if os.path.exists(wav_path):
                os.unlink(wav_path)

if __name__ == "__main__": unittest.main()
