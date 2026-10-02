import io
import base64
import hashlib
import logging
import uuid
import threading
from typing import Any, Dict, List, Optional, Tuple

import numpy as np
from PIL import Image
from cinemaclip_verification import verify_loaded_cinemaclip
from shot_engine import ShotBoundaryDetector

logger = logging.getLogger("editmap.cv")

# ---------------------------------------------------------------------------
# Image Utilities
# ---------------------------------------------------------------------------

class ModelUnavailableError(RuntimeError):
    """Inference could not run; never substitute an empty detection."""


def decode_base64_image(image_data: str) -> Image.Image:
    """Decodes a base64 or data-URL encoded image to a RGB PIL Image."""
    if "," in image_data:
        image_data = image_data.split(",", 1)[1]
    if len(image_data) > 8 * 1024 * 1024:
        raise ValueError("Image exceeds 8 MB encoded limit")
    raw_bytes = base64.b64decode(image_data, validate=True)
    img = Image.open(io.BytesIO(raw_bytes))
    if img.width * img.height > 16_000_000 or min(img.size) < 2:
        raise ValueError("Image dimensions exceed supported bounds")
    return img.convert("RGB")


def encode_image_to_base64(img: Image.Image, format: str = "JPEG", quality: int = 85) -> str:
    """Encodes a PIL Image to a base64 string."""
    buffer = io.BytesIO()
    img.save(buffer, format=format, quality=quality)
    return base64.b64encode(buffer.getvalue()).decode("utf-8")


# ---------------------------------------------------------------------------
# Step 1: Shot Classification (Ultralytics YOLO)
# ---------------------------------------------------------------------------

COCO_ANIMALS = {
    "bird", "cat", "dog", "horse", "sheep", "cow",
    "elephant", "bear", "zebra", "giraffe"
}

COCO_INTERIORS = {
    "chair", "couch", "bed", "dining table", "toilet",
    "tv", "refrigerator", "oven", "sink", "microwave"
}

COCO_OBJECTS = {
    "bottle", "cup", "fork", "knife", "spoon", "bowl", "banana", "apple",
    "sandwich", "orange", "broccoli", "carrot", "hot dog", "pizza", "donut",
    "cake", "book", "clock", "vase", "scissors", "teddy bear", "hair drier",
    "toothbrush", "car", "motorcycle", "airplane", "bus", "train", "truck",
    "boat", "traffic light", "fire hydrant", "stop sign", "parking meter",
    "bench", "backpack", "umbrella", "handbag", "tie", "suitcase", "frisbee",
    "skis", "snowboard", "sports ball", "kite", "baseball bat",
    "baseball glove", "skateboard", "surfboard", "tennis racket", "laptop",
    "mouse", "remote", "keyboard", "cell phone"
}

ACTIVE_FRAMING_SIZES = (
    "Extreme wide", "Wide", "Full", "American", "Medium", "Medium close-up", "Close", "Extreme close",
)


class CinemaShotScaleClassifier:
    """Local CinemaCLIP adapter limited to its supervised shot-framing head."""

    model_id = "OZU-Technology/CinemaCLIP"
    model_name = "CinemaCLIP-1.0.0:shot.framing"
    _LABEL_TO_SIZE = {
        "extreme-wide": "Extreme wide",
        "wide": "Wide",
        "full": "Full",
        "medium-wide": "American",
        "medium": "Medium",
        "medium-closeup": "Medium close-up",
        "closeup": "Close",
        "extreme-closeup-face": "Extreme close",
        "extreme-closeup-face-macro-eyes-dual": "Extreme close",
        "extreme-closeup-face-macro-eye-single": "Extreme close",
        "extreme-closeup-face-macro-mouth": "Extreme close",
        "extreme-closeup-hands": "Extreme close",
        "extreme-closeup-body": "Extreme close",
        "extreme-closeup-prop": "Extreme close",
    }

    def __init__(self):
        self._model = None
        self.last_error = None

    def _get_model(self):
        if self._model is None:
            try:
                import torch
                from cinemaclip import CinemaCLIP

                model = CinemaCLIP.from_pretrained(self.model_id, local_files_only=True).eval()
                verification = verify_loaded_cinemaclip(model)
                if torch.backends.mps.is_available():
                    model = model.to("mps")
                self._model = model
                logger.info("Loaded %s with verified checkpoint %s", self.model_name, verification["checkpoint_sha256"])
            except Exception as error:
                self.last_error = str(error)
                raise ModelUnavailableError(
                    "CinemaCLIP shot-framing model is unavailable. "
                    "Run `server/.venv/bin/python server/provision_cinemaclip.py` while online, then restart the local CV service."
                ) from error
        return self._model

    @staticmethod
    def _prediction_value(prediction: Any, name: str) -> Any:
        value = getattr(prediction, name, None)
        if value is None and isinstance(prediction, dict):
            value = prediction.get(name)
        if isinstance(value, (list, tuple, np.ndarray)):
            return value[0] if len(value) else None
        return value

    def classify_frames(self, images: List[Image.Image]) -> Tuple[str, bool, float]:
        if not images:
            raise ValueError("At least one frame is required for framing analysis.")
        model = self._get_model()
        totals = {size: 0.0 for size in ACTIVE_FRAMING_SIZES}
        votes = {size: 0 for size in ACTIVE_FRAMING_SIZES}
        valid_predictions = 0

        try:
            for image in images:
                prediction = model.predict_image(image)["classifier_preds"]["shot.framing"]
                label = self._prediction_value(prediction, "label")
                confidence = self._prediction_value(prediction, "confidence")
                size = self._LABEL_TO_SIZE.get(str(label).removeprefix("shot.framing."))
                if size is None:
                    continue
                score = float(confidence)
                totals[size] += score
                votes[size] += 1
                valid_predictions += 1
        except Exception as error:
            self.last_error = str(error)
            raise ModelUnavailableError(f"CinemaCLIP framing inference failed: {error}") from error

        if not valid_predictions:
            return "Unknown", True, 0.0
        size, total = max(totals.items(), key=lambda item: item[1])
        confidence = total / valid_predictions
        # A scale observed in only one of the three interior samples, or without
        # enough class probability, remains a review suggestion rather than fact.
        # Two agreeing interior frames and a 0.50 mean probability avoid a false
        # feeling of precision at an edit boundary or during a reframing move.
        uncertain = votes[size] < 2 or confidence < 0.50
        self.last_error = None
        return size, uncertain, confidence


class ShotClassifier:
    def __init__(self, model_name: str = "yolo11n.pt"):
        self.model_name = model_name
        self._model = None
        self.last_error = None
        self.framing_classifier = CinemaShotScaleClassifier()

    def _get_model(self):
        if self._model is None:
            try:
                from ultralytics import YOLO
                self._model = YOLO(self.model_name)
                logger.info("Loaded Ultralytics YOLO model: %s", self.model_name)
            except Exception as e:
                # Fallback to yolov8n.pt if yolo11n is unavailable
                try:
                    from ultralytics import YOLO
                    self._model = YOLO("yolov8n.pt")
                    self.model_name = "yolov8n.pt"
                    logger.info("Loaded fallback YOLO model: yolov8n.pt")
                except Exception as ex:
                    logger.error("Failed to load YOLO model: %s / %s", e, ex)
                    raise
        return self._model

    def _detect_title_card(self, img: Image.Image, has_people: bool = False, has_objects: bool = False) -> bool:
        """Heuristic check for title cards, credit rolls, and graphics."""
        if has_people or has_objects:
            return False

        np_img = np.array(img)
        # Check color variance across channels
        r, g, b = np_img[:, :, 0], np_img[:, :, 1], np_img[:, :, 2]
        color_diff = np.mean(np.abs(r.astype(int) - g.astype(int)) + np.abs(g.astype(int) - b.astype(int)))
        
        # Calculate edge density using simple gradient difference
        gray = np.mean(np_img, axis=2)
        grad_x = np.abs(gray[:, 1:] - gray[:, :-1])
        grad_y = np.abs(gray[1:, :] - gray[:-1, :])
        edge_mean = np.mean(grad_x) + np.mean(grad_y)
        
        # Check background uniformity: percentage of pixels within 15 levels of median
        median_val = np.median(gray)
        uniform_ratio = np.mean(np.abs(gray - median_val) < 15)

        # Title cards typically have high background uniformity (>80%) with sharp edge contrast and low color difference
        if uniform_ratio > 0.80 and color_diff < 12 and edge_mean > 2.2:
            return True
        return False

    def _analyze_landscape_nature(self, img: Image.Image) -> bool:
        """Detects whether an image is predominantly landscape / nature."""
        np_img = np.array(img)
        r, g, b = np_img[:, :, 0].astype(float), np_img[:, :, 1].astype(float), np_img[:, :, 2].astype(float)
        
        # Green vegetation dominance
        green_mask = (g > r * 1.1) & (g > b * 1.1) & (g > 40)
        # Sky / water dominance
        sky_mask = (b > r * 1.15) & (b > g * 0.9) & (b > 60)
        # Earth / terrain (brown/rock)
        earth_mask = (r > 1.2 * b) & (g > 1.1 * b) & (r > 50)
        
        total_pixels = img.width * img.height
        nature_score = (np.sum(green_mask) + np.sum(sky_mask) + np.sum(earth_mask)) / total_pixels
        return nature_score > 0.40

    def analyze_frames(self, images: List[Image.Image]) -> Dict[str, Any]:
        shot_size, framing_uncertain, confidence = self.framing_classifier.classify_frames(images)
        return self.analyze(
            images[len(images) // 2],
            framing=(shot_size, framing_uncertain, confidence),
        )

    def analyze(
        self,
        img: Image.Image,
        framing: Optional[Tuple[str, bool, float]] = None,
    ) -> Dict[str, Any]:
        """Classifies shot framing, people composition, content, and uncertainty."""
        w, h = img.size

        try:
            model = self._get_model()
            results = model.predict(img, conf=0.30, verbose=False)
            boxes = results[0].boxes if len(results) > 0 else None
        except Exception as e:
            logger.warning("YOLO detection error: %s", e)
            self.last_error = str(e)
            boxes = None

        if boxes is not None:
            self.last_error = None
        detected_people = []
        detected_animals = []
        detected_interiors = []
        detected_objects = []
        uncertain = False

        if boxes is not None and len(boxes) > 0:
            for b in boxes:
                cls_id = int(b.cls[0].item())
                cls_name = model.names.get(cls_id, "")
                conf = float(b.conf[0].item())
                xyxy = b.xyxy[0].tolist()
                box_w = xyxy[2] - xyxy[0]
                box_h = xyxy[3] - xyxy[1]
                box_area = (box_w * box_h) / (w * h)

                item = {"name": cls_name, "conf": conf, "h": box_h, "w": box_w, "area": box_area, "xyxy": xyxy}

                if cls_name == "person":
                    detected_people.append(item)
                elif cls_name in COCO_ANIMALS:
                    detected_animals.append(item)
                elif cls_name in COCO_INTERIORS:
                    detected_interiors.append(item)
                elif cls_name in COCO_OBJECTS:
                    detected_objects.append(item)

                if conf < 0.45:
                    uncertain = True

        has_people = len(detected_people) > 0
        has_major_objects = (
            len(detected_animals) > 0
            or (len(detected_interiors) > 0 and max([o["area"] for o in detected_interiors], default=0) > 0.10)
            or (len(detected_objects) > 0 and max([o["area"] for o in detected_objects], default=0) > 0.05)
        )
        is_title = self._detect_title_card(img, has_people=has_people, has_objects=has_major_objects)

        # If it's a title card
        if is_title:
            return {
                "shotSize": "Not applicable",
                "composition": "No people",
                "content": "Text / title card",
                "uncertain": True,
                "model": "title-card-heuristic-v1",
            }

        # Composition calculation
        num_people = len(detected_people)
        if num_people == 0:
            composition = "No people"
        elif num_people == 1:
            composition = "Single person"
        elif num_people == 2:
            composition = "Two-shot"
        else:
            composition = "Group"

        # Content classification
        if num_people > 0:
            content = "People"
        elif len(detected_animals) > 0:
            content = "Animals"
        elif len(detected_interiors) > 0 and max([o["area"] for o in detected_interiors], default=0) > 0.15:
            content = "Architecture / interiors"
        elif len(detected_objects) > 0 and max([o["area"] for o in detected_objects], default=0) > 0.08:
            content = "Object / detail"
        elif self._analyze_landscape_nature(img):
            content = "Landscape / nature"
        elif len(detected_interiors) > 0:
            content = "Architecture / interiors"
        elif len(detected_objects) > 0:
            content = "Object / detail"
        else:
            content = "Landscape / nature" if self._analyze_landscape_nature(img) else "Other"

        if framing is None:
            framing = self.framing_classifier.classify_frames([img])
        shot_size, framing_uncertain, framing_confidence = framing

        return {
            "shotSize": shot_size,
            "composition": composition,
            "content": content,
            "uncertain": uncertain or framing_uncertain or boxes is None or len(boxes) == 0,
            "model": f"{self.framing_classifier.model_name}+{self.model_name}:composition",
            "framingConfidence": framing_confidence,
        }


# ---------------------------------------------------------------------------
# Step 2: Character Mapping (InsightFace / face_recognition)
# ---------------------------------------------------------------------------
    @staticmethod
    def _estimate_person_size(img: Image.Image, person: Dict[str, Any]) -> str:
        """Estimates cinematic shot size based on face scale and person bounding box geometry."""
        w, h = img.size
        x1, y1, x2, y2 = person["xyxy"]
        pw = max(1.0, x2 - x1)
        ph = max(1.0, y2 - y1)
        h_ratio = ph / h
        w_ratio = pw / w
        y1_rel = y1 / h
        y2_rel = y2 / h

        # 1. Face Evidence Detection
        try:
            import cv2
            detector = cv2.CascadeClassifier(cv2.data.haarcascades + "haarcascade_frontalface_default.xml")
            np_img = np.array(img)
            gray = cv2.cvtColor(np_img, cv2.COLOR_RGB2GRAY)
            
            # Crop upper portion of person box for higher face detection recall
            crop_y1 = max(0, int(y1))
            crop_y2 = min(h, int(y1 + ph * 0.75))
            crop_x1 = max(0, int(x1 - pw * 0.1))
            crop_x2 = min(w, int(x2 + pw * 0.1))
            
            face_ratio = 0.0
            if crop_y2 > crop_y1 + 10 and crop_x2 > crop_x1 + 10:
                crop_gray = gray[crop_y1:crop_y2, crop_x1:crop_x2]
                faces = detector.detectMultiScale(crop_gray, scaleFactor=1.1, minNeighbors=4)
                if len(faces) > 0:
                    best_fh = max(fh for fx, fy, fw, fh in faces)
                    face_ratio = best_fh / h

            if face_ratio == 0.0:
                faces = detector.detectMultiScale(gray, scaleFactor=1.1, minNeighbors=5)
                ratios = [fh / h for fx, fy, fw, fh in faces if x1 - pw * 0.2 <= fx + fw / 2 <= x2 + pw * 0.2 and y1 <= fy + fh / 2 <= y2]
                if ratios:
                    face_ratio = max(ratios)

            if face_ratio > 0:
                if face_ratio >= 0.40:
                    return "ECU"
                if face_ratio >= 0.22:
                    return "CU"
                if face_ratio >= 0.13:
                    return "MCU"
                if face_ratio >= 0.07:
                    return "MS"
                if face_ratio >= 0.04:
                    return "MWS"
        except Exception:
            pass  # Fall through to bounding box geometry

        # Degenerate whole-frame box filling >96% of width and height without face evidence
        if w_ratio >= 0.96 and h_ratio >= 0.96 and y1_rel <= 0.02 and y2_rel >= 0.98:
            return "Unknown"

        # 2. Person Bounding Box Geometry
        is_unclipped = (y1_rel >= 0.02) and (y2_rel <= 0.98)
        
        if is_unclipped:
            if h_ratio >= 0.70:
                return "FS"
            if h_ratio >= 0.35:
                return "FS" if h_ratio >= 0.55 else "WS"
            if h_ratio >= 0.12:
                return "WS"
            return "EWS"

        # Clipped box (person extends to top or bottom frame boundary)
        if y2_rel >= 0.95:
            if y1_rel <= 0.05:
                if w_ratio >= 0.50:
                    return "CU"
                if w_ratio >= 0.30:
                    return "MCU"
                if w_ratio >= 0.20:
                    return "MS"
                return "MWS"
            elif y1_rel <= 0.18:
                if w_ratio >= 0.40:
                    return "MCU"
                if w_ratio >= 0.22:
                    return "MS"
                return "MWS"
            elif y1_rel <= 0.35:
                if h_ratio >= 0.50:
                    return "MS"
                return "MCU"
            else:
                if h_ratio >= 0.40:
                    return "MCU"
                if h_ratio >= 0.25:
                    return "CU"
                return "ECU"

        if y1_rel <= 0.05:
            if h_ratio >= 0.60:
                return "MS"
            if h_ratio >= 0.35:
                return "MCU"
            if h_ratio >= 0.20:
                return "CU"
            return "ECU"

        if h_ratio >= 0.65:
            return "MS"
        if h_ratio >= 0.35:
            return "MCU"
        if h_ratio >= 0.15:
            return "WS"
        return "EWS"


class CharacterRecognizer:
    def __init__(self, similarity_threshold: float = 0.38):
        self.similarity_threshold = similarity_threshold
        self._engine = None
        self._engine_type = None
        self._reference_cache: Dict[str, List[np.ndarray]] = {}
        self.last_error = None

    def _init_engine(self):
        if self._engine_type == "fallback":
            raise ModelUnavailableError("Face recognition is unavailable; install InsightFace or face_recognition and restart the service.")
        if self._engine is not None:
            return

        # Attempt 1: InsightFace (ArcFace 512-dim encodings)
        try:
            from insightface.app import FaceAnalysis
            app = FaceAnalysis(name="buffalo_l", providers=["CPUExecutionProvider"])
            app.prepare(ctx_id=0, det_size=(640, 640), det_thresh=0.50)
            self._engine = app
            self._engine_type = "insightface"
            logger.info("Initialized InsightFace engine (512-dim ArcFace)")
            return
        except Exception as e:
            logger.warning("InsightFace initialization failed: %s", e)

        # Attempt 2: face_recognition (dlib 128-dim encodings)
        try:
            import face_recognition
            self._engine = face_recognition
            self._engine_type = "face_recognition"
            logger.info("Initialized face_recognition engine")
            return
        except Exception as e:
            logger.warning("face_recognition initialization failed: %s", e)

        # Attempt 3: Lightweight OpenCV/Haar Cascade fallback for face detection
        logger.warning("No advanced face recognition engine available; using fallback detector.")
        self._engine = "fallback"
        self._engine_type = "fallback"
        self.last_error = "No face recognition engine is available"
        raise ModelUnavailableError(self.last_error)

    def _extract_face_embeddings(self, img: Image.Image) -> List[np.ndarray]:
        """Extracts normalized face embeddings for all faces in image."""
        self._init_engine()
        np_img = np.array(img)

        if self._engine_type == "insightface":
            # InsightFace expects BGR format
            bgr_img = np_img[:, :, ::-1]
            faces = self._engine.get(bgr_img)
            embeddings = []
            for face in faces:
                embedding = face.embedding
                norm = np.linalg.norm(embedding)
                if norm > 0:
                    embeddings.append(embedding / norm)
            return embeddings

        elif self._engine_type == "face_recognition":
            # face_recognition expects RGB format
            encodings = self._engine.face_encodings(np_img)
            embeddings = []
            for enc in encodings:
                norm = np.linalg.norm(enc)
                if norm > 0:
                    embeddings.append(enc / norm)
            return embeddings

        return []

    def _get_reference_embeddings(self, ref_id: str, image_b64: str) -> List[np.ndarray]:
        """Cached extraction of reference embeddings."""
        cache_key = f"{ref_id}:{hashlib.md5(image_b64.encode('utf-8')).hexdigest()[:16]}"
        if cache_key in self._reference_cache:
            return self._reference_cache[cache_key]

        try:
            ref_img = decode_base64_image(image_b64)
            embeddings = self._extract_face_embeddings(ref_img)
            if len(self._reference_cache) >= 512:
                self._reference_cache.pop(next(iter(self._reference_cache)))
            self._reference_cache[cache_key] = embeddings
            return embeddings
        except ModelUnavailableError:
            raise
        except Exception as e:
            logger.error("Failed to extract reference embeddings for %s: %s", ref_id, e)
            return []

    def analyze(self, frame_img: Image.Image, cast: List[Dict[str, Any]]) -> Dict[str, Any]:
        """
        Matches faces in the frame against the cast member references.
        Returns:
            appearances: List of matched cast member IDs
            unresolved: bool indicating unmatched visible person/face
        """
        self._init_engine()
        frame_embeddings = self._extract_face_embeddings(frame_img)

        # Build cast embedding dictionary: member_id -> list of reference embeddings
        cast_member_embeddings: Dict[str, List[np.ndarray]] = {}
        for member in cast:
            member_id = member.get("id")
            if not member_id:
                continue
            embeddings = []
            for ref in member.get("references", []):
                ref_id = ref.get("id", "ref")
                ref_b64 = ref.get("image", "")
                if ref_b64:
                    embeddings.extend(self._get_reference_embeddings(ref_id, ref_b64))
            cast_member_embeddings[member_id] = embeddings

        appearances = set()
        unresolved = False

        if len(frame_embeddings) == 0:
            # Check if person was detected in the frame by running quick detector or checking caller context
            # If no face is detected in frame, appearances is empty
            return {
                "appearances": [],
                "unresolved": False
            }

        # Compare each candidate face against all cast members
        for face_emb in frame_embeddings:
            best_member_id = None
            best_similarity = -1.0

            for member_id, ref_embs in cast_member_embeddings.items():
                for ref_emb in ref_embs:
                    # Cosine similarity for normalized vectors: dot product
                    sim = float(np.dot(face_emb, ref_emb))
                    if sim > best_similarity:
                        best_similarity = sim
                        best_member_id = member_id

            if best_member_id is not None and best_similarity >= self.similarity_threshold:
                appearances.add(best_member_id)
            else:
                # Face is present in frame but could not be matched safely to any cast member
                unresolved = True

        return {
            "appearances": sorted(list(appearances)),
            "unresolved": unresolved
        }

    def extract_faces_with_crops(self, img: Image.Image) -> List[Dict[str, Any]]:
        """
        Extracts detected faces with bounding boxes, normalized embeddings,
        detection scores, and compact avatar crops (base64 JPEG).
        """
        self._init_engine()
        np_img = np.array(img)
        w, h = img.size
        faces_data = []

        if self._engine_type == "insightface":
            bgr_img = np_img[:, :, ::-1]
            faces = self._engine.get(bgr_img)
            for face in faces:
                embedding = face.embedding
                norm = np.linalg.norm(embedding)
                if norm <= 0:
                    continue
                norm_embedding = (embedding / norm).tolist()
                score = float(face.det_score) if hasattr(face, "det_score") else 1.0
                if score < 0.45:
                    continue
                bbox = [int(v) for v in face.bbox]

                x1, y1, x2, y2 = bbox
                bw = max(1, x2 - x1)
                bh = max(1, y2 - y1)
                if bw < 32 or bh < 32:
                    continue

                # 1. Pose filter: Ignore true backs of heads (>85° yaw) and extreme vertical tilt (>50° pitch)
                yaw = 0.0
                if hasattr(face, "pose") and face.pose is not None:
                    try:
                        pitch, yaw, roll = face.pose
                        yaw = float(yaw)
                        if abs(yaw) > 75.0:
                            continue
                        if float(pitch) > 45.0 or float(pitch) < -45.0:
                            continue
                    except Exception:
                        pass

                # 2. Keypoints / anatomical plausibility check (weed out distorted non-faces like hands/hair/background)
                if hasattr(face, "kps") and face.kps is not None:
                    try:
                        kps = face.kps
                        # Only apply horizontal eye separation check for frontal/semi-frontal faces;
                        # in profile view (abs(yaw) >= 40°), the distant eye is foreshortened near the nose.
                        if abs(yaw) < 40.0:
                            eye_dist = np.linalg.norm(kps[0] - kps[1])
                            if eye_dist < (bw * 0.10):
                                continue
                        eye_mid = (kps[0] + kps[1]) / 2.0
                        mouth_mid = (kps[3] + kps[4]) / 2.0
                        face_vec = mouth_mid - eye_mid
                        face_height = np.linalg.norm(face_vec)
                        if face_height < (bh * 0.18):
                            continue
                        # Nose must lie roughly between eyes and mouth along face vertical axis
                        nose_proj = float(np.dot(kps[2] - eye_mid, face_vec) / max(1e-6, face_height ** 2))
                        if nose_proj < 0.08 or nose_proj > 0.92:
                            continue
                    except Exception:
                        pass

                cx = (x1 + x2) // 2
                cy = (y1 + y2) // 2
                crop_size = int(max(bw, bh) * 1.5)

                crop_x1 = max(0, cx - crop_size // 2)
                crop_y1 = max(0, cy - crop_size // 2)
                crop_x2 = min(w, cx + crop_size // 2)
                crop_y2 = min(h, cy + crop_size // 2)

                face_crop = img.crop((crop_x1, crop_y1, crop_x2, crop_y2))

                # 3. Motion blur check: Laplacian variance on face region
                blur_var = 100.0
                try:
                    import cv2
                    crop_np = np.array(face_crop)
                    gray = cv2.cvtColor(crop_np, cv2.COLOR_RGB2GRAY) if crop_np.ndim == 3 else crop_np
                    blur_var = float(cv2.Laplacian(gray, cv2.CV_64F).var())
                    if blur_var < 30.0:
                        continue
                except Exception:
                    pass

                face_crop.thumbnail((160, 160))
                crop_b64 = encode_image_to_base64(face_crop)

                faces_data.append({
                    "embedding": norm_embedding,
                    "bbox": bbox,
                    "score": score,
                    "crop": crop_b64,
                    "area": bw * bh,
                    "sharpness": blur_var,
                })

        elif self._engine_type == "face_recognition":
            locations = self._engine.face_locations(np_img)
            if locations:
                encodings = self._engine.face_encodings(np_img, locations)
                for (top, right, bottom, left), enc in zip(locations, encodings):
                    norm = np.linalg.norm(enc)
                    if norm <= 0:
                        continue
                    norm_embedding = (enc / norm).tolist()
                    bbox = [int(left), int(top), int(right), int(bottom)]
                    bw = max(1, right - left)
                    bh = max(1, bottom - top)
                    if bw < 36 or bh < 36:
                        continue
                    cx = (left + right) // 2
                    cy = (top + bottom) // 2
                    crop_size = int(max(bw, bh) * 1.5)

                    crop_x1 = max(0, cx - crop_size // 2)
                    crop_y1 = max(0, cy - crop_size // 2)
                    crop_x2 = min(w, cx + crop_size // 2)
                    crop_y2 = min(h, cy + crop_size // 2)

                    face_crop = img.crop((crop_x1, crop_y1, crop_x2, crop_y2))

                    blur_var = 100.0
                    try:
                        import cv2
                        crop_np = np.array(face_crop)
                        gray = cv2.cvtColor(crop_np, cv2.COLOR_RGB2GRAY) if crop_np.ndim == 3 else crop_np
                        blur_var = float(cv2.Laplacian(gray, cv2.CV_64F).var())
                        if blur_var < 50.0:
                            continue
                    except Exception:
                        pass

                    face_crop.thumbnail((160, 160))
                    crop_b64 = encode_image_to_base64(face_crop)

                    faces_data.append({
                        "embedding": norm_embedding,
                        "bbox": bbox,
                        "score": 1.0,
                        "crop": crop_b64,
                        "area": bw * bh,
                        "sharpness": blur_var,
                    })

        return faces_data

    @staticmethod
    def _bbox_iou(first: List[int], second: List[int]) -> float:
        ax1, ay1, ax2, ay2 = first
        bx1, by1, bx2, by2 = second
        left, top = max(ax1, bx1), max(ay1, by1)
        right, bottom = min(ax2, bx2), min(ay2, by2)
        overlap = max(0, right - left) * max(0, bottom - top)
        if overlap <= 0:
            return 0.0
        area_a = max(1, ax2 - ax1) * max(1, ay2 - ay1)
        area_b = max(1, bx2 - bx1) * max(1, by2 - by1)
        return overlap / max(1, area_a + area_b - overlap)

    def track_faces_across_frames(self, frames: List[Tuple[Image.Image, float]]) -> List[Dict[str, Any]]:
        """Track face evidence within one shot, without making a cast identity claim."""
        tracks: List[Dict[str, Any]] = []
        tracked_faces: List[Dict[str, Any]] = []
        next_track = 1
        for image, time in frames:
            detections = self.extract_faces_with_crops(image)
            assigned: set[int] = set()
            for face in sorted(detections, key=lambda item: item.get("score", 0), reverse=True):
                embedding = np.asarray(face["embedding"], dtype=np.float32)
                best_index, best_score = None, -1.0
                for index, track in enumerate(tracks):
                    if index in assigned or track["embedding"].shape != embedding.shape:
                        continue
                    similarity = float(np.dot(embedding, track["embedding"]))
                    overlap = self._bbox_iou(face["bbox"], track["bbox"])
                    # Fast movement requires a strong embedding match; lower
                    # matches also need screen-position continuity.
                    if similarity < 0.36 or (similarity < 0.55 and overlap < 0.03):
                        continue
                    score = similarity * 0.85 + overlap * 0.15
                    if score > best_score:
                        best_index, best_score = index, score
                if best_index is None:
                    track = {"id": f"track-{next_track}", "embedding": embedding, "bbox": face["bbox"]}
                    tracks.append(track)
                    # A second face in this same sampled frame cannot be the
                    # same track, including one we just created above.
                    assigned.add(len(tracks) - 1)
                    next_track += 1
                else:
                    track = tracks[best_index]
                    assigned.add(best_index)
                    blended = track["embedding"] * 0.6 + embedding * 0.4
                    norm = np.linalg.norm(blended)
                    track["embedding"] = blended / norm if norm > 0 else embedding
                    track["bbox"] = face["bbox"]
                tracked_faces.append({**face, "time": time, "trackId": track["id"]})
        return tracked_faces

    def cluster_faces(
        self,
        faces_data: List[Dict[str, Any]],
        similarity_threshold: Optional[float] = None,
        min_appearances: int = 1,
        existing_cast: Optional[List[Dict[str, Any]]] = None,
    ) -> Dict[str, Any]:
        """
        Clusters a collection of face embeddings into distinct characters using cosine similarity.
        Returns:
            characters: List of character records with avatar, name, and shot appearances
            totalFaces: Total face instances passed in
            unassignedFaces: Faces filtered out due to min_appearances
        """
        if not faces_data:
            return {
                "characters": [],
                "totalFaces": 0,
                "unassignedFaces": 0,
            }

        # ArcFace (512 dimensions) and dlib/face_recognition (128 dimensions)
        # have materially different cosine-score ranges.  The former commonly
        # drops below .50 for the same person in a profile or down-facing shot,
        # which was fragmenting one cast member into several "Character N"
        # entries.  Keep an explicitly supplied threshold authoritative, but
        # use conservative engine-aware defaults for automatic discovery.
        embedding_dimensions = len(faces_data[0].get("embedding", []))
        if similarity_threshold is not None:
            thresh = similarity_threshold
        else:
            thresh = 0.38 if embedding_dimensions == 512 else 0.72

        # Sort faces by quality (area * score * sharpness) descending so clearest, sharpest faces establish initial cluster anchors
        sorted_faces = sorted(
            faces_data,
            key=lambda f: f.get("score", 1.0) * np.sqrt(f.get("area", 100)) * np.log1p(f.get("sharpness", 50.0)),
            reverse=True,
        )

        clusters: List[Dict[str, Any]] = []

        for face in sorted_faces:
            emb = np.array(face["embedding"], dtype=np.float32)
            norm = np.linalg.norm(emb)
            if norm > 0:
                emb = emb / norm
            else:
                continue

            best_cluster = None
            best_sim = -1.0

            for c in clusters:
                centroid = c["centroid"]
                sim_centroid = float(np.dot(emb, centroid))
                member_sims = [float(np.dot(emb, np.asarray(f["embedding"], dtype=np.float32))) for f in c["faces"]]
                sim_best_member = max(member_sims) if member_sims else sim_centroid
                sim = max(sim_centroid, sim_best_member * 0.95)
                if sim > best_sim:
                    best_sim = sim
                    best_cluster = c

            face_qual = face.get("score", 1.0) * np.sqrt(face.get("area", 100)) * np.log1p(face.get("sharpness", 50.0))
            if best_cluster is not None and best_sim >= thresh:
                best_cluster["faces"].append(face)
                # Recompute centroid
                member_embeddings = [np.array(f["embedding"], dtype=np.float32) for f in best_cluster["faces"]]
                mean_emb = np.mean(member_embeddings, axis=0)
                norm_mean = np.linalg.norm(mean_emb)
                if norm_mean > 0:
                    best_cluster["centroid"] = mean_emb / norm_mean

                # Update best avatar if this face is higher quality
                if face_qual > best_cluster["best_quality"]:
                    best_cluster["best_quality"] = face_qual
                    best_cluster["avatar"] = face.get("crop", "")
                    best_cluster["shotId"] = face.get("shotId", "")
                    best_cluster["time"] = face.get("time", 0.0)
            else:
                clusters.append({
                    "centroid": emb,
                    "faces": [face],
                    "best_quality": face_qual,
                    "avatar": face.get("crop", ""),
                    "shotId": face.get("shotId", ""),
                    "time": face.get("time", 0.0),
                })

        # In auto-discovery mode, merge secondary clusters that have strong exemplar continuity with a primary cluster
        if similarity_threshold is None:
            merged = True
            while merged:
                merged = False
                for i in range(len(clusters)):
                    for j in range(i + 1, len(clusters)):
                        c1, c2 = clusters[i], clusters[j]
                        sim_centroids = float(np.dot(c1["centroid"], c2["centroid"]))
                        if sim_centroids >= thresh:
                            should_merge = True
                        else:
                            cross_sims = [
                                float(np.dot(np.asarray(f1["embedding"], dtype=np.float32), np.asarray(f2["embedding"], dtype=np.float32)))
                                for f1 in c1["faces"] for f2 in c2["faces"]
                            ]
                            max_cross = max(cross_sims) if cross_sims else 0.0
                            should_merge = max_cross >= max(0.38, thresh)

                        if should_merge:
                            c1["faces"].extend(c2["faces"])
                            all_embs = [np.asarray(f["embedding"], dtype=np.float32) for f in c1["faces"]]
                            mean_emb = np.mean(all_embs, axis=0)
                            norm_mean = np.linalg.norm(mean_emb)
                            if norm_mean > 0:
                                c1["centroid"] = mean_emb / norm_mean
                            if c2["best_quality"] > c1["best_quality"]:
                                c1["best_quality"] = c2["best_quality"]
                                c1["avatar"] = c2["avatar"]
                                c1["shotId"] = c2["shotId"]
                                c1["time"] = c2["time"]
                            clusters.pop(j)
                            merged = True
                            break
                    if merged:
                        break

        existing_cast = existing_cast or []
        reference_embeddings = {}
        for member in existing_cast:
            refs = []
            for ref in member.get("references", []):
                refs.extend(self._get_reference_embeddings(ref["id"], ref["image"]))
            if refs:
                reference_embeddings[member["id"]] = refs

        match_cutoff = self.similarity_threshold if embedding_dimensions == 512 else 0.60

        # Separate clusters that meet min_appearances or match confirmed cast
        valid_clusters = []
        unassigned_count = 0
        for c in clusters:
            unique_shots = set(f.get("shotId", "") for f in c["faces"] if f.get("shotId"))
            best_score = max((f.get("score", 0) for f in c["faces"]), default=0)
            total_faces = len(c["faces"])

            # 1. Matches a confirmed existing cast member
            matches_existing = False
            for member in existing_cast:
                for emb in reference_embeddings.get(member["id"], []):
                    if emb.shape == c["centroid"].shape and float(np.dot(c["centroid"], emb)) >= match_cutoff:
                        matches_existing = True
                        break
                if matches_existing:
                    break

            # 2. Or meets discovery recurrence requirements
            if matches_existing:
                valid_clusters.append(c)
            elif min_appearances > 1:
                if len(unique_shots) >= min_appearances or total_faces >= (min_appearances * 2):
                    valid_clusters.append(c)
                else:
                    unassigned_count += total_faces
            else:
                if len(unique_shots) >= 1 and best_score >= 0.60:
                    valid_clusters.append(c)
                else:
                    unassigned_count += total_faces

        # Sort characters by number of distinct shot appearances, then total face instances
        valid_clusters.sort(
            key=lambda c: (len(set(f.get("shotId", "") for f in c["faces"] if f.get("shotId"))), len(c["faces"])),
            reverse=True,
        )

        characters = []
        used_ids = set()
        for idx, c in enumerate(valid_clusters, start=1):
            char_id = "char-" + str(uuid.uuid4())
            name = f"Character {len(existing_cast) + idx}"
            matches = []
            for member in existing_cast:
                scores = [float(np.dot(c["centroid"], emb)) for emb in reference_embeddings.get(member["id"], []) if emb.shape == c["centroid"].shape]
                if scores: matches.append((max(scores), member))
            matches.sort(key=lambda item: item[0], reverse=True)
            # Ambiguous clusters remain new suggestions; never reassign a confirmed identity.
            if matches and matches[0][0] >= match_cutoff and (len(matches) == 1 or matches[0][0] - matches[1][0] >= .08):
                member = matches[0][1]
                if member["id"] not in used_ids:
                    char_id, name = member["id"], member["name"]
            used_ids.add(char_id)

            seen_shots = set()
            appearances = []
            faces_by_time = sorted(c["faces"], key=lambda f: f.get("time", 0.0))
            for f in faces_by_time:
                s_id = f.get("shotId")
                if s_id and s_id not in seen_shots:
                    seen_shots.add(s_id)
                    appearances.append({
                        "shotId": s_id,
                        "time": f.get("time", 0.0),
                    })

            characters.append({
                "id": char_id,
                "name": name,
                "avatar": c["avatar"],
                "shotId": c["shotId"],
                "time": c["time"],
                "appearances": appearances,
            })

        return {
            "characters": characters,
            "totalFaces": len(faces_data),
            "unassignedFaces": unassigned_count,
        }


# ---------------------------------------------------------------------------
# Step 3: Cinematic Color & Harmony Extraction
# ---------------------------------------------------------------------------

class ColorAnalyzer:
    def __init__(self):
        pass

    def analyze(self, img: Image.Image) -> Dict[str, Any]:
        """
        Extracts Rec. 709 luma, temperature, HSV saturation, dominant palette,
        mood, and color wheel harmony classification from a PIL image.
        """
        rgb_img = img.convert("RGB")
        w, h = rgb_img.size
        if w == 0 or h == 0:
            return self._fallback_profile()

        # Resize large frames to thumbnail scale for fast analysis (<1ms)
        if w > 160 or h > 90:
            rgb_img = rgb_img.resize((160, 90), Image.Resampling.BOX)

        arr = np.array(rgb_img, dtype=np.float32)
        r = arr[:, :, 0]
        g = arr[:, :, 1]
        b = arr[:, :, 2]

        r_norm = r / 255.0
        g_norm = g / 255.0
        b_norm = b / 255.0

        # Rec. 709 Luma: Y = 0.2126R + 0.7152G + 0.0722B
        luma = 0.2126 * r_norm + 0.7152 * g_norm + 0.0722 * b_norm
        avg_luma = float(np.mean(luma))

        # Temperature: (R - B) / 255 -> [-1, 1]
        temp = (r - b) / 255.0
        avg_temp = float(np.mean(temp))

        # HSV calculation
        c_max = np.maximum(np.maximum(r_norm, g_norm), b_norm)
        c_min = np.minimum(np.minimum(r_norm, g_norm), b_norm)
        delta = c_max - c_min

        sat = np.where(c_max == 0, 0.0, delta / np.maximum(c_max, 1e-6))
        avg_sat = float(np.mean(sat))

        # 24-bin hue histogram (15° bins) for valid pixels (Value >= 0.15, Saturation >= 0.15)
        hue_bins = np.zeros(24, dtype=np.int32)
        valid_mask = (c_max >= 0.15) & (sat >= 0.15) & (delta > 0)
        colored_count = int(np.sum(valid_mask))

        if colored_count > 0:
            h_deg = np.zeros_like(r_norm)
            r_mask = valid_mask & (c_max == r_norm)
            g_mask = valid_mask & (c_max == g_norm) & ~r_mask
            b_mask = valid_mask & (c_max == b_norm) & ~r_mask & ~g_mask

            h_deg[r_mask] = 60.0 * (((g_norm[r_mask] - b_norm[r_mask]) / delta[r_mask]) % 6)
            h_deg[g_mask] = 60.0 * (((b_norm[g_mask] - r_norm[g_mask]) / delta[g_mask]) + 2)
            h_deg[b_mask] = 60.0 * (((r_norm[b_mask] - g_norm[b_mask]) / delta[b_mask]) + 4)
            h_deg = np.where(h_deg < 0, h_deg + 360.0, h_deg)

            bin_indices = (np.floor(h_deg[valid_mask] / 15.0).astype(int)) % 24
            for bi in bin_indices:
                hue_bins[bi] += 1

        # Palette extraction (quantize into 32-level bins)
        arr_int = np.array(rgb_img, dtype=np.int32)
        q_r = arr_int[:, :, 0] // 32
        q_g = arr_int[:, :, 1] // 32
        q_b = arr_int[:, :, 2] // 32
        keys = (q_r << 6) | (q_g << 3) | q_b
        flat_keys = keys.flatten()
        flat_r = arr_int[:, :, 0].flatten()
        flat_g = arr_int[:, :, 1].flatten()
        flat_b = arr_int[:, :, 2].flatten()

        unique_keys, counts = np.unique(flat_keys, return_counts=True)
        sorted_indices = np.argsort(-counts)

        palette = []
        for idx in sorted_indices:
            if len(palette) >= 5:
                break
            k = unique_keys[idx]
            mask = (flat_keys == k)
            avg_color = [
                int(np.round(np.mean(flat_r[mask]))),
                int(np.round(np.mean(flat_g[mask]))),
                int(np.round(np.mean(flat_b[mask]))),
            ]
            hex_color = f"#{avg_color[0]:02X}{avg_color[1]:02X}{avg_color[2]:02X}"

            # Check Euclidean distance against existing swatches
            is_too_close = False
            for ex in palette:
                ex_r = int(ex[1:3], 16)
                ex_g = int(ex[3:5], 16)
                ex_b = int(ex[5:7], 16)
                dist = np.sqrt((avg_color[0] - ex_r) ** 2 + (avg_color[1] - ex_g) ** 2 + (avg_color[2] - ex_b) ** 2)
                if dist < 32:
                    is_too_close = True
                    break

            if not is_too_close:
                palette.append(hex_color)

        while len(palette) < 3:
            palette.append(palette[0] if len(palette) > 0 else "#808080")

        # Classify Mood
        mood = self._classify_mood(avg_luma, avg_temp, avg_sat)
        harmony = self._detect_harmony(hue_bins, colored_count, avg_sat, avg_luma)

        return {
            "palette": palette,
            "luminance": round(avg_luma, 3),
            "temperature": round(avg_temp, 3),
            "saturation": round(avg_sat, 3),
            "mood": mood,
            "harmony": harmony,
        }

    def _classify_mood(self, luma: float, temp: float, sat: float) -> str:
        if luma < 0.25:
            return "Low-Key / Dark"
        if luma > 0.70:
            return "High-Key / Bright"
        if sat < 0.12:
            return "Monochrome / Muted"
        if temp > 0.15:
            return "Warm Interior"
        if temp < -0.15:
            return "Cool Exterior"
        return "Neutral"

    def _detect_harmony(self, hue_bins: np.ndarray, colored_count: int, avg_sat: float, avg_luma: float) -> Dict[str, Any]:
        if colored_count == 0 or avg_sat < 0.15:
            return {
                "type": "monochromatic",
                "label": "Monochromatic Low-Key" if avg_luma < 0.25 else "Monochromatic Muted",
                "confidence": 0.95,
                "dominantHue": 0,
            }

        HUE_BINS = 24
        # Circular smoothing
        smoothed = np.zeros(HUE_BINS, dtype=np.float32)
        for i in range(HUE_BINS):
            prev_b = hue_bins[(i - 1 + HUE_BINS) % HUE_BINS]
            curr_b = hue_bins[i]
            next_b = hue_bins[(i + 1) % HUE_BINS]
            smoothed[i] = prev_b * 0.25 + curr_b * 0.5 + next_b * 0.25

        peaks = []
        for i in range(HUE_BINS):
            prev_b = smoothed[(i - 1 + HUE_BINS) % HUE_BINS]
            curr_b = smoothed[i]
            next_b = smoothed[(i + 1) % HUE_BINS]
            if curr_b >= prev_b and curr_b >= next_b and curr_b > colored_count * 0.04:
                peaks.append({"binIndex": i, "hue": (i + 0.5) * 15.0, "count": curr_b})

        peaks.sort(key=lambda p: -p["count"])
        dominant_hue = int(round(peaks[0]["hue"])) if len(peaks) > 0 else 0

        def peak_pixel_count(bin_idx: int) -> int:
            return int(
                hue_bins[bin_idx] +
                hue_bins[(bin_idx - 1 + HUE_BINS) % HUE_BINS] +
                hue_bins[(bin_idx + 1) % HUE_BINS]
            )

        # Monochromatic check
        max_two_bins = 0
        for i in range(HUE_BINS):
            s = hue_bins[i] + hue_bins[(i + 1) % HUE_BINS]
            if s > max_two_bins:
                max_two_bins = s

        if avg_sat < 0.20 or (colored_count > 0 and max_two_bins / colored_count > 0.85):
            concentration = max_two_bins / colored_count if colored_count > 0 else 1.0
            sat_conf = max(0.6, 1.0 - avg_sat / 0.20) if avg_sat < 0.20 else 0.0
            conf = min(1.0, max(concentration, sat_conf))
            return {
                "type": "monochromatic",
                "label": "Monochromatic Low-Key" if avg_luma < 0.25 else "Monochromatic",
                "confidence": round(conf, 2),
                "dominantHue": dominant_hue,
            }

        def angular_dist(h1: float, h2: float) -> float:
            diff = abs(h1 - h2) % 360.0
            return 360.0 - diff if diff > 180.0 else diff

        # Complementary / Teal & Orange check across candidate peak pairs
        if len(peaks) >= 2:
            candidate_peaks = peaks[:4]
            best_teal_orange = None
            best_comp = None

            for i in range(len(candidate_peaks)):
                for j in range(i + 1, len(candidate_peaks)):
                    p1 = candidate_peaks[i]
                    p2 = candidate_peaks[j]
                    dist = angular_dist(p1["hue"], p2["hue"])

                    if 140.0 <= dist <= 220.0:
                        is_p1_teal = 160.0 <= p1["hue"] <= 220.0
                        is_p2_teal = 160.0 <= p2["hue"] <= 220.0
                        is_p1_orange = p1["hue"] <= 55.0 or p1["hue"] >= 345.0
                        is_p2_orange = p2["hue"] <= 55.0 or p2["hue"] >= 345.0
                        is_teal_orange = (is_p1_teal and is_p2_orange) or (is_p2_teal and is_p1_orange)

                        combined = min(colored_count, peak_pixel_count(p1["binIndex"]) + peak_pixel_count(p2["binIndex"]))
                        conf = min(1.0, combined / colored_count) if colored_count > 0 else 0.5

                        if is_teal_orange:
                            if best_teal_orange is None or conf > best_teal_orange["conf"]:
                                best_teal_orange = {"conf": conf}
                        else:
                            if best_comp is None or conf > best_comp["conf"]:
                                best_comp = {"conf": conf}

            if best_teal_orange is not None:
                return {
                    "type": "teal-orange",
                    "label": "Teal & Orange",
                    "confidence": max(0.6, round(best_teal_orange["conf"], 2)),
                    "dominantHue": dominant_hue,
                }
            if best_comp is not None:
                return {
                    "type": "complementary",
                    "label": "Complementary",
                    "confidence": max(0.6, round(best_comp["conf"], 2)),
                    "dominantHue": dominant_hue,
                }

        # Analogous check (3 adjacent bins)
        max_three_bins = 0
        for i in range(HUE_BINS):
            s = hue_bins[i] + hue_bins[(i + 1) % HUE_BINS] + hue_bins[(i + 2) % HUE_BINS]
            if s > max_three_bins:
                max_three_bins = s

        if colored_count > 0 and max_three_bins / colored_count >= 0.65:
            conf = round(max_three_bins / colored_count, 2)
            label = "Analogous Warm" if 15 <= dominant_hue <= 60 else "Analogous Cool" if 170 <= dominant_hue <= 250 else "Analogous"
            return {
                "type": "analogous",
                "label": label,
                "confidence": conf,
                "dominantHue": dominant_hue,
            }

        # Triadic check
        if len(peaks) >= 3:
            p1, p2, p3 = peaks[0], peaks[1], peaks[2]
            d12 = angular_dist(p1["hue"], p2["hue"])
            d23 = angular_dist(p2["hue"], p3["hue"])
            d31 = angular_dist(p3["hue"], p1["hue"])
            if 80.0 <= d12 <= 150.0 and 80.0 <= d23 <= 150.0 and 80.0 <= d31 <= 150.0:
                combined = min(colored_count, peak_pixel_count(p1["binIndex"]) + peak_pixel_count(p2["binIndex"]) + peak_pixel_count(p3["binIndex"]))
                return {
                    "type": "triadic",
                    "label": "Triadic / Pop Palette",
                    "confidence": round(combined / colored_count, 2) if colored_count > 0 else 0.7,
                    "dominantHue": dominant_hue,
                }

        return {
            "type": "neutral",
            "label": "Neutral / Balanced",
            "confidence": 0.6,
            "dominantHue": dominant_hue,
        }

    def _fallback_profile(self) -> Dict[str, Any]:
        return {
            "palette": ["#4A7CC2", "#777B85", "#333333"],
            "luminance": 0.5,
            "temperature": 0.0,
            "saturation": 0.0,
            "mood": "Neutral",
            "harmony": {
                "type": "neutral",
                "label": "Neutral / Balanced",
                "confidence": 0.5,
                "dominantHue": 210,
            },
        }


# ---------------------------------------------------------------------------
# Step 4: Eyeline & Eye-Trace Analysis (Walter Murch's Saccadic Cut Flow)
# ---------------------------------------------------------------------------

class EyeTraceAnalyzer:
    def __init__(self, character_recognizer: Optional[CharacterRecognizer] = None, shot_classifier: Optional[ShotClassifier] = None):
        self.character_recognizer = character_recognizer
        self.shot_classifier = shot_classifier

    @staticmethod
    def _compute_face_metrics(
        np_img: np.ndarray,
        bbox: Any,
        det_score: float,
        img_w: int,
        img_h: int,
        kps: Any = None,
        landmarks: Any = None,
    ) -> Dict[str, Any]:
        """
        Calculates cinematic visual saliency, sharpness, lighting, area, and gaze direction (yaw).
        """
        import cv2

        x1, y1, x2, y2 = [float(v) for v in bbox]
        x1_i = max(0, min(img_w - 1, int(round(x1))))
        y1_i = max(0, min(img_h - 1, int(round(y1))))
        x2_i = max(x1_i + 2, min(img_w, int(round(x2))))
        y2_i = max(y1_i + 2, min(img_h, int(round(y2))))

        bw = x2_i - x1_i
        bh = y2_i - y1_i
        area = bw * bh
        area_factor = float(np.sqrt(max(1.0, area)))

        face_patch = np_img[y1_i:y2_i, x1_i:x2_i]
        gray = cv2.cvtColor(face_patch, cv2.COLOR_RGB2GRAY) if face_patch.ndim == 3 else face_patch

        try:
            lap_var = float(cv2.Laplacian(gray, cv2.CV_64F).var())
        except Exception:
            lap_var = 100.0

        if lap_var < 35.0:
            sharpness_weight = 0.15 + (lap_var / 35.0) * 0.25
        elif lap_var < 90.0:
            sharpness_weight = 0.40 + ((lap_var - 35.0) / 55.0) * 0.60
        else:
            sharpness_weight = min(2.5, 1.0 + float(np.log10(lap_var / 90.0 + 1.0)) * 1.5)

        mean_luma = float(np.mean(gray))
        luma_weight = float(np.clip(mean_luma / 110.0, 0.45, 1.4))

        is_edge = (x1_i <= 2 or x2_i >= img_w - 2 or y1_i <= 2 or y2_i >= img_h - 2)
        edge_weight = 0.65 if (is_edge and lap_var < 80.0) else 1.0

        saliency = float(area_factor * det_score * sharpness_weight * luma_weight * edge_weight)

        # Gaze direction / Head yaw (detects 180° eyelines)
        gaze_direction = "direct"
        try:
            if kps is not None and len(kps) >= 3:
                eye_cx = float(kps[0][0] + kps[1][0]) / 2.0
                eye_span = max(4.0, abs(float(kps[1][0] - kps[0][0])))
                nose_x = float(kps[2][0])
                diff = (nose_x - eye_cx) / eye_span
                if diff < -0.14:
                    gaze_direction = "screen-left"
                elif diff > 0.14:
                    gaze_direction = "screen-right"
            elif landmarks is not None:
                eye_pts = landmarks.get("left_eye", []) + landmarks.get("right_eye", [])
                nose_pts = landmarks.get("nose_tip", []) or landmarks.get("nose_bridge", [])
                if eye_pts and nose_pts:
                    eye_cx = sum(p[0] for p in eye_pts) / float(len(eye_pts))
                    nose_x = sum(p[0] for p in nose_pts) / float(len(nose_pts))
                    eye_span = max(5.0, abs(max(p[0] for p in eye_pts) - min(p[0] for p in eye_pts)))
                    diff = (nose_x - eye_cx) / eye_span
                    if diff < -0.14:
                        gaze_direction = "screen-left"
                    elif diff > 0.14:
                        gaze_direction = "screen-right"
            else:
                box_cx = (x1 + x2) / 2.0
                if (box_cx / img_w) > 0.62:
                    gaze_direction = "screen-left"
                elif (box_cx / img_w) < 0.38:
                    gaze_direction = "screen-right"
        except Exception:
            gaze_direction = "direct"

        return {
            "saliency": saliency,
            "sharpness": round(lap_var, 1),
            "meanLuma": round(mean_luma, 1),
            "areaPercent": round(float(area) / float(img_w * img_h) * 100.0, 1),
            "gazeDirection": gaze_direction,
        }

    @classmethod
    def _compute_face_saliency_score(cls, np_img: np.ndarray, bbox: Any, det_score: float, img_w: int, img_h: int) -> float:
        return cls._compute_face_metrics(np_img, bbox, det_score, img_w, img_h)["saliency"]

    def _detect_primary_face_eyes(self, img: Image.Image) -> Optional[Dict[str, Any]]:
        """
        Directly detects face and eye landmarks from CharacterRecognizer engines (InsightFace or
        face_recognition) prioritizing sharp, in-focus, and well-lit subjects over blurry foreground bokeh.
        """
        if not self.character_recognizer:
            return None
        w, h = img.size
        try:
            self.character_recognizer._init_engine()
        except Exception as e:
            logger.warning("Character engine init in EyeTraceAnalyzer failed: %s", e)
            return None

        np_img = np.array(img)

        # 1. InsightFace: has 5 facial keypoints (kps[0]=left eye, kps[1]=right eye)
        if getattr(self.character_recognizer, "_engine_type", None) == "insightface":
            try:
                engine = self.character_recognizer._engine
                bgr_img = np_img[:, :, ::-1] if np_img.ndim == 3 else np_img
                faces = engine.get(bgr_img)
                if faces:
                    candidates = []
                    for f in faces:
                        score = float(getattr(f, "det_score", 0.9))
                        if score < 0.35:
                            continue
                        bbox = getattr(f, "bbox", None)
                        if bbox is None or len(bbox) != 4:
                            continue
                        bw = float(bbox[2] - bbox[0])
                        bh = float(bbox[3] - bbox[1])
                        if bw < 20 or bh < 20:
                            continue
                        kps = getattr(f, "kps", None)
                        metrics = self._compute_face_metrics(np_img, bbox, score, w, h, kps=kps)
                        candidates.append((f, metrics))

                    if candidates:
                        # Prioritize faces with highest visual saliency (focus/sharpness, key lighting, composition, size)
                        candidates.sort(key=lambda item: item[1]["saliency"], reverse=True)
                        best_face, best_metrics = candidates[0]

                        # Check for keypoints (eyes)
                        if hasattr(best_face, "kps") and best_face.kps is not None and len(best_face.kps) >= 2:
                            kps = best_face.kps
                            eye_cx = float(kps[0][0] + kps[1][0]) / 2.0
                            eye_cy = float(kps[0][1] + kps[1][1]) / 2.0
                            return {
                                "x": round(max(0.02, min(0.98, eye_cx / w)), 3),
                                "y": round(max(0.02, min(0.98, eye_cy / h)), 3),
                                "type": "eyes",
                                "confidence": round(float(getattr(best_face, "det_score", 0.9)), 2),
                                "gazeDirection": best_metrics["gazeDirection"],
                                "sharpness": best_metrics["sharpness"],
                                "areaPercent": best_metrics["areaPercent"],
                            }
                        else:
                            x1, y1, x2, y2 = [float(v) for v in best_face.bbox]
                            cx = (x1 + x2) / 2.0
                            eyeline_y = y1 + 0.35 * (y2 - y1)
                            return {
                                "x": round(max(0.02, min(0.98, cx / w)), 3),
                                "y": round(max(0.02, min(0.98, eyeline_y / h)), 3),
                                "type": "eyes",
                                "confidence": round(float(getattr(best_face, "det_score", 0.9)), 2),
                                "gazeDirection": best_metrics["gazeDirection"],
                                "sharpness": best_metrics["sharpness"],
                                "areaPercent": best_metrics["areaPercent"],
                            }
            except Exception as e:
                logger.warning("InsightFace direct eye detection failed: %s", e)

        # 2. face_recognition engine
        elif getattr(self.character_recognizer, "_engine_type", None) == "face_recognition":
            try:
                engine = self.character_recognizer._engine
                locations = engine.face_locations(np_img)
                if locations:
                    candidates = []
                    for loc in locations:
                        top, right, bottom, left = loc
                        bbox = (float(left), float(top), float(right), float(bottom))
                        landmarks_list = engine.face_landmarks(np_img, [loc])
                        lm = landmarks_list[0] if landmarks_list else None
                        metrics = self._compute_face_metrics(np_img, bbox, 0.9, w, h, landmarks=lm)
                        candidates.append((loc, lm, metrics))

                    candidates.sort(key=lambda item: item[2]["saliency"], reverse=True)
                    best_loc, lm, best_metrics = candidates[0]
                    top, right, bottom, left = best_loc
                    if lm and ("left_eye" in lm or "right_eye" in lm):
                        eye_pts = lm.get("left_eye", []) + lm.get("right_eye", [])
                        if eye_pts:
                            eye_x = sum(p[0] for p in eye_pts) / float(len(eye_pts))
                            eye_y = sum(p[1] for p in eye_pts) / float(len(eye_pts))
                            return {
                                "x": round(max(0.02, min(0.98, eye_x / w)), 3),
                                "y": round(max(0.02, min(0.98, eye_y / h)), 3),
                                "type": "eyes",
                                "confidence": 0.92,
                                "gazeDirection": best_metrics["gazeDirection"],
                                "sharpness": best_metrics["sharpness"],
                                "areaPercent": best_metrics["areaPercent"],
                            }
                    cx = float(left + right) / 2.0
                    eyeline_y = float(top) + 0.35 * float(bottom - top)
                    return {
                        "x": round(max(0.02, min(0.98, cx / w)), 3),
                        "y": round(max(0.02, min(0.98, eyeline_y / h)), 3),
                        "type": "eyes",
                        "confidence": 0.88,
                        "gazeDirection": best_metrics["gazeDirection"],
                        "sharpness": best_metrics["sharpness"],
                        "areaPercent": best_metrics["areaPercent"],
                    }
            except Exception as e:
                logger.warning("face_recognition eye detection failed: %s", e)

        # 3. Fallback: extract_faces_with_crops if direct extraction was not applicable
        try:
            faces = self.character_recognizer.extract_faces_with_crops(img)
            if faces:
                candidates = []
                for f in faces:
                    bbox = f.get("bbox", [])
                    if len(bbox) == 4:
                        metrics = self._compute_face_metrics(np_img, tuple(bbox), float(f.get("score", 0.9)), w, h)
                        candidates.append((f, metrics))
                if candidates:
                    candidates.sort(key=lambda item: item[1]["saliency"], reverse=True)
                    best_face, best_metrics = candidates[0]
                    bbox = best_face.get("bbox", [])
                    if len(bbox) == 4:
                        x1, y1, x2, y2 = bbox
                        cx = (x1 + x2) / 2.0
                        eyeline_y = y1 + 0.35 * (y2 - y1)
                        return {
                            "x": round(max(0.02, min(0.98, cx / w)), 3),
                            "y": round(max(0.02, min(0.98, eyeline_y / h)), 3),
                            "type": "eyes",
                            "confidence": round(float(best_face.get("score", 0.9)), 2),
                            "gazeDirection": best_metrics["gazeDirection"],
                            "sharpness": best_metrics["sharpness"],
                            "areaPercent": best_metrics["areaPercent"],
                        }
        except Exception:
            pass

        return None

    def extract_focal_point(self, img: Image.Image) -> Dict[str, Any]:
        """
        Extracts the primary visual focal point (normalized x, y in [0.0, 1.0]),
        prioritizing eyes/face, then person silhouette, then peak edge saliency.
        """
        w, h = img.size

        # Priority 1: Face & Eyes detection
        face_result = self._detect_primary_face_eyes(img)
        if face_result:
            return face_result

        # Priority 2: Person detection via ShotClassifier (YOLO)
        if self.shot_classifier:
            try:
                model = self.shot_classifier._get_model()
                results = model(img, verbose=False)
                if results and len(results) > 0:
                    boxes = results[0].boxes
                    if boxes is not None and len(boxes) > 0:
                        people_boxes = []
                        for box in boxes:
                            cls_id = int(box.cls[0])
                            name = results[0].names.get(cls_id, "")
                            if name == "person":
                                xyxy = box.xyxy[0].tolist()
                                area = (xyxy[2] - xyxy[0]) * (xyxy[3] - xyxy[1])
                                conf = float(box.conf[0])
                                people_boxes.append((area, xyxy, conf))
                        if people_boxes:
                            people_boxes.sort(key=lambda p: p[0], reverse=True)
                            area, xyxy, conf = people_boxes[0]
                            cx = (xyxy[0] + xyxy[2]) / 2.0
                            upper_y = xyxy[1] + 0.16 * (xyxy[3] - xyxy[1])
                            gaze_dir = "screen-left" if (cx / w) > 0.58 else "screen-right" if (cx / w) < 0.42 else "direct"
                            return {
                                "x": round(max(0.02, min(0.98, cx / w)), 3),
                                "y": round(max(0.02, min(0.98, upper_y / h)), 3),
                                "type": "person",
                                "confidence": round(conf, 2),
                                "gazeDirection": gaze_dir,
                                "sharpness": 80.0,
                                "areaPercent": round(float(area) / float(w * h) * 100.0, 1),
                            }
            except Exception as e:
                logger.warning("YOLO person detection in EyeTraceAnalyzer failed: %s", e)

        # Priority 3: Peak Visual Saliency via Sobel Gradient + Gaussian Filter Peak
        try:
            small = img.resize((160, 90)).convert("L")
            arr = np.array(small, dtype=np.float32)
            sh, sw = arr.shape

            gx = np.zeros_like(arr)
            gy = np.zeros_like(arr)
            gx[:, 1:-1] = arr[:, 2:] - arr[:, :-2]
            gy[1:-1, :] = arr[2:, :] - arr[:-2, :]
            grad = np.sqrt(gx * gx + gy * gy)

            # Rule-of-thirds / center prior
            y_coords, x_coords = np.mgrid[0:sh, 0:sw]
            norm_x = x_coords / sw
            norm_y = y_coords / sh
            cdx = norm_x - 0.5
            cdy = norm_y - 0.45
            center_prior = np.exp(-(cdx * cdx + cdy * cdy) / 0.35)

            saliency = grad * center_prior

            # Convolve with 9x9 box to locate primary salient cluster peak
            import cv2
            smoothed = cv2.GaussianBlur(saliency, (9, 9), 0)
            max_val = float(np.max(smoothed))

            if max_val > 6.0:
                max_idx = np.unravel_index(np.argmax(smoothed), smoothed.shape)
                peak_y = (float(max_idx[0]) + 0.5) / sh
                peak_x = (float(max_idx[1]) + 0.5) / sw
                return {
                    "x": round(float(max(0.05, min(0.95, peak_x))), 3),
                    "y": round(float(max(0.05, min(0.95, peak_y))), 3),
                    "type": "saliency",
                    "confidence": 0.70,
                    "gazeDirection": "direct",
                    "sharpness": round(max_val * 10.0, 1),
                    "areaPercent": 6.0,
                }
        except Exception as e:
            logger.warning("Saliency calculation failed: %s", e)

        return {
            "x": 0.5,
            "y": 0.45,
            "type": "center",
            "confidence": 0.5,
            "gazeDirection": "direct",
            "sharpness": 50.0,
            "areaPercent": 5.0,
        }

    def compute_gaze_momentum(
        self,
        prev_img: Image.Image,
        curr_img: Image.Image,
        p1: Dict[str, Any],
        p2: Dict[str, Any],
        outgoing_frames: Optional[List[Image.Image]] = None,
    ) -> Dict[str, Any]:
        """
        Calculates gaze momentum vector and alignment with saccadic jump vector
        using multi-frame optical flow around the outgoing focal point.
        """
        import cv2

        w, h = 160, 90
        frames_list = []
        if outgoing_frames and len(outgoing_frames) >= 2:
            frames_list = [np.array(f.resize((w, h)).convert("L")) for f in outgoing_frames]
        else:
            frames_list = [
                np.array(prev_img.resize((w, h)).convert("L")),
                np.array(curr_img.resize((w, h)).convert("L")),
            ]

        focal_x = int(round(p1["x"] * w))
        focal_y = int(round(p1["y"] * h))

        # Sample 3x3 local cluster centered on focal point + grid anchors
        pts = []
        for dy in (-10, 0, 10):
            for dx in (-10, 0, 10):
                qx = max(2, min(w - 3, focal_x + dx))
                qy = max(2, min(h - 3, focal_y + dy))
                pts.append([[float(qx), float(qy)]])

        all_displacements = []
        for i in range(len(frames_list) - 1):
            gray_a = frames_list[i]
            gray_b = frames_list[i + 1]
            pts_a = np.array(pts, dtype=np.float32)
            pts_b, status, _ = cv2.calcOpticalFlowPyrLK(
                gray_a, gray_b, pts_a, None,
                winSize=(15, 15), maxLevel=2,
                criteria=(cv2.TERM_CRITERIA_EPS | cv2.TERM_CRITERIA_COUNT, 10, 0.03)
            )
            good_a = pts_a[status == 1]
            good_b = pts_b[status == 1]
            if len(good_a) >= 3:
                all_displacements.append(good_b - good_a)

        if not all_displacements:
            return {
                "vx": 0.0,
                "vy": 0.0,
                "velocity": 0,
                "alignment": "static",
                "cosineScore": 0.0,
                "trajectoryAngle": 0,
            }

        concat_disp = np.concatenate(all_displacements, axis=0)
        med_dx = float(np.median(concat_disp[:, 0]))
        med_dy = float(np.median(concat_disp[:, 1]))

        # Normalized velocities (-1.0 to 1.0)
        vx = round(float(np.clip(med_dx / 6.0, -1.0, 1.0)), 3)
        vy = round(float(np.clip(med_dy / 6.0, -1.0, 1.0)), 3)
        vel_mag = float(np.sqrt(vx * vx + vy * vy))
        velocity = min(100, int(round(vel_mag * 100)))

        # Saccade vector from p1 to p2
        sx = p2["x"] - p1["x"]
        sy = p2["y"] - p1["y"]
        s_mag = float(np.sqrt(sx * sx + sy * sy))

        angle_rad = float(np.arctan2(vy, vx))
        angle_deg = int(round(np.degrees(angle_rad))) % 360

        if vel_mag < 0.08 or s_mag < 0.04:
            alignment = "static"
            cosine_score = 0.0
        else:
            cosine = (vx * sx + vy * sy) / (vel_mag * s_mag)
            cosine_score = round(float(np.clip(cosine, -1.0, 1.0)), 3)
            if cosine >= 0.40:
                alignment = "momentum-match"
            elif cosine <= -0.40:
                alignment = "momentum-collision"
            else:
                alignment = "neutral"

        return {
            "vx": vx,
            "vy": vy,
            "velocity": velocity,
            "alignment": alignment,
            "cosineScore": cosine_score,
            "trajectoryAngle": angle_deg,
        }

    def analyze_cut(
        self,
        outgoing_img: Image.Image,
        incoming_img: Image.Image,
        prev_outgoing_img: Optional[Image.Image] = None,
        outgoing_frames: Optional[List[Image.Image]] = None,
    ) -> Dict[str, Any]:
        p1 = self.extract_focal_point(outgoing_img)
        p2 = self.extract_focal_point(incoming_img)

        dx = p2["x"] - p1["x"]
        dy = p2["y"] - p1["y"]
        jump_distance = float(np.sqrt(dx * dx + dy * dy))
        jump_distance_percent = min(100, int(round(jump_distance * 100)))

        # Option A Gaze Ratings (Anchored / Shifted / Scattered)
        if jump_distance_percent <= 18:
            rating = "anchored"
        elif jump_distance_percent <= 38:
            rating = "shifted"
        else:
            rating = "scattered"

        screen_direction = "neutral"
        if dx > 0.12:
            screen_direction = "left-to-right"
        elif dx < -0.12:
            screen_direction = "right-to-left"

        # 1. 180° Axis Clash Warning
        axis_clash = False
        axis_clash_detail = None
        gaze1 = p1.get("gazeDirection", "direct")
        gaze2 = p2.get("gazeDirection", "direct")
        is_same_side = (p1["x"] > 0.50 and p2["x"] > 0.50) or (p1["x"] < 0.50 and p2["x"] < 0.50)

        if is_same_side and gaze1 in ("screen-left", "screen-right") and gaze1 == gaze2:
            axis_clash = True
            side_str = "screen-right" if p1["x"] > 0.50 else "screen-left"
            dir_str = "screen-left" if gaze1 == "screen-left" else "screen-right"
            axis_clash_detail = f"Both subjects framed {side_str} facing {dir_str} (180° line cross)"
        elif is_same_side and abs(dx) < 0.22 and p1.get("type") in ("eyes", "face") and p2.get("type") in ("eyes", "face"):
            if gaze1 == gaze2 and gaze1 != "direct":
                axis_clash = True
                axis_clash_detail = "Eyelines clash across edit boundary (180° axis violation)"

        # 2. Character Replacement / Jump-Cut Collision Detector
        character_replacement = False
        character_replacement_detail = None
        if jump_distance_percent <= 12 and p1.get("type") in ("eyes", "face", "person") and p2.get("type") in ("eyes", "face", "person"):
            character_replacement = True
            character_replacement_detail = f"Subject substituted in place ({jump_distance_percent}% hop)"

        # 3. Depth / Focal Plane Accommodation Shift
        s1 = float(p1.get("sharpness", 100.0))
        s2 = float(p2.get("sharpness", 100.0))
        a1 = float(p1.get("areaPercent", 10.0))
        a2 = float(p2.get("areaPercent", 10.0))

        if (s1 > 100.0 and s2 < 45.0 and a1 > a2 * 1.5) or (s1 > 180.0 and s2 < 55.0):
            depth_shift = {
                "outgoingSharpness": round(s1, 1),
                "incomingSharpness": round(s2, 1),
                "shift": "near-to-far",
                "magnitude": "high" if s1 > 200.0 else "moderate",
            }
        elif (s2 > 100.0 and s1 < 45.0 and a2 > a1 * 1.5) or (s2 > 180.0 and s1 < 55.0):
            depth_shift = {
                "outgoingSharpness": round(s1, 1),
                "incomingSharpness": round(s2, 1),
                "shift": "far-to-near",
                "magnitude": "high" if s2 > 200.0 else "moderate",
            }
        else:
            depth_shift = {
                "outgoingSharpness": round(s1, 1),
                "incomingSharpness": round(s2, 1),
                "shift": "constant",
                "magnitude": "subtle",
            }

        result: Dict[str, Any] = {
            "outgoingFocalPoint": p1,
            "incomingFocalPoint": p2,
            "jumpDistance": round(jump_distance, 3),
            "jumpDistancePercent": jump_distance_percent,
            "rating": rating,
            "screenDirection": screen_direction,
            "axisClash": axis_clash,
            "axisClashDetail": axis_clash_detail,
            "characterReplacement": character_replacement,
            "characterReplacementDetail": character_replacement_detail,
            "depthShift": depth_shift,
        }

        if prev_outgoing_img is not None or (outgoing_frames and len(outgoing_frames) >= 2):
            result["momentum"] = self.compute_gaze_momentum(
                prev_outgoing_img or outgoing_frames[0],
                outgoing_img,
                p1,
                p2,
                outgoing_frames=outgoing_frames,
            )

        return result


# ---------------------------------------------------------------------------
# Step 5: Camera Motion & Kinetic Energy Analysis (RANSAC Global Affine vs Residuals)
# ---------------------------------------------------------------------------

class MotionAnalyzer:
    def __init__(self):
        pass

    def analyze_motion(self, img_a: Image.Image, img_b: Image.Image) -> Dict[str, Any]:
        """
        Analyzes motion between two consecutive/adjacent frames sampled from a shot.
        Decomposes visual energy into:
        - Camera Movement (Global Affine Transform via RANSAC inliers)
        - Subject Movement (Residual Outliers + Local displacement)
        """
        import cv2

        # Resize to 160x90 for ultra-fast, sub-millisecond calculation
        w, h = 160, 90
        gray_a = np.array(img_a.resize((w, h)).convert("L"))
        gray_b = np.array(img_b.resize((w, h)).convert("L"))

        pts_a = cv2.goodFeaturesToTrack(gray_a, maxCorners=100, qualityLevel=0.01, minDistance=6)

        fallback = {
            "cameraMovement": "Static",
            "cameraEnergy": 0,
            "subjectEnergy": 0,
            "totalKineticEnergy": 0,
            "confidence": 0.5,
        }

        if pts_a is None or len(pts_a) < 8:
            diff = np.mean(np.abs(gray_a.astype(np.float32) - gray_b.astype(np.float32)))
            energy = min(100, int(round(diff * 4)))
            return {
                "cameraMovement": "Static" if energy < 10 else "Dynamic / Action",
                "cameraEnergy": energy if energy >= 10 else 0,
                "subjectEnergy": 0,
                "totalKineticEnergy": energy,
                "confidence": 0.6,
            }

        pts_b, status, err = cv2.calcOpticalFlowPyrLK(
            gray_a, gray_b, pts_a, None,
            winSize=(15, 15), maxLevel=2,
            criteria=(cv2.TERM_CRITERIA_EPS | cv2.TERM_CRITERIA_COUNT, 10, 0.03)
        )

        good_a = pts_a[status == 1]
        good_b = pts_b[status == 1]

        if len(good_a) < 6:
            return fallback

        matrix, inliers = cv2.estimateAffinePartial2D(
            good_a, good_b, method=cv2.RANSAC, ransacReprojThreshold=1.5
        )

        if matrix is None:
            return fallback

        dx = float(matrix[0, 2])
        dy = float(matrix[1, 2])
        scale = float(np.sqrt(matrix[0, 0] ** 2 + matrix[1, 0] ** 2))
        angle = float(np.arctan2(matrix[1, 0], matrix[0, 0]))

        global_shift = float(np.sqrt(dx * dx + dy * dy))
        scale_delta = abs(scale - 1.0)
        angle_delta = abs(angle)

        camera_energy = min(100, int(round(global_shift * 20 + scale_delta * 220 + angle_delta * 45)))

        inlier_mask = inliers.flatten() if inliers is not None else np.ones(len(good_a))
        outlier_count = int(np.sum(inlier_mask == 0))
        total_pts = len(good_a)

        outlier_ratio = outlier_count / max(1, total_pts)
        outlier_motion = 0.0
        if outlier_count > 0:
            outlier_pts_a = good_a[inlier_mask == 0]
            outlier_pts_b = good_b[inlier_mask == 0]
            for pa, pb in zip(outlier_pts_a, outlier_pts_b):
                expected_b = matrix @ np.array([pa[0], pa[1], 1.0])
                residual = np.linalg.norm(pb - expected_b)
                outlier_motion += residual
            outlier_motion /= outlier_count

        # Direct visual momentum across all tracked features
        displacements = np.linalg.norm(good_b - good_a, axis=1)
        mean_disp = float(np.mean(displacements)) if len(displacements) > 0 else 0.0
        p85_disp = float(np.percentile(displacements, 85)) if len(displacements) > 0 else 0.0
        aggregate_kinetic = min(100, int(round(mean_disp * 18 + p85_disp * 12)))

        subject_energy = min(100, int(round(outlier_ratio * 40 + outlier_motion * 18)))
        decomposed_energy = min(100, int(round(camera_energy * 0.55 + subject_energy * 0.45)))
        total_kinetic_energy = min(100, max(aggregate_kinetic, decomposed_energy))

        if camera_energy < 8 and total_kinetic_energy < 12:
            camera_movement = "Static"
        elif scale_delta > 0.035:
            camera_movement = "Zoom"
        elif total_kinetic_energy > 50:
            camera_movement = "Dynamic / Action"
        elif abs(dx) > 1.8 * max(0.4, abs(dy)):
            camera_movement = "Pan"
        elif abs(dy) > 1.8 * max(0.4, abs(dx)):
            camera_movement = "Tilt"
        elif angle_delta > 0.02 and outlier_ratio > 0.25:
            camera_movement = "Handheld"
        else:
            camera_movement = "Dolly / Track"

        return {
            "cameraMovement": camera_movement,
            "cameraEnergy": camera_energy,
            "subjectEnergy": subject_energy,
            "totalKineticEnergy": total_kinetic_energy,
            "confidence": 0.85,
        }
