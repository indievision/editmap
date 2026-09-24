import os
import logging
import shutil
import tempfile
from typing import Any, List, Optional
from uuid import UUID
from fastapi import FastAPI, HTTPException, status, UploadFile, File, Form
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel, Field, field_validator, model_validator
from fastapi.responses import JSONResponse
from local_access import LocalAccessMiddleware, SESSION_TOKEN
from threading import Lock
from starlette.concurrency import run_in_threadpool

from cv_engine import ShotClassifier, CharacterRecognizer, ColorAnalyzer, decode_base64_image, EyeTraceAnalyzer, MotionAnalyzer, ModelUnavailableError
from shot_engine import ShotBoundaryDetector
from audio_engine import DmeSeparator
from speech_engine import SpeechEngine
from loudness_engine import LoudnessEngine

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] %(name)s: %(message)s"
)
logger = logging.getLogger("editmap.server")

app = FastAPI(
    title="EDITMAP CV Analysis Engine",
    description="Local Computer Vision Microservice for Film Framing, Cast, and Color Analysis",
    version="1.1.0"
)

app.add_middleware(LocalAccessMiddleware)

# Enable CORS for browser access from Vite dev server
app.add_middleware(
    CORSMiddleware,
    allow_origin_regex=r"https?://(127\.0\.0\.1|localhost)(:\d{1,5})?",
    allow_credentials=False,
    allow_methods=["GET", "POST", "DELETE"],
    allow_headers=["Content-Type", "X-Editmap-Token"],
)


@app.exception_handler(ModelUnavailableError)
async def unavailable_handler(request, error):
    return JSONResponse(status_code=503, content={"detail": str(error), "code": "model_unavailable"})

@app.get("/api/session")
def session():
    return JSONResponse({"token": SESSION_TOKEN}, headers={"Cache-Control": "no-store"})

# Initialize engines
shot_classifier = ShotClassifier()
character_recognizer = CharacterRecognizer()
color_analyzer = ColorAnalyzer()
dme_separator = DmeSeparator()
speech_engine = SpeechEngine()
loudness_engine = LoudnessEngine()
eye_trace_analyzer = EyeTraceAnalyzer(character_recognizer=character_recognizer, shot_classifier=shot_classifier)
motion_analyzer = MotionAnalyzer()
shot_boundary_detector = ShotBoundaryDetector()


# Pre-warm character recognition engine to eliminate first-request latency
try:
    character_recognizer._init_engine()
except Exception as e:
    logger.warning("Could not pre-warm character recognizer: %s", e)

# Keep shared native inference engines single-flight without blocking the ASGI loop.
from functools import wraps
cv_lock = Lock()
def serialized_cv(fn):
    @wraps(fn)
    def wrapped(*args, **kwargs):
        if not cv_lock.acquire(timeout=60):
            raise HTTPException(429, "CV engine is busy. Timeout waiting for previous frame.")
        try:
            return fn(*args, **kwargs)
        finally:
            cv_lock.release()
    return wrapped

# ---------------------------------------------------------------------------
# Pydantic Schemas
# ---------------------------------------------------------------------------

class AnalyzeShotRequest(BaseModel):
    image: str = Field(..., description="Base64 encoded video frame", max_length=8 * 1024 * 1024)
    images: List[str] = Field(default_factory=list, max_length=3)


class AnalyzeShotResponse(BaseModel):
    shotSize: str
    composition: str
    content: str
    uncertain: bool
    model: str = "CinemaCLIP-1.0.0:shot.framing"
    framingConfidence: Optional[float] = Field(default=None, ge=0, le=1)


class CastReference(BaseModel):
    id: str
    image: str = Field(max_length=8 * 1024 * 1024)
    shotId: Optional[str] = None
    time: Optional[float] = None


class CastMember(BaseModel):
    id: str
    name: str
    references: List[CastReference] = Field(default_factory=list, max_length=16)


class AnalyzeCharactersRequest(BaseModel):
    image: str = Field(..., description="Base64 encoded video frame", max_length=8 * 1024 * 1024)
    cast: List[CastMember] = Field(default_factory=list, max_length=200)


class AnalyzeCharactersResponse(BaseModel):
    appearances: List[str]
    unresolved: bool


class DetectedFace(BaseModel):
    embedding: List[float]
    bbox: List[int]
    score: float
    crop: str
    area: int
    time: Optional[float] = None


class DetectShotFacesRequest(BaseModel):
    image: str = Field(..., description="Base64 encoded video frame", max_length=8 * 1024 * 1024)
    shotId: Optional[str] = None
    time: Optional[float] = None


class DetectShotFacesResponse(BaseModel):
    faces: List[DetectedFace]
    shotId: Optional[str] = None
    time: Optional[float] = None


class TrackedFrame(BaseModel):
    image: str = Field(..., max_length=8 * 1024 * 1024)
    time: float = Field(ge=0, allow_inf_nan=False)


class TrackShotFacesRequest(BaseModel):
    shotId: Optional[str] = None
    frames: List[TrackedFrame] = Field(min_length=1, max_length=5)


class TrackedFace(DetectedFace):
    trackId: str
    time: float


class TrackShotFacesResponse(BaseModel):
    faces: List[TrackedFace]
    shotId: Optional[str] = None


class FaceSample(BaseModel):
    shotId: str
    time: float = Field(ge=0, allow_inf_nan=False)
    embedding: List[float] = Field(min_length=128, max_length=512)
    crop: str = Field(max_length=256 * 1024)
    score: float = Field(default=1.0, ge=0, le=1, allow_inf_nan=False)
    area: int = Field(default=100, ge=1, le=16_000_000)
    trackId: Optional[str] = None

    @field_validator("embedding")
    @classmethod
    def valid_embedding(cls, values):
        import math
        if len(values) not in (128, 512) or not all(math.isfinite(x) for x in values) or sum(x*x for x in values) < 1e-12:
            raise ValueError("Expected a finite nonzero 128- or 512-dimensional embedding")
        return values


class ClusterFacesRequest(BaseModel):
    faces: List[FaceSample] = Field(max_length=10000)
    existingCast: List[CastMember] = Field(default_factory=list, max_length=200)
    # Leave this unset for the recognizer's engine-aware default. A caller may
    # still provide a value when it has a calibrated threshold for its footage.
    similarityThreshold: Optional[float] = Field(default=None, ge=0, le=1, allow_inf_nan=False)
    minAppearances: int = Field(default=1, ge=1, le=10000)

    @model_validator(mode="after")
    def compatible_embeddings(self):
        if len({len(f.embedding) for f in self.faces}) > 1:
            raise ValueError("Cannot mix face embedding engines")
        return self


class DiscoveredCharacterAppearance(BaseModel):
    shotId: str
    time: float


class DiscoveredCharacter(BaseModel):
    id: str
    name: str
    avatar: str
    shotId: str
    time: float
    appearances: List[DiscoveredCharacterAppearance]


class ClusterFacesResponse(BaseModel):
    characters: List[DiscoveredCharacter]
    totalFaces: int
    unassignedFaces: int


class ColorHarmonyResponse(BaseModel):
    type: str
    label: str
    confidence: float
    dominantHue: int


class AnalyzeColorRequest(BaseModel):
    image: str = Field(..., description="Base64 encoded video frame", max_length=8 * 1024 * 1024)


class AnalyzeColorResponse(BaseModel):
    palette: List[str]
    luminance: float
    temperature: float
    saturation: float
    mood: str
    harmony: ColorHarmonyResponse


class DmeResponse(BaseModel):
    dialogue: List[float]
    music: List[float]
    effects: List[float]
    duration: float
    binCount: int
    sampleRate: int


class FocalPointResponse(BaseModel):
    x: float
    y: float
    type: str
    confidence: float


class AnalyzeEyeTraceRequest(BaseModel):
    outgoingImage: str = Field(..., max_length=8 * 1024 * 1024, description="Base64 encoded outgoing video frame")
    incomingImage: str = Field(..., max_length=8 * 1024 * 1024, description="Base64 encoded incoming video frame")


class AnalyzeEyeTraceResponse(BaseModel):
    outgoingFocalPoint: FocalPointResponse
    incomingFocalPoint: FocalPointResponse
    jumpDistance: float
    jumpDistancePercent: int
    rating: str
    screenDirection: str


class AnalyzeMotionRequest(BaseModel):
    frameA: str = Field(..., max_length=8 * 1024 * 1024, description="Base64 encoded frame A")
    frameB: str = Field(..., max_length=8 * 1024 * 1024, description="Base64 encoded frame B")


class AnalyzeMotionResponse(BaseModel):
    cameraMovement: str
    cameraEnergy: int
    subjectEnergy: int
    totalKineticEnergy: int
    confidence: float


class DetectShotsRequest(BaseModel):
    video_path: str = Field(..., description="Absolute file path to the input video")
    threshold: float = Field(default=0.5, ge=0.0, le=1.0)
    min_shot_len_frames: int = Field(default=10, ge=1, le=10000)


class ShotIntervalResponse(BaseModel):
    shot_index: int
    start_frame: int
    end_frame: int
    start_seconds: float
    end_seconds: float
    confidence: float
    transition_type: str = "cut"


class DetectShotsResponse(BaseModel):
    status: str = "success"
    video_path: str
    total_shots: int
    fps: float
    model_backend: str
    shots: List[ShotIntervalResponse]


class DetectShotsStatusResponse(BaseModel):
    available: bool
    model_backend: Optional[str] = None


# ---------------------------------------------------------------------------
# Endpoints
# ---------------------------------------------------------------------------

@app.get("/api/health")
@app.get("/health")
def health_check():
    return {
        "status": "ok",
        "service": "editmap-cv-engine",
        "version": "1.1.0",
        "engines": {
            "framing": {"status": "unavailable" if shot_classifier.framing_classifier.last_error else "ready" if shot_classifier.framing_classifier._model is not None else "not_loaded", "model": shot_classifier.framing_classifier.model_name, "error": shot_classifier.framing_classifier.last_error},
            "characters": {"status": "unavailable" if character_recognizer.last_error else "ready" if character_recognizer._engine is not None else "not_loaded", "model": character_recognizer._engine_type or "insightface", "error": character_recognizer.last_error},
            "dme": {"status": "ready" if dme_separator.model is not None else "not_loaded", "model": "demucs-dnr"},
            "speech": {"status": "ready" if speech_engine.session is not None else "not_loaded", "model": "silero-vad", "version": "6.2.0"},
            "loudness": {"status": "ready", "model": "ffmpeg-ebur128", "version": "EBU-R128-BS.1770-4"},
            "shots": {"status": "ready", "model": "transnetv2", "backend": shot_boundary_detector.model.backend or "heuristic"},
        }
    }


@app.post("/api/detect-shots", response_model=DetectShotsResponse)
async def detect_shots(req: DetectShotsRequest):
    if not os.path.isfile(req.video_path):
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"Video file not found: {req.video_path}"
        )

    try:
        result = await run_in_threadpool(
            shot_boundary_detector.detect_shots,
            video_path=req.video_path,
            threshold=req.threshold,
            min_shot_len_frames=req.min_shot_len_frames
        )
        return DetectShotsResponse(**result)
    except (FileNotFoundError, ValueError) as e:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(e))
    except ModelUnavailableError:
        raise
    except Exception as e:
        logger.error("Error detecting shot boundaries: %s", e)
        raise HTTPException(status_code=status.HTTP_500_INTERNAL_SERVER_ERROR, detail=str(e))


@app.get("/api/detect-shots-status", response_model=DetectShotsStatusResponse)
def detect_shots_status():
    """Let the browser select the detector before it uploads a whole video."""
    return DetectShotsStatusResponse(
        available=shot_boundary_detector.pretrained_weights_available(),
        model_backend=shot_boundary_detector.model.backend,
    )


@app.post("/api/detect-shots-upload", response_model=DetectShotsResponse)
async def detect_shots_upload(
    file: UploadFile = File(...),
    threshold: float = Form(0.5, ge=0.0, le=1.0),
    min_shot_len_frames: int = Form(10, ge=1, le=10000),
):
    """Run TransNet V2 over a browser-selected local video without accepting a path."""
    suffix = os.path.splitext(file.filename or "")[1].lower()
    if not suffix or len(suffix) > 12 or not suffix[1:].isalnum():
        suffix = ".mp4"
    temp_path = ""
    try:
        if not shot_boundary_detector.pretrained_weights_available():
            raise HTTPException(status_code=status.HTTP_503_SERVICE_UNAVAILABLE, detail="TransNet V2 weights are not available locally.")
        with tempfile.NamedTemporaryFile(prefix="editmap-shots-", suffix=suffix, delete=False) as temp:
            temp_path = temp.name
            await run_in_threadpool(shutil.copyfileobj, file.file, temp)
        result = await run_in_threadpool(
            shot_boundary_detector.detect_shots,
            video_path=temp_path,
            threshold=threshold,
            min_shot_len_frames=min_shot_len_frames,
        )
        # The temporary name is implementation detail, never project evidence.
        result["video_path"] = file.filename or "local-video"
        return DetectShotsResponse(**result)
    except (FileNotFoundError, ValueError) as e:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(e))
    except HTTPException:
        raise
    except Exception as e:
        logger.error("Error detecting uploaded shot boundaries: %s", e)
        raise HTTPException(status_code=status.HTTP_500_INTERNAL_SERVER_ERROR, detail=str(e))
    finally:
        await file.close()
        if temp_path:
            try:
                os.unlink(temp_path)
            except FileNotFoundError:
                pass


@app.post("/api/analyze-shot", response_model=AnalyzeShotResponse)
@serialized_cv
def analyze_shot(req: AnalyzeShotRequest):
    try:
        images = [decode_base64_image(image) for image in (req.images or [req.image])]
    except Exception as e:
        logger.error("Failed to decode image: %s", e)
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"Invalid base64 image data: {str(e)}"
        )

    try:
        result = shot_classifier.analyze_frames(images)
        return AnalyzeShotResponse(**result)
    except ModelUnavailableError:
        raise
    except Exception as e:
        logger.error("Error analyzing shot: %s", e)
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"Shot analysis failed: {str(e)}"
        )


@app.post("/api/analyze-characters", response_model=AnalyzeCharactersResponse)
@serialized_cv
def analyze_characters(req: AnalyzeCharactersRequest):
    try:
        img = decode_base64_image(req.image)
    except Exception as e:
        logger.error("Failed to decode image: %s", e)
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"Invalid base64 image data: {str(e)}"
        )

    try:
        cast_dicts = [member.model_dump() for member in req.cast]
        result = character_recognizer.analyze(img, cast_dicts)
        return AnalyzeCharactersResponse(**result)
    except ModelUnavailableError:
        raise
    except Exception as e:
        logger.error("Error analyzing characters: %s", e)
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"Character analysis failed: {str(e)}"
        )


@app.post("/api/detect-shot-faces", response_model=DetectShotFacesResponse)
@serialized_cv
def detect_shot_faces(req: DetectShotFacesRequest):
    try:
        img = decode_base64_image(req.image)
    except Exception as e:
        logger.error("Failed to decode image: %s", e)
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"Invalid base64 image data: {str(e)}"
        )

    try:
        faces_data = character_recognizer.extract_faces_with_crops(img)
        faces = [DetectedFace(**f) for f in faces_data]
        return DetectShotFacesResponse(faces=faces, shotId=req.shotId, time=req.time)
    except ModelUnavailableError:
        raise
    except Exception as e:
        logger.error("Error detecting shot faces: %s", e)
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"Face extraction failed: {str(e)}"
        )


@app.post("/api/track-shot-faces", response_model=TrackShotFacesResponse)
@serialized_cv
def track_shot_faces(req: TrackShotFacesRequest):
    """Associate face detections across ordered samples from one shot only."""
    try:
        frames = [(decode_base64_image(frame.image), frame.time) for frame in req.frames]
    except Exception as e:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=f"Invalid tracking frame: {str(e)}")
    try:
        faces_data = character_recognizer.track_faces_across_frames(frames)
        return TrackShotFacesResponse(faces=[TrackedFace(**face) for face in faces_data], shotId=req.shotId)
    except ModelUnavailableError:
        raise
    except Exception as e:
        logger.error("Error tracking shot faces: %s", e)
        raise HTTPException(status_code=status.HTTP_500_INTERNAL_SERVER_ERROR, detail=f"Face tracking failed: {str(e)}")


@app.post("/api/cluster-faces", response_model=ClusterFacesResponse)
@serialized_cv
def cluster_faces(req: ClusterFacesRequest):
    try:
        face_dicts = [face.model_dump() for face in req.faces]
        result = character_recognizer.cluster_faces(
            face_dicts,
            similarity_threshold=req.similarityThreshold,
            min_appearances=req.minAppearances,
            existing_cast=[member.model_dump() for member in req.existingCast],
        )
        return ClusterFacesResponse(**result)
    except ModelUnavailableError:
        raise
    except Exception as e:
        logger.error("Error clustering faces: %s", e)
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"Face clustering failed: {str(e)}"
        )


@app.post("/api/analyze-color", response_model=AnalyzeColorResponse)
@serialized_cv
def analyze_color(req: AnalyzeColorRequest):
    try:
        img = decode_base64_image(req.image)
    except Exception as e:
        logger.error("Failed to decode image: %s", e)
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"Invalid base64 image data: {str(e)}"
        )

    try:
        result = color_analyzer.analyze(img)
        return AnalyzeColorResponse(**result)
    except ModelUnavailableError:
        raise
    except Exception as e:
        logger.error("Error analyzing color: %s", e)
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"Color analysis failed: {str(e)}"
        )


@app.post("/api/analyze-eye-trace", response_model=AnalyzeEyeTraceResponse)
@serialized_cv
def analyze_eye_trace(req: AnalyzeEyeTraceRequest):
    try:
        outgoing_img = decode_base64_image(req.outgoingImage)
        incoming_img = decode_base64_image(req.incomingImage)
    except Exception as e:
        logger.error("Failed to decode images for eye-trace analysis: %s", e)
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"Invalid base64 image data: {str(e)}"
        )

    try:
        result = eye_trace_analyzer.analyze_cut(outgoing_img, incoming_img)
        return AnalyzeEyeTraceResponse(**result)
    except ModelUnavailableError:
        raise
    except Exception as e:
        logger.error("Error analyzing eye-trace: %s", e)
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"Eye-trace analysis failed: {str(e)}"
        )


@app.post("/api/analyze-motion", response_model=AnalyzeMotionResponse)
@serialized_cv
def analyze_motion(req: AnalyzeMotionRequest):
    try:
        img_a = decode_base64_image(req.frameA)
        img_b = decode_base64_image(req.frameB)
    except Exception as e:
        logger.error("Failed to decode frames for motion analysis: %s", e)
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"Invalid base64 frame data: {str(e)}"
        )

    try:
        result = motion_analyzer.analyze_motion(img_a, img_b)
        return AnalyzeMotionResponse(**result)
    except ModelUnavailableError:
        raise
    except Exception as e:
        logger.error("Error analyzing motion: %s", e)
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"Motion analysis failed: {str(e)}"
        )


@app.get("/api/dme-status")
def dme_status():
    return {
        "status": "ready" if dme_separator.model is not None else "available",
        "device": dme_separator.device,
        "modelLoaded": dme_separator.model is not None,
    }


from dme_jobs import DmeJobs
jobs = DmeJobs(dme_separator)
from speech_jobs import SpeechJobs
speech_jobs = SpeechJobs(speech_engine)
from loudness_jobs import LoudnessJobs
loudness_jobs = LoudnessJobs(loudness_engine)

@app.post("/api/separate-dme", status_code=202)
async def separate_dme(file: UploadFile = File(...), binCount: int = Form(1400, ge=1, le=10000), jobId: Optional[UUID] = Form(None)):
    return await run_in_threadpool(jobs.start, file.file, binCount, str(jobId) if jobId else None)

@app.get("/api/dme-jobs/{job_id}")
def dme_job(job_id: str):
    return jobs.status(job_id)

@app.delete("/api/dme-jobs/{job_id}")
def cancel_dme_job(job_id: UUID):
    return jobs.cancel(str(job_id))

@app.post("/api/scan-speech", status_code=202)
async def scan_speech(file: UploadFile = File(...), jobId: Optional[UUID] = Form(None)):
    return await run_in_threadpool(speech_jobs.start, file.file, str(jobId) if jobId else None)

@app.get("/api/speech-jobs/{job_id}")
def speech_job(job_id: str):
    return speech_jobs.status(job_id)

@app.delete("/api/speech-jobs/{job_id}")
def cancel_speech_job(job_id: UUID):
    return speech_jobs.cancel(str(job_id))

@app.post("/api/scan-loudness", status_code=202)
async def scan_loudness(file: UploadFile = File(...), binCount: int = Form(1400, ge=1, le=10000), jobId: Optional[UUID] = Form(None)):
    return await run_in_threadpool(loudness_jobs.start, file.file, str(jobId) if jobId else None, binCount)

@app.get("/api/loudness-jobs/{job_id}")
def loudness_job(job_id: str):
    return loudness_jobs.status(job_id)

@app.delete("/api/loudness-jobs/{job_id}")
def cancel_loudness_job(job_id: UUID):
    return loudness_jobs.cancel(str(job_id))


if __name__ == "__main__":
    import uvicorn
    uvicorn.run("main:app", host="127.0.0.1", port=8000, reload=True)
