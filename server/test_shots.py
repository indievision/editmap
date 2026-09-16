"""
Unit tests for TransNet V2 Shot Boundary Detection Engine and API endpoint.
"""

import os
import tempfile
import unittest
import numpy as np
from fastapi.testclient import TestClient

import main
from shot_engine import ShotBoundaryDetector, TransNetV2Model, ModelUnavailableError


class TestShotEngine(unittest.TestCase):
    def setUp(self):
        self.detector = ShotBoundaryDetector()
        self.client = TestClient(main.app)
        self.headers = {"X-Editmap-Token": main.SESSION_TOKEN, "Origin": "http://127.0.0.1:5179"}

    def test_nonexistent_video_file_raises(self):
        with self.assertRaises(FileNotFoundError):
            ShotBoundaryDetector.get_video_info("/nonexistent/video/path.mp4")

        response = self.client.post(
            "/api/detect-shots",
            headers=self.headers,
            json={"video_path": "/nonexistent/video/path.mp4", "threshold": 0.5}
        )
        self.assertEqual(response.status_code, 400)
        self.assertIn("not found", response.json()["detail"].lower())

    def test_predictions_to_shots_hard_cut(self):
        # 100 frames, 25 fps => 4 seconds
        # Cut at frame 50
        preds = np.zeros(100, dtype=np.float32)
        preds[50] = 0.95

        shots = ShotBoundaryDetector.predictions_to_shots(
            predictions=preds,
            fps=25.0,
            threshold=0.5,
            min_shot_len_frames=10
        )

        self.assertEqual(len(shots), 2)
        
        # Shot 0: frames 0 to 49
        self.assertEqual(shots[0]["shot_index"], 0)
        self.assertEqual(shots[0]["start_frame"], 0)
        self.assertEqual(shots[0]["end_frame"], 49)
        self.assertEqual(shots[0]["start_seconds"], 0.0)
        self.assertEqual(shots[0]["end_seconds"], 2.0)
        self.assertEqual(shots[0]["transition_type"], "cut")

        # Shot 1: frames 50 to 99
        self.assertEqual(shots[1]["shot_index"], 1)
        self.assertEqual(shots[1]["start_frame"], 50)
        self.assertEqual(shots[1]["end_frame"], 99)
        self.assertEqual(shots[1]["start_seconds"], 2.0)
        self.assertEqual(shots[1]["end_seconds"], 4.0)
        self.assertEqual(shots[1]["confidence"], 0.95)

    def test_predictions_to_shots_soft_transition(self):
        # Dissolve across frames 48..52
        preds = np.zeros(100, dtype=np.float32)
        preds[48:53] = np.array([0.45, 0.65, 0.88, 0.62, 0.40], dtype=np.float32)

        shots = ShotBoundaryDetector.predictions_to_shots(
            predictions=preds,
            fps=25.0,
            threshold=0.5,
            min_shot_len_frames=10
        )

        self.assertGreaterEqual(len(shots), 2)
        cut_shot = shots[1]
        self.assertEqual(cut_shot["transition_type"], "soft")

    def test_min_shot_len_merging(self):
        # Spurious cuts too close together (frames 20 and 23)
        preds = np.zeros(100, dtype=np.float32)
        preds[20] = 0.80
        preds[23] = 0.90  # Only higher peak frame 23 should survive min_shot_len_frames=10

        shots = ShotBoundaryDetector.predictions_to_shots(
            predictions=preds,
            fps=25.0,
            threshold=0.5,
            min_shot_len_frames=10
        )

        self.assertEqual(len(shots), 2)
        self.assertEqual(shots[1]["start_frame"], 23)

    def test_synthetic_video_end_to_end(self):
        import cv2

        with tempfile.NamedTemporaryFile(suffix=".mp4", delete=False) as tmp:
            tmp_path = tmp.name

        try:
            fourcc = cv2.VideoWriter_fourcc(*"mp4v")
            writer = cv2.VideoWriter(tmp_path, fourcc, 24.0, (160, 120))
            self.assertTrue(writer.isOpened())

            # 30 frames black, 30 frames white
            for _ in range(30):
                frame = np.zeros((120, 160, 3), dtype=np.uint8)
                writer.write(frame)
            for _ in range(30):
                frame = np.full((120, 160, 3), 255, dtype=np.uint8)
                writer.write(frame)

            writer.release()

            # Test Python detector directly
            res = self.detector.detect_shots(tmp_path, threshold=0.3, min_shot_len_frames=5)
            self.assertEqual(res["status"], "success")
            self.assertEqual(res["video_path"], tmp_path)
            self.assertGreaterEqual(res["total_shots"], 2)
            self.assertAlmostEqual(res["fps"], 24.0, delta=1.0)
            self.assertIsInstance(res["shots"], list)
            self.assertIn("start_seconds", res["shots"][0])

            # Test FastAPI API endpoint
            api_res = self.client.post(
                "/api/detect-shots",
                headers=self.headers,
                json={"video_path": tmp_path, "threshold": 0.3, "min_shot_len_frames": 5}
            )
            self.assertEqual(api_res.status_code, 200)
            body = api_res.json()
            self.assertEqual(body["status"], "success")
            self.assertEqual(body["video_path"], tmp_path)
            self.assertGreaterEqual(body["total_shots"], 2)
            self.assertIsInstance(body["shots"], list)

        finally:
            if os.path.exists(tmp_path):
                os.unlink(tmp_path)

    def test_api_validation(self):
        # Invalid threshold > 1.0
        res = self.client.post(
            "/api/detect-shots",
            headers=self.headers,
            json={"video_path": "/tmp/test.mp4", "threshold": 1.5}
        )
        self.assertEqual(res.status_code, 422)

        # Invalid min_shot_len_frames < 1
        res = self.client.post(
            "/api/detect-shots",
            headers=self.headers,
            json={"video_path": "/tmp/test.mp4", "min_shot_len_frames": 0}
        )
        self.assertEqual(res.status_code, 422)

    def test_min_shot_len_merging_opening_shot(self):
        # Very short first shot (4 frames: 0..3) with min_shot_len_frames=10
        preds = np.zeros(100, dtype=np.float32)
        preds[4] = 0.95

        shots = ShotBoundaryDetector.predictions_to_shots(
            predictions=preds,
            fps=25.0,
            threshold=0.5,
            min_shot_len_frames=10
        )

        # The 4-frame opening shot must be merged forward so no shot is < 10 frames
        self.assertEqual(len(shots), 1)
        self.assertEqual(shots[0]["shot_index"], 0)
        self.assertEqual(shots[0]["start_frame"], 0)
        self.assertEqual(shots[0]["end_frame"], 99)
        self.assertEqual(shots[0]["start_seconds"], 0.0)
        self.assertEqual(shots[0]["end_seconds"], 4.0)

    def test_sliding_window_100_frame_contract(self):
        # Verify that predict_batch is strictly called with 100-frame batches
        batch_sizes_seen = []
        original_predict_batch = self.detector.model.predict_batch

        def mock_predict_batch(frames):
            batch_sizes_seen.append(len(frames))
            return original_predict_batch(frames)

        self.detector.model.predict_batch = mock_predict_batch
        try:
            import cv2
            with tempfile.NamedTemporaryFile(suffix=".mp4", delete=False) as tmp:
                tmp_path = tmp.name

            fourcc = cv2.VideoWriter_fourcc(*"mp4v")
            writer = cv2.VideoWriter(tmp_path, fourcc, 24.0, (160, 120))
            # 65 frames: shorter than 100, but official TransNet V2 padding must turn it into 100-frame windows
            for _ in range(65):
                writer.write(np.zeros((120, 160, 3), dtype=np.uint8))
            writer.release()

            preds, fps, T = self.detector.predict_video(tmp_path)
            self.assertEqual(T, 65)
            self.assertEqual(len(preds), 65)
            self.assertTrue(all(bs == 100 for bs in batch_sizes_seen), f"Expected 100-frame batches, got: {batch_sizes_seen}")
        finally:
            self.detector.model.predict_batch = original_predict_batch
            if os.path.exists(tmp_path):
                os.unlink(tmp_path)

    def test_health_check_shots_engine(self):
        res = self.client.get("/health")
        self.assertEqual(res.status_code, 200)
        data = res.json()
        self.assertIn("shots", data["engines"])
        self.assertEqual(data["engines"]["shots"]["status"], "ready")
        self.assertEqual(data["engines"]["shots"]["model"], "transnetv2")
        self.assertIn("backend", data["engines"]["shots"])


if __name__ == "__main__":
    unittest.main()
