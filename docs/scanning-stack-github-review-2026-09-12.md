# Scanning stack: GitHub review, 12 September 2026

## 1. Current state

Selection updated at the user's request: retain widely adopted, mature repositories; remove experimental replacement proposals. For this shortlist, approximately 5,000 GitHub stars is the working minimum, combined with established releases and maintenance. Star counts are rounded GitHub page snapshots checked on 12 September 2026. This threshold applies to proposed scan engines, not an instruction to uninstall supporting libraries.

**The current stack is a useful local baseline, but it is not established as the best available option.** Several accuracy limits come from sampling and custom interpretation rather than the upstream libraries. This review covers EDITMAP_GEMINI's current working tree, including its existing uncommitted changes; it does not describe the separate EDITMAP checkout.

Method: inspected scan implementations and installed package metadata, then checked upstream GitHub repositories, model documentation and published comparisons. No alternative weights were installed, no media was uploaded, and no comparative inference benchmark was run. Recommendations below are engineering judgments and candidates for evaluation, not measured wins on this app.

| Scan | Actual implementation | Assessment |
|---|---|---|
| Shot boundaries | Custom TypeScript HSV differences, 0.25-second sampling, adaptive thresholds, binary boundary refinement | Lightweight, but not the actual PySceneDetect library and not sufficient to establish frame-accurate recall |
| Shot size, people count, content | Ultralytics `yolo11n.pt`, fallback `yolov8n.pt`; hand-written category rules and face/body geometry | Detector is reasonable; cinematic classification is the weaker part |
| Face detection and identity | InsightFace `buffalo_l`, CPU-only ONNX provider; optional dlib/face_recognition fallback | Reasonable baseline, constrained by small input frames and sparse sampling |
| Cast discovery | Midpoint per eligible shot, quality-sorted greedy cosine-centroid clustering | Can miss brief appearances, split identities or merge similar identities |
| Camera/subject motion | OpenCV sparse Lucas–Kanade flow and RANSAC partial affine at 160×90; browser fallback | Suitable for rough energy, insufficient evidence for precise camera-operation labels |
| Eye trace | Largest face, then largest person, then gradient-weighted center bias | Focal-point suggestion, not measured or validated viewer gaze |
| Color | Browser pixel statistics from midpoint thumbnail; separate Python analyzer also exists | Keep lightweight measurement; mood/harmony interpretation is heuristic |
| Dialogue/music/effects | Demucs with MVSEP CDX23 DnR checkpoint `97d170e1-dbb4db15.th`, CPU, chunked processing | Correct cinematic stem targets, but the specific checkpoint fails the adoption filter |
| Waveform/intensity | Browser AudioContext, channel averaging and peak bins | Adequate display baseline; channel cancellation and full-file decoding need attention |

Installed metadata: ultralytics 8.4.146; insightface 2.0; onnxruntime 1.30.0; demucs 4.1.0; torch 2.14.0; opencv-python 5.0.0.93; numpy 2.4.6; Pillow 12.3.0; soundfile 0.14.0. `face-recognition` is not installed. These are environment versions, not proof of model readiness or compatibility. Requirements mostly specify lower bounds rather than a reproducible lock.

## 2. Problem

The clearest implementation bottlenecks are:

1. **Shared analysis images are only 336 pixels wide, JPEG quality 0.75.** A face occupying 2% of the frame width becomes approximately seven pixels wide. A stronger recognition network cannot restore missing facial evidence.
2. **Framing and automatic cast discovery use one midpoint.** Targeted character scanning supports five samples, but that does not extend discovery or framing coverage.
3. **Character eligibility depends on an earlier people classification.** A false `No people` result prevents the discovery pass from looking for faces. A separate helper is less restrictive, so the two paths have different semantics.
4. **Shot size is inferred from geometry.** The classifier uses a Haar frontal-face detector plus hard-coded ratios; its human-size branches never emit AS. Replacing YOLO alone will not supply the missing cinematic taxonomy.
5. **Cut detection can skip evidence.** Four samples per second can miss intervening shots; refinement only helps when coarse samples reveal a candidate. The 0.4-second minimum also suppresses shorter shots by design.
6. **The successful backend motion path analyzes only the first sampled frame pair.** Later movement can go unrepresented. A two-frame affine scale change cannot establish whether the operator zoomed or moved the camera.
7. **The ordinary waveform averages channels before measuring peaks.** Opposite-phase content can cancel. The DME path already uses a stereo-aware peak approach.

## 3. Proposed fix and repository choices

### Retained shortlist

| Repository | Approximate stars | Decision |
|---|---:|---|
| [Ultralytics YOLO](https://github.com/ultralytics/ultralytics) | 61,500 | Keep the established YOLO11 path for people/object detection; improve the current framing interpretation and inputs |
| [InsightFace](https://github.com/deepinsight/insightface) | 29,700 | Keep current recognition family; improve resolution, temporal coverage and matching safeguards |
| [OpenCV](https://github.com/opencv/opencv) | 90,800 | Keep for classical motion, geometry and image processing |
| [FFmpeg](https://github.com/FFmpeg/FFmpeg) | 64,200 | Keep for decoding and bounded audio/video processing |
| [PySceneDetect](https://github.com/Breakthrough/PySceneDetect) | 5,200 | Preferred established library for replacing the custom cut detector, subject to normal integration validation |
| [RF-DETR](https://github.com/roboflow/rf-detr) | 9,500 | Passes popularity filter, but no switch is recommended: existing YOLO is the more conservative choice for this checkout |

Stars indicate community adoption, not accuracy or proof that every checkpoint is mature. Prefer stable releases and the current working model family. No experimental model comparison programme is proposed.

### Existing DME does not fully meet this policy

[Demucs](https://github.com/facebookresearch/demucs) has approximately 10,400 stars, but the repository is archived. More importantly, our speech/music/effects checkpoint is supplied by [MVSEP CDX23](https://github.com/ZFTurbo/MVSEP-CDX23-Cinematic-Sound-Demixing), which has only 59 stars. The framework's star count cannot be attributed to that specialist checkpoint.

Therefore the current DME implementation is **not approved by this conservative shortlist**. No same-purpose replacement meeting both the adoption and maturity requirements was established in this review. Generic Demucs music stems are not equivalent to dialogue/music/effects. Existing application behavior is unchanged by this documentation edit; any removal or replacement is a separate implementation change.

### Removed proposals

Remove OmniShotCut, ShotVL/ShotBench, BandIt/Bandit v2, AdaFace, EdgeFace, SEA-RAFT and DeepGaze from the implementation recommendations. Remove MovieNet and Colour as proposed additions. Remove TransNetV2 from this conservative shortlist: its approximately [1,000 stars](https://github.com/soCzech/TransNetV2) fall below the working cutoff, even though it is an established research model. These removals follow the user's adoption and non-experimental preference; they are not claims that every excluded project is technically poor.

Do not add a separate tracker for now. Keep existing PyTorch, ONNX Runtime and supporting I/O libraries; no runtime migration or new acceleration backend is proposed.

### Concrete conservative improvements

1. Improve face input resolution and sample coverage using the existing InsightFace pipeline.
2. Correct framing taxonomy gaps and uncertainty within the existing YOLO/OpenCV implementation; repository popularity does not make bounding-box geometry a trained cinematic classifier.
3. Use actual PySceneDetect with sequential decoding for cut detection, preserving imported EDL boundaries and manual edits.
4. Aggregate all sampled motion pairs and preserve uncertainty for ambiguous camera movement.
5. Fix stereo waveform cancellation and use the existing FFmpeg backend for bounded extraction where browser decoding is too large.
6. Keep color and focal-point readings lightweight and explicitly estimated. No learned saliency or cinematic VLM additions.

## 4. Files affected

Created this report in the initial review and revised it to enforce the conservative repository shortlist. This follow-up inspected and edited only this report locally, and checked upstream GitHub pages. Application code and dependencies were not changed.

Inspected, in full or relevant portions: `AGENTS.md`, `package.json`, `server/requirements.txt`, `server/README.md`, `server/main.py`, `server/cv_engine.py`, `server/audio_engine.py`, `server/dme_jobs.py`, `server/local_access.py`, `src/analysis/localModel.ts`, `src/analysis/characters.ts`, `src/analysis/characterPresence.ts`, `src/analysis/sceneDetection.ts`, `src/analysis/videoScanner.ts`, `src/analysis/motion.ts`, `src/analysis/cuts.ts`, `src/analysis/colorExtraction.ts`, `src/analysis/colors.ts`, `src/analysis/audio.ts`, `src/analysis/dme.ts`, `src/video/useThumbnails.ts`, `src/components/AllShotsAnalysis.tsx`, `src/components/ShotAnalysis.tsx`, `src/app/App.tsx`, and `scripts/benchmark_cv.py`.

The smallest initial implementation would primarily touch the existing sampler, character scan, CV engine and motion aggregation files. Repository replacements should remain behind the current service interface.

## 5. Risks / edge cases and decision criteria

Use a held-out, manually reviewed film set covering wide/profile/occluded faces, close-ups, groups, dark scenes, long changing shots, rapid cuts, dissolves, camera motion and overlapping speech/music/effects. Measure:

- Boundaries: precision/recall, timing error, hard versus gradual transitions.
- Framing: per-class confusion, macro-F1, uncertainty coverage and human correction rate.
- Characters: missed appearances, false matches, false merges/splits and continuity within shots.
- DME: listening review and stem metrics where clean reference stems exist; waveform usefulness as well as audio fidelity.
- Runtime: end-to-end time including decoding, peak memory, warm/cold start and responsiveness during long scans.

Validate any implemented fix against the current behavior on the same clips. Pin exact packages and checkpoint hashes for reproducibility. Avoid tuning and reporting on the same clips. Keep local-only processing, cancellation, model provenance, existing character IDs and confirmed manual tags. No model download or test suite was needed for this documentation-only review; inference quality and Mac speed remain unmeasured.

## 6. Summary of changes

Retain established YOLO, InsightFace, OpenCV and FFmpeg; recommend PySceneDetect for cuts. Improve the current integration rather than introduce research models. RF-DETR passes the popularity filter but is unnecessary for the conservative plan. DME remains an identified adoption gap because its specialist weights come from a small repository. No code or installed dependencies changed.
