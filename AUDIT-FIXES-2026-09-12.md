# EDITMAP audit fixes — 12 September 2026

## 1. Current state

Implemented incremental fixes in the existing React/TypeScript and FastAPI application. Preserved the user's pre-existing working-tree changes, including the squint UI and visual styling. No dependencies were added, no source features were replaced with a new architecture, and no commit was created.

## 2. Problems addressed

- Backup import discarded color, motion, DME, eye-trace, suggestion metadata, camera-movement protection, and operational failures.
- Rediscovery replaced cast identities/names and could invalidate confirmed references.
- Missing inference engines appeared to succeed with empty detections.
- DME blocked the event loop, retained full-film tensors, lacked cancellation, and could apply stale results.
- An unsupported focal-point literal broke production builds.
- Discovery silently skipped errors and expanded midpoint evidence to whole-shot presence; scan entry points disagreed about recovery and completion.
- Person bounding-box height was treated as sufficient evidence for close-up framing.
- Local endpoints allowed arbitrary browser origins/local file paths and insufficiently bounded input.
- Model provenance/setup documentation and browser selectors were stale.
- Browser verification additionally exposed narrow-header overflow and a cut handle hidden behind the playhead's hit area.

## 3. Implemented fixes

### Data preservation

Extended bounded backup validation to cover all current persisted analysis fields. Added full-object round-trip coverage and rejection of invalid new fields. Existing version-1 backups remain supported. Cast restoration rejects duplicate IDs and dangling manual character references.

Clusters now use UUIDs for new identities and reconcile against existing reference embeddings conservatively. Confident matches retain the existing ID and name; ambiguous matches remain new suggestions. The frontend merges cast records without overwriting existing names/references and preserves confirmed character evidence.

### Analysis and recovery

Missing YOLO/recognition engines return explicit errors (503) and readiness exposes per-engine state. Framing responses include actual model provenance. Unknown or geometry-only framing remains uncertain. Full-body geometry no longer automatically becomes a close-up; the classifier uses face evidence where available and returns Unknown for ambiguous clipped bodies.

Discovery records retryable errors, validates responses, uses request deadlines, and retains successful samples in a per-media in-memory checkpoint for Resume. Midpoint detections are temporal markers. Targeted scans retain failed shots in their queue and show Resume while idle.

Full analysis of existing shots shares the same framing queue as the step-by-step workflow. Header Analyze opens that workflow for an existing timeline, preserving imported boundaries. New-film detection checkpoints its timeline and completed framing, reports failure counts, aborts on replacement/relink/undo, and does not overwrite concurrent human edits at final assembly. Frame samplers clean up on load failure and avoid waiting for a seek event when already at the requested time.

### Backend and audio

Added loopback origin/host checks, per-process session tokens, streamed request limits, image/embedding validation, and a bounded reference cache. All frontend CV callers use the same authenticated transport. CV inference is single-flight to protect shared native engines. Removed browser-supplied arbitrary local file paths.

DME uses one background worker with a job ID, progress and cooperative cancellation. Client-generated job IDs make submission idempotent and permit cancellation before upload completes. Project/media guards reject stale results. Processing uses 30-second audio interiors with context instead of full-film tensors; stereo peaks avoid opposite-phase cancellation. Jobs have bounded retained results, FFmpeg deadlines, an 8 GB upload limit and a four-hour media limit. Temporary files are cleaned after completion/failure/cancellation.

### UI and maintenance

Added compact local CV readiness text, truthful failure/completion counts, working Resume and DME Cancel controls. Wrapped existing header controls on narrow screens. Raised cut handles above the playhead within the shot track so parked playheads do not prevent cut selection. Updated setup/provenance docs and selectors to the current UI without removing the original interaction assertions.

## 4. Files inspected and changed

The original inspection inventory remains in `AUDIT-2026-09-12.md`. Implementation additionally inspected `src/components/ShotInspector.tsx`, `src/components/ReviewFilters.tsx`, `src/analysis/review.ts`, `src/analysis/colorExtraction.ts`, and the existing benchmark manifest/results. These additional inspection-only files were not changed.

Application/backend files changed:

- `src/storage/backup.ts`
- `src/models/project.ts`
- `src/analysis/characters.ts`
- `src/analysis/cuts.ts`
- `src/analysis/dme.ts`
- `src/analysis/localModel.ts`
- `src/analysis/motion.ts`
- `src/app/App.tsx`
- `src/app/styles.css` (targeted header and cut-hit-area additions only; earlier user styling preserved)
- `src/components/AllShotsAnalysis.tsx`
- `src/components/ShotAnalysis.tsx`
- `src/timeline/EditingMap.tsx`
- `server/main.py`
- `server/cv_engine.py`
- `server/audio_engine.py`

New backend helpers: `server/local_access.py`, `server/dme_jobs.py`.

Tests changed: `tests/backup.test.ts`, `tests/characters.test.ts`, `tests/dme.test.ts`, `tests/browser/analysis.spec.ts`, `tests/browser/bulk-analysis.spec.ts`, `tests/browser/review-filters.spec.ts`, `tests/browser/workflow.spec.ts`, `tests/browser/workspace-modes.spec.ts`.

Tests added: `server/test_api.py`, `tests/browser/reliability.spec.ts`.

Docs changed: `AGENTS.md`, `README.md`, `server/README.md`; this implementation report was added. Added `scripts/benchmark_cv.py` and generated a separate ignored benchmark artifact, `benchmark/cv-audit-2026-09-12.json`. Existing benchmark images, labels, and predictions were not changed.

## 5. Verification and limits

- Production build: passed.
- Unit suite: 74 passed.
- Backend suite: 8 passed, including unavailable engines, access controls, malformed payloads, stable identity reconciliation, responsive/cancellable DME jobs, cancellation before upload, and chunk-boundary/stereo peak preservation.
- Complete browser suite: 26 passed. After the final new-film lifecycle changes, the 11 affected bulk/reliability tests passed, including a newly added failure-count scenario. This covers 27 distinct browser scenarios overall.
- Real Vite → backend handshake/readiness: passed, including after restarting the service with the final code.
- Real YOLO framing: successful fixture response, approximately 1.93 seconds including cold setup.
- Real InsightFace detection: successful empty detection on the synthetic fixture, approximately 1.19 seconds. This demonstrates functioning inference, not identity accuracy.
- Real Demucs job: generated one-second stereo tone processed successfully; duration 1.0, 20 bins, approximately 2.02 seconds.
- Existing 40-frame benchmark: zero request failures; median approximately 0.050 seconds/frame and total approximately 1.883 seconds on a warm service. This excludes video decoding and is not a long-film throughput result. Raw predictions and timing are retained separately.
- `git diff --check`: passed.

Framing/identity accuracy remains uncalibrated against per-frame human labels in this run. The conservative geometry change fixes an invalid inference rule; it is not a claim of a trained framing classifier's accuracy. New uncertain identities require review/merge. DME cancellation waits for current model initialization/inference to yield; it does not forcibly kill native inference. Discovery checkpoints are in memory for the current media session; failure annotations persist, but face-sample checkpoints do not survive reload. Data already discarded by an older backup import cannot be reconstructed from that imported project alone.

## 6. Summary

The audit's concrete integrity, failure-handling, build, backend responsiveness, and interaction issues now have code fixes and regression coverage. The existing local-first architecture and interface remain in place. Accuracy evaluation on representative human-labeled film material remains the appropriate next validation step, not an assertion made by the passing tests.
