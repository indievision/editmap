# EDITMAP local CV service

Python 3.11 is recommended. Install FFmpeg/ffprobe on the host, create `.venv`, then install `requirements.txt`. The backend uses CinemaCLIP for framing, YOLO for people/content evidence, InsightFace (or optional face_recognition), and Demucs. This checkout does not require Ollama.

```sh
cd server
python3.11 -m venv .venv
.venv/bin/pip install -r requirements.txt
.venv/bin/python provision_cinemaclip.py
.venv/bin/uvicorn main:app --host 127.0.0.1 --port 8000
```

Start Vite from the project root with host-network access. `/api/*` proxies to port 8000. Direct loopback fallback is also supported. Bind both servers to loopback.

## Readiness and access

`GET /health` reports service and per-engine readiness without forcing model downloads. `not_loaded` means the engine has not been initialized; `unavailable` means initialization/inference failed. `GET /api/health` exposes the same status through Vite. Models load lazily. Run `provision_cinemaclip.py` before offline use to cache and verify the approved CinemaCLIP framing checkpoint; YOLO and InsightFace may download weights on first use, and Demucs uses `models/97d170e1-dbb4db15.th`. Primary framing-model failures return an explicit 503, never fabricated labels. Each framing suggestion combines three interior shot samples; disagreement or low confidence stays uncertain and requires review.

## Framing benchmark

Use the reviewer-labelled JSON template at `fixtures/framing-benchmark.example.json` to assess real-film shots. Every entry has one human scale label, a film identifier, and exactly three interior stills (20%/50%/80%). The benchmark does not download frames or use model output as ground truth.

```sh
.venv/bin/python benchmark_framing.py /absolute/path/to/labels.json --output /absolute/path/to/report.json
```

It emits a dataset-specific report and only marks it `qualified_on_this_dataset` when it has at least 100 shots from three films, ten examples per scale, and 75% accuracy. This is deliberately not a universal reliability claim.

Only localhost/127.0.0.1 browser origins and hostnames are supported. `GET /api/session` returns a process-local token; other `/api/*` requests require `X-Editmap-Token`. The client negotiates this automatically and refreshes after a backend restart. These checks reject unrelated websites; this is not an authentication boundary against other trusted local processes.

## Endpoints

- `POST /api/analyze-shot`: `{image, images?}` → eight editorial framing tags (`Extreme wide`, `Wide`, `Full`, `American`, `Medium`, `Medium close-up`, `Close`, `Extreme close`), uncertainty, model. `images` accepts up to three frames for shot aggregation.
- `POST /api/analyze-characters`: `{image, cast}` → matched appearances/unresolved state.
- `POST /api/detect-shot-faces`: `{image, shotId, time}` → embeddings and face crops.
- `POST /api/track-shot-faces`: `{shotId, frames[]}` → five ordered face samples associated into shot-local tracks; these reduce duplicate cluster evidence but do not assign cast identity.
- `POST /api/cluster-faces`: `{faces, existingCast?, similarityThreshold?, minAppearances?}` → clusters reconciled with existing references. Existing IDs/names survive confident matches; unmatched identities receive UUIDs.
- `POST /api/detect-shots-upload`: browser-selected `file` plus optional threshold/minimum-shot-length → primary TransNet V2 shot-boundary intervals. The file is held in a temporary local path only for the scan, then removed. `POST /api/detect-shots` remains for trusted local tooling that already has a path.
- `POST /api/analyze-color`, `/api/analyze-eye-trace`, `/api/analyze-motion`: local visual readings.
- `GET /api/dme-status`: DME model availability.
- `POST /api/separate-dme`: multipart `file`, `binCount` (1–10000), optional client-generated UUID `jobId` → HTTP 202 `{jobId}`.
- `GET /api/dme-jobs/{jobId}`: status/progress and `result` when complete.
- `DELETE /api/dme-jobs/{jobId}`: request cancellation.

The arbitrary local `filepath` parameter has been removed. One DME job runs at a time; another returns 409. Inference engines are serialized; overlapping CV requests return 429. Upload limit is 8 GB, known media duration must be at most four hours, FFmpeg extraction has a ten-minute deadline, and the worker retains at most eight compact job results. Cancellation is cooperative between audio inference chunks (and during extraction); model loading/current inference is not forcibly killed. Processing uses 30-second interiors with one-second context, bounding audio tensor memory independently of film length. Temporary files are deleted when a job finishes, fails, or is cancelled. Submission is idempotent by jobId; cancellation received before upload completion prevents that job from starting.

Image requests are limited to 8 MB base64 and 16 million pixels. JSON requests are limited to 32 MB; face batches to 10000, cast to 200, and references to 16 per character. Embeddings must have finite values, a nonzero norm, and a consistent 128/512 dimension. Reference embedding cache holds at most 512 entries.

## Verification

```sh
.venv/bin/python -m unittest discover -s . -p 'test_*.py'
```

Tests use deterministic inputs and fake slow DME work for lifecycle checks. They do not establish real-world recognition accuracy. The geometry classifier requires representative film evaluation; all estimated tags remain editable and require review.
