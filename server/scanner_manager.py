import datetime
from typing import Any, Dict, List, Optional
from pydantic import BaseModel
import logging

logger = logging.getLogger("editmap.scanners")

class ScannerEngineInfo(BaseModel):
    id: str
    name: str
    model: str
    version: Optional[str] = None
    status: str  # "ready", "not_loaded", "unavailable"
    description: str
    error: Optional[str] = None

class ScannersStatusResponse(BaseModel):
    service: str = "editmap-cv-engine"
    version: str = "1.1.0"
    updateAvailable: bool = False
    latestVersion: str = "1.1.0"
    lastChecked: str
    engines: List[ScannerEngineInfo]

class ScannerUpdateRequest(BaseModel):
    checkOnly: bool = False

class ScannerUpdateResponse(BaseModel):
    success: bool
    message: str
    updated: bool
    version: str
    engines: List[ScannerEngineInfo]

def collect_scanner_engines(
    shot_classifier: Any,
    character_recognizer: Any,
    dme_separator: Any,
    speech_engine: Any,
    loudness_engine: Any,
    shot_boundary_detector: Any,
) -> List[ScannerEngineInfo]:
    framing_status = (
        "unavailable"
        if getattr(shot_classifier.framing_classifier, "last_error", None)
        else "ready"
        if getattr(shot_classifier.framing_classifier, "_model", None) is not None
        else "not_loaded"
    )
    framing_error = getattr(shot_classifier.framing_classifier, "last_error", None)
    framing_model = getattr(shot_classifier.framing_classifier, "model_name", "CinemaCLIP-1.0.0:shot.framing")

    character_status = (
        "unavailable"
        if getattr(character_recognizer, "last_error", None)
        else "ready"
        if getattr(character_recognizer, "_engine", None) is not None
        else "not_loaded"
    )
    character_error = getattr(character_recognizer, "last_error", None)
    character_model = getattr(character_recognizer, "_engine_type", None) or "insightface (512-dim ArcFace)"

    dme_status = "ready" if getattr(dme_separator, "model", None) is not None else "not_loaded"
    speech_status = "ready" if getattr(speech_engine, "session", None) is not None else "not_loaded"
    shots_backend = getattr(shot_boundary_detector.model, "backend", None) or "heuristic"

    return [
        ScannerEngineInfo(
            id="framing",
            name="Framing & Composition",
            model=framing_model,
            version="1.0.0",
            status=framing_status,
            description="Analyzes shot scale (ECU to ELS), headroom, and compositional balance using CinemaCLIP cinematic vision.",
            error=framing_error,
        ),
        ScannerEngineInfo(
            id="characters",
            name="Cast & Face Recognition",
            model=character_model,
            version="0.7.3",
            status=character_status,
            description="512-dimensional normalized ArcFace facial embeddings for auto-discovering cast and tracking screen presence.",
            error=character_error,
        ),
        ScannerEngineInfo(
            id="shots",
            name="Scene Cut Detector",
            model=f"TransNetV2 ({shots_backend})",
            version="2.0",
            status="ready",
            description="Frame-accurate transition, jump-cut, and hard-cut detector.",
        ),
        ScannerEngineInfo(
            id="dme",
            name="Audio DME Separator",
            model="Demucs DNR v4",
            version="4.0.0",
            status=dme_status,
            description="Neural audio stem separation isolating dialogue, music, and sound effects rivers.",
        ),
        ScannerEngineInfo(
            id="speech",
            name="Speech & Voice Activity",
            model="Silero VAD",
            version="6.2.0",
            status=speech_status,
            description="Sub-millisecond speech detection identifying dialogue pauses and rhythm pacing.",
        ),
        ScannerEngineInfo(
            id="loudness",
            name="Loudness Dynamics",
            model="EBU R128 (BS.1770-4)",
            version="1.0.0",
            status="ready",
            description="Broadcast-grade integrated loudness, momentary spikes, and acoustic dynamic range.",
        ),
    ]

def perform_scanner_update(
    shot_classifier: Any,
    character_recognizer: Any,
    dme_separator: Any,
    speech_engine: Any,
    loudness_engine: Any,
    shot_boundary_detector: Any,
) -> ScannerUpdateResponse:
    logger.info("Performing scanner model verification and update check...")

    # 1. Warm/verify character recognizer if needed
    try:
        if getattr(character_recognizer, "_engine", None) is None:
            character_recognizer._init_engine()
    except Exception as err:
        logger.warning("Character recognizer re-init warning: %s", err)

    engines = collect_scanner_engines(
        shot_classifier,
        character_recognizer,
        dme_separator,
        speech_engine,
        loudness_engine,
        shot_boundary_detector,
    )

    # Nothing is downloaded or upgraded here: this only re-checks readiness.
    problems = [e for e in engines if e.status == "unavailable"]
    if problems:
        message = "Some engines are unavailable: " + "; ".join(
            f"{e.name} ({e.error or 'unknown error'})" for e in problems
        )
    else:
        not_loaded = [e.name for e in engines if e.status == "not_loaded"]
        message = "No problems found. Models load on first use" + (f" ({', '.join(not_loaded)} not loaded yet)." if not_loaded else ".")

    return ScannerUpdateResponse(
        success=not problems,
        message=message,
        updated=False,
        version="1.1.0",
        engines=engines,
    )
