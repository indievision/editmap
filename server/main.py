import os
import logging
from typing import Any, List, Optional
from fastapi import FastAPI, HTTPException, status, UploadFile, File, Form
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel, Field

from cv_engine import ShotClassifier, CharacterRecognizer, ColorAnalyzer, decode_base64_image, EyeTraceAnalyzer, MotionAnalyzer
from audio_engine import DmeSeparator

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

# Enable CORS for browser access from Vite dev server
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Initialize engines
shot_classifier = ShotClassifier()
character_recognizer = CharacterRecognizer()
color_analyzer = ColorAnalyzer()
dme_separator = DmeSeparator()
eye_trace_analyzer = EyeTraceAnalyzer(character_recognizer=character_recognizer, shot_classifier=shot_classifier)
motion_analyzer = MotionAnalyzer()


# ---------------------------------------------------------------------------
# Pydantic Schemas
# ---------------------------------------------------------------------------

class AnalyzeShotRequest(BaseModel):
    image: str = Field(..., description="Base64 encoded video frame")


class AnalyzeShotResponse(BaseModel):
    shotSize: str
    composition: str
    content: str
    uncertain: bool


class CastReference(BaseModel):
    id: str
    image: str
    shotId: Optional[str] = None
    time: Optional[float] = None


class CastMember(BaseModel):
    id: str
    name: str
    references: List[CastReference] = []


class AnalyzeCharactersRequest(BaseModel):
    image: str = Field(..., description="Base64 encoded video frame")
    cast: List[CastMember] = []


class AnalyzeCharactersResponse(BaseModel):
    appearances: List[str]
    unresolved: bool


class DetectedFace(BaseModel):
    embedding: List[float]
    bbox: List[int]
    score: float
    crop: str
    area: int


class DetectShotFacesRequest(BaseModel):
    image: str = Field(..., description="Base64 encoded video frame")
    shotId: Optional[str] = None
    time: Optional[float] = None


class DetectShotFacesResponse(BaseModel):
    faces: List[DetectedFace]
    shotId: Optional[str] = None
    time: Optional[float] = None


class FaceSample(BaseModel):
    shotId: str
    time: float
    embedding: List[float]
    crop: str
    score: Optional[float] = 1.0
    area: Optional[int] = 100


class ClusterFacesRequest(BaseModel):
    faces: List[FaceSample]
    similarityThreshold: Optional[float] = 0.50
    minAppearances: Optional[int] = 1


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
    image: str = Field(..., description="Base64 encoded video frame")


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
    outgoingImage: str = Field(..., description="Base64 encoded outgoing video frame")
    incomingImage: str = Field(..., description="Base64 encoded incoming video frame")


class AnalyzeEyeTraceResponse(BaseModel):
    outgoingFocalPoint: FocalPointResponse
    incomingFocalPoint: FocalPointResponse
    jumpDistance: float
    jumpDistancePercent: int
    rating: str
    screenDirection: str


class AnalyzeMotionRequest(BaseModel):
    frameA: str = Field(..., description="Base64 encoded frame A")
    frameB: str = Field(..., description="Base64 encoded frame B")


class AnalyzeMotionResponse(BaseModel):
    cameraMovement: str
    cameraEnergy: int
    subjectEnergy: int
    totalKineticEnergy: int
    confidence: float


# ---------------------------------------------------------------------------
# Endpoints
# ---------------------------------------------------------------------------

@app.get("/health")
def health_check():
    return {
        "status": "ok",
        "service": "editmap-cv-engine",
        "version": "1.0.0"
    }


@app.post("/api/analyze-shot", response_model=AnalyzeShotResponse)
def analyze_shot(req: AnalyzeShotRequest):
    try:
        img = decode_base64_image(req.image)
    except Exception as e:
        logger.error("Failed to decode image: %s", e)
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"Invalid base64 image data: {str(e)}"
        )

    try:
        result = shot_classifier.analyze(img)
        return AnalyzeShotResponse(**result)
    except Exception as e:
        logger.error("Error analyzing shot: %s", e)
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"Shot analysis failed: {str(e)}"
        )


@app.post("/api/analyze-characters", response_model=AnalyzeCharactersResponse)
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
    except Exception as e:
        logger.error("Error analyzing characters: %s", e)
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"Character analysis failed: {str(e)}"
        )


@app.post("/api/detect-shot-faces", response_model=DetectShotFacesResponse)
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
    except Exception as e:
        logger.error("Error detecting shot faces: %s", e)
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"Face extraction failed: {str(e)}"
        )


@app.post("/api/cluster-faces", response_model=ClusterFacesResponse)
def cluster_faces(req: ClusterFacesRequest):
    try:
        face_dicts = [face.model_dump() for face in req.faces]
        result = character_recognizer.cluster_faces(
            face_dicts,
            similarity_threshold=req.similarityThreshold,
            min_appearances=req.minAppearances or 1,
        )
        return ClusterFacesResponse(**result)
    except Exception as e:
        logger.error("Error clustering faces: %s", e)
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"Face clustering failed: {str(e)}"
        )


@app.post("/api/analyze-color", response_model=AnalyzeColorResponse)
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
    except Exception as e:
        logger.error("Error analyzing color: %s", e)
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"Color analysis failed: {str(e)}"
        )


@app.post("/api/analyze-eye-trace", response_model=AnalyzeEyeTraceResponse)
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
    except Exception as e:
        logger.error("Error analyzing eye-trace: %s", e)
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"Eye-trace analysis failed: {str(e)}"
        )


@app.post("/api/analyze-motion", response_model=AnalyzeMotionResponse)
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


@app.post("/api/separate-dme", response_model=DmeResponse)
async def separate_dme(
    file: Optional[UploadFile] = File(None),
    filepath: Optional[str] = Form(None),
    binCount: int = Form(1400)
):
    import tempfile
    import shutil
    target_path = None
    temp_dir = None

    try:
        if file is not None and file.filename:
            temp_dir = tempfile.mkdtemp(prefix="editmap_dme_")
            suffix = os.path.splitext(file.filename)[1] or ".mp4"
            target_path = os.path.join(temp_dir, f"upload{suffix}")
            with open(target_path, "wb") as buffer:
                shutil.copyfileobj(file.file, buffer)
        elif filepath:
            if not os.path.isfile(filepath):
                raise HTTPException(
                    status_code=status.HTTP_404_NOT_FOUND,
                    detail=f"File not found on server: {filepath}"
                )
            target_path = filepath
        else:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="Either 'file' upload or 'filepath' form field must be provided."
            )

        logger.info("Separating DME for %s with binCount=%d", target_path, binCount)
        results = dme_separator.separate(target_path, bin_count=binCount)
        return DmeResponse(**results)
    except HTTPException:
        raise
    except Exception as e:
        logger.error("Error separating DME stems: %s", e, exc_info=True)
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"DME stem separation failed: {str(e)}"
        )
    finally:
        if temp_dir and os.path.exists(temp_dir):
            shutil.rmtree(temp_dir, ignore_errors=True)


if __name__ == "__main__":
    import uvicorn
    uvicorn.run("main:app", host="127.0.0.1", port=8000, reload=True)
