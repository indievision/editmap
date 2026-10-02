import io
import json
import tempfile
import threading
import time
import unittest
from pathlib import Path
from unittest.mock import patch, MagicMock
import numpy as np
from PIL import Image
from fastapi.testclient import TestClient
import main
from cv_engine import CharacterRecognizer, CinemaShotScaleClassifier, ShotClassifier, ModelUnavailableError, encode_image_to_base64
from dme_jobs import DmeJobs
from speech_jobs import SpeechJobs
from benchmark_framing import load_manifest, score_shots

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
            Prediction("shot.framing.medium-wide", .82),
            Prediction("shot.framing.medium-wide", .76),
            Prediction("shot.framing.closeup", .91),
        ])
        size, uncertain, confidence = classifier.classify_frames([Image.new("RGB", (20, 20))] * 3)
        self.assertEqual(size, "American")
        self.assertFalse(uncertain)
        self.assertAlmostEqual(confidence, 1.58 / 3)
        self.assertEqual(classifier._LABEL_TO_SIZE, {
            "extreme-wide": "Extreme wide", "wide": "Wide", "full": "Full",
            "medium-wide": "American", "medium": "Medium", "medium-closeup": "Medium close-up",
            "closeup": "Close", "extreme-closeup-face": "Extreme close",
            "extreme-closeup-face-macro-eyes-dual": "Extreme close",
            "extreme-closeup-face-macro-eye-single": "Extreme close",
            "extreme-closeup-face-macro-mouth": "Extreme close", "extreme-closeup-hands": "Extreme close",
            "extreme-closeup-body": "Extreme close", "extreme-closeup-prop": "Extreme close",
        })

    def test_framing_benchmark_scores_three_frame_human_labels_without_claiming_qualification(self):
        class FakeClassifier:
            model_name = "verified-test-model"
            def classify_frames(self, images):
                self.images_per_call = len(images)
                return "Medium", False, .8

        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            for index in range(3):
                Image.new("RGB", (20, 20)).save(root / f"frame-{index}.jpg")
            manifest_path = root / "labels.json"
            manifest_path.write_text(json.dumps({"shots": [{
                "id": "one", "film": "Reviewer film", "expected": "Medium",
                "frames": ["frame-0.jpg", "frame-1.jpg", "frame-2.jpg"],
            }]}))
            shots = load_manifest(manifest_path)
            classifier = FakeClassifier()
            report = score_shots(shots, manifest_path, classifier)

        self.assertEqual(classifier.images_per_call, 3)
        self.assertEqual(report["accuracy"], 1.0)
        self.assertFalse(report["qualified_on_this_dataset"])

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

    def test_cluster_faces_prefers_sharp_and_clear_crop_for_avatar(self):
        recognizer = CharacterRecognizer()
        emb = np.zeros(512, dtype=float); emb[0] = 1.0
        blurry_face = {
            "shotId": "s1", "time": 1, "embedding": emb.tolist(),
            "crop": "blurry_crop", "score": 0.9, "area": 2500, "sharpness": 5.0
        }
        sharp_face = {
            "shotId": "s2", "time": 2, "embedding": emb.tolist(),
            "crop": "sharp_crop", "score": 0.9, "area": 2500, "sharpness": 200.0
        }
        result = recognizer.cluster_faces([blurry_face, sharp_face])
        self.assertEqual(len(result["characters"]), 1)
        self.assertEqual(result["characters"][0]["avatar"], "sharp_crop")

    def test_extract_faces_with_crops_filters_unusable_poses_and_blur(self):
        recognizer = CharacterRecognizer()
        class MockFace:
            def __init__(self, det_score, bbox, pose, kps):
                self.embedding = np.ones(512, dtype=np.float32)
                self.det_score = det_score
                self.bbox = bbox
                self.pose = pose
                self.kps = kps

        mock_engine = MagicMock()
        # 1. Back of head (yaw = 80)
        f_back = MockFace(0.9, [10, 10, 60, 60], [0.0, 80.0, 0.0], np.array([[20, 20], [40, 20], [30, 30], [25, 45], [35, 45]]))
        # 2. Looking straight down at floor (pitch = 50)
        f_down = MockFace(0.9, [10, 10, 60, 60], [50.0, 0.0, 0.0], np.array([[20, 20], [40, 20], [30, 30], [25, 45], [35, 45]]))
        # 3. Non-face hand/tile artifact (inverted landmarks: nose above eyes)
        f_hand = MockFace(0.9, [10, 10, 60, 60], [0.0, 0.0, 0.0], np.array([[20, 30], [40, 30], [30, 10], [25, 45], [35, 45]]))
        # 4. Good frontal face (yaw = 5, pitch = 5)
        f_good = MockFace(0.9, [10, 10, 60, 60], [5.0, 5.0, 0.0], np.array([[20, 20], [40, 20], [30, 30], [25, 45], [35, 45]]))
        mock_engine.get.return_value = [f_back, f_down, f_hand, f_good]

        recognizer._engine = mock_engine
        recognizer._engine_type = "insightface"

        # Create an image with high contrast checkerboard so cv2.Laplacian is well above 50
        test_img = Image.new("RGB", (100, 100))
        for x in range(0, 100, 2):
            for y in range(0, 100, 2):
                test_img.putpixel((x, y), (255, 255, 255))

        faces = recognizer.extract_faces_with_crops(test_img)
        self.assertEqual(len(faces), 1)
        self.assertEqual(faces[0]["score"], 0.9)

    def test_cluster_faces_discards_single_appearance_spurious_detections(self):
        recognizer = CharacterRecognizer()
        emb_main = np.zeros(512, dtype=float); emb_main[0] = 1.0
        emb_spurious = np.zeros(512, dtype=float); emb_spurious[1] = 1.0
        faces = [
            # Main character appears in 2 shots
            {"shotId": "s1", "time": 1, "embedding": emb_main.tolist(), "crop": "c1", "score": 0.9, "area": 2500},
            {"shotId": "s2", "time": 2, "embedding": emb_main.tolist(), "crop": "c2", "score": 0.9, "area": 2500},
            # Spurious detection appears in only 1 frame / 1 shot
            {"shotId": "s3", "time": 3, "embedding": emb_spurious.tolist(), "crop": "c3", "score": 0.68, "area": 2500},
        ]
        res = recognizer.cluster_faces(faces, min_appearances=2)
        # Spurious single-appearance cluster must be discarded
        self.assertEqual(len(res["characters"]), 1)
        self.assertEqual(res["characters"][0]["shotId"], "s1")
        self.assertEqual(res["unassignedFaces"], 1)

    def test_rescan_matches_existing_character_at_arcface_similarity(self):
        recognizer = CharacterRecognizer()
        ref = np.zeros(512, dtype=float); ref[0] = 1.0
        # Re-scanned view has 0.52 similarity with existing cast reference (below 0.60, but above 0.45 threshold)
        new_emb = np.zeros(512, dtype=float); new_emb[0] = 0.52; new_emb[1] = np.sqrt(1 - 0.52**2)
        existing = [{"id": "anna", "name": "Anna", "references": [{"id": "ref-anna", "image": "img-a"}]}]
        faces = [
            {"shotId": "s1", "time": 1, "embedding": new_emb.tolist(), "crop": "c1", "score": 0.9, "area": 2500},
            {"shotId": "s2", "time": 2, "embedding": new_emb.tolist(), "crop": "c2", "score": 0.9, "area": 2500},
        ]
        with patch.object(recognizer, "_get_reference_embeddings", return_value=[ref]):
            res = recognizer.cluster_faces(faces, existing_cast=existing)
            self.assertEqual(len(res["characters"]), 1)
            self.assertEqual(res["characters"][0]["id"], "anna")
            self.assertEqual(res["characters"][0]["name"], "Anna")

    def test_sampled_face_tracker_preserves_continuity_without_assigning_identity(self):
        recognizer = CharacterRecognizer()
        first = {"embedding": [1., 0.], "bbox": [10, 10, 50, 50], "score": .9, "crop": "a", "area": 1600}
        moved = {"embedding": [.8, .6], "bbox": [18, 10, 58, 50], "score": .95, "crop": "b", "area": 1600}
        other = {"embedding": [0., 1.], "bbox": [80, 10, 120, 50], "score": .9, "crop": "c", "area": 1600}
        with patch.object(recognizer, "extract_faces_with_crops", side_effect=[[first], [moved, other]]):
            tracked = recognizer.track_faces_across_frames([
                (Image.new("RGB", (128, 72)), .1),
                (Image.new("RGB", (128, 72)), .5),
            ])
        self.assertEqual(tracked[0]["trackId"], tracked[1]["trackId"])
        self.assertNotEqual(tracked[1]["trackId"], tracked[2]["trackId"])
        self.assertEqual([face["time"] for face in tracked], [.1, .5, .5])

    def test_sampled_face_tracker_does_not_merge_two_faces_in_one_frame(self):
        recognizer = CharacterRecognizer()
        first = {"embedding": [1., 0.], "bbox": [0, 0, 40, 40], "score": .95, "crop": "first", "area": 1600}
        second = {"embedding": [.65, .7599], "bbox": [80, 0, 120, 40], "score": .9, "crop": "second", "area": 1600}
        with patch.object(recognizer, "extract_faces_with_crops", return_value=[first, second]):
            tracked = recognizer.track_faces_across_frames([(Image.new("RGB", (128, 72)), .1)])
        self.assertNotEqual(tracked[0]["trackId"], tracked[1]["trackId"])

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

    def test_scanners_status_and_update(self):
        # 1. Unauthenticated request should be 401
        res = self.client.get("/api/scanners/status", headers={"Origin": "http://127.0.0.1:5179"})
        self.assertEqual(res.status_code, 401)

        # 2. Authenticated status request
        res = self.client.get("/api/scanners/status", headers=self.headers)
        self.assertEqual(res.status_code, 200)
        data = res.json()
        self.assertEqual(data["service"], "editmap-cv-engine")
        self.assertIn("engines", data)
        self.assertGreaterEqual(len(data["engines"]), 6)
        engine_ids = [e["id"] for e in data["engines"]]
        self.assertIn("framing", engine_ids)
        self.assertIn("characters", engine_ids)
        self.assertIn("shots", engine_ids)
        self.assertIn("dme", engine_ids)
        self.assertIn("speech", engine_ids)
        self.assertIn("loudness", engine_ids)

        # 3. Authenticated update request
        update_res = self.client.post("/api/scanners/update", headers=self.headers, json={"checkOnly": False})
        self.assertEqual(update_res.status_code, 200)
        update_data = update_res.json()
        self.assertTrue(update_data["success"])
        self.assertTrue(update_data["updated"])
        self.assertIn("All local scanner models", update_data["message"])

    def test_analyze_eye_trace_with_optical_flow_momentum(self):
        from PIL import Image
        import io, base64

        def make_b64(r, g, b, shift=0):
            img = Image.new("RGB", (160, 90), color=(r, g, b))
            # Draw a bright spot to track
            for y in range(40, 50):
                for x in range(70 + shift, 90 + shift):
                    img.putpixel((x, y), (255, 255, 255))
            buf = io.BytesIO()
            img.save(buf, format="JPEG")
            return base64.b64encode(buf.getvalue()).decode("utf-8")

        prev_b64 = make_b64(20, 20, 20, shift=-5)
        out_b64 = make_b64(20, 20, 20, shift=0)
        in_b64 = make_b64(20, 20, 20, shift=15)

        res = self.client.post(
            "/api/analyze-eye-trace",
            headers=self.headers,
            json={
                "outgoingImage": out_b64,
                "incomingImage": in_b64,
                "prevOutgoingImage": prev_b64,
            },
        )
        self.assertEqual(res.status_code, 200)
        data = res.json()
        self.assertIn("outgoingFocalPoint", data)
        self.assertIn("incomingFocalPoint", data)
        self.assertIn("jumpDistancePercent", data)
        self.assertIn("momentum", data)
        momentum = data["momentum"]
        self.assertIn("vx", momentum)
        self.assertIn("vy", momentum)
        self.assertIn("alignment", momentum)

    def test_eye_trace_saliency_sharpness_weighting(self):
        """Verify that EyeTraceAnalyzer scores sharp in-focus faces above out-of-focus blurry foreground faces."""
        from cv_engine import EyeTraceAnalyzer
        # Create a test image with two regions:
        # Region A: large, uniform / smooth blurry gradient
        # Region B: smaller, but sharp high-frequency checkerboard (in-focus face)
        img_np = np.full((120, 200, 3), 120, dtype=np.uint8)

        # Region A: Blurry large foreground element (x: 0..80, y: 0..100)
        for y in range(100):
            for x in range(80):
                img_np[y, x] = int(100 + 20 * np.sin(x * 0.05))

        # Region B: In-focus subject with high contrast edges (x: 110..160, y: 20..80)
        for y in range(20, 80):
            for x in range(110, 160):
                val = 220 if ((x // 3) + (y // 3)) % 2 == 0 else 40
                img_np[y, x] = val

        # Region A bbox (area: 80 * 100 = 8000)
        bbox_a = (0, 0, 80, 100)
        # Region B bbox (area: 50 * 60 = 3000)
        bbox_b = (110, 20, 160, 80)

        score_a = EyeTraceAnalyzer._compute_face_saliency_score(img_np, bbox_a, 0.95, 200, 120)
        score_b = EyeTraceAnalyzer._compute_face_saliency_score(img_np, bbox_b, 0.95, 200, 120)

        # Sharpness of in-focus subject must overcome larger blurry foreground area
        self.assertGreater(score_b, score_a)

    def test_eye_trace_axis_clash_and_character_replacement(self):
        """Verify 180° axis clash, character replacement, and depth accommodation detection."""
        from cv_engine import EyeTraceAnalyzer
        analyzer = EyeTraceAnalyzer()

        # Mock two focal points on screen-right facing screen-left (180° axis clash)
        with patch.object(analyzer, "extract_focal_point") as mock_focal:
            mock_focal.side_effect = [
                {
                    "x": 0.75, "y": 0.35, "type": "eyes", "confidence": 0.9,
                    "gazeDirection": "screen-left", "sharpness": 220.0, "areaPercent": 15.0
                },
                {
                    "x": 0.72, "y": 0.38, "type": "eyes", "confidence": 0.9,
                    "gazeDirection": "screen-left", "sharpness": 35.0, "areaPercent": 6.0
                }
            ]
            dummy_img = Image.new("RGB", (64, 36), (100, 100, 100))
            res = analyzer.analyze_cut(dummy_img, dummy_img)

            # Option A rating: <= 18% jump -> anchored
            self.assertEqual(res["rating"], "anchored")
            # 180° Axis clash must be flagged
            self.assertTrue(res["axisClash"])
            self.assertIn("180° line cross", res["axisClashDetail"])
            # Character replacement pop must be flagged (dx=0.03, dy=0.03 -> distance ~4%)
            self.assertTrue(res["characterReplacement"])
            # Depth shift from high sharpness (220) to blurry (35)
            self.assertEqual(res["depthShift"]["shift"], "near-to-far")

if __name__ == "__main__": unittest.main()

