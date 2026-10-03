# EDITMAP

## Framing analysis

Editing rhythm includes Framing summary and Framing arc tabs. The summary shows shot counts, seconds and percentages of total shot time for Wide, Full, Medium, Close, and Extreme close, plus recognized, confirmed and uncertain framing coverage. Unknown, exempt and legacy tags remain separate; gaps are excluded. The arc displays duration-scaled shot segments from Wide to Extreme close, with a separate lane for unranked tags. Click or keyboard-activate a segment to select and seek. Faded segments indicate unconfirmed or uncertain tags.

Local pacing overlays a dashed gold Close/Extreme close screen-time share on the existing blue cuts/minute curve. The right axis is percent; the left axis is cuts/minute. Both use the selected centered 10/30/60-second window. Framing weights each shot's actual overlap with the window and excludes unranked sizes from its denominator; missing framing produces a break rather than zero. Coverage and confirmation percentages expose incomplete tagging. These views use current tags, never pending model suggestions. Framing segments reflect a single tag per shot, not tracked camera movement; no emotional-intensity score is inferred.

Local film-editing analysis prototype, built with React, TypeScript, Vite, native video playback and IndexedDB. No account, telemetry or cloud processing. Optional local services run on this machine only: a Python computer-vision service (shot size, faces, audio) and the DUET screening server. Media never leaves the machine.

## Run

Requires Node.js 22.12+ (or a supported newer release).

```sh
npm install
npm run dev
```

Open the localhost URL printed by Vite. Keep the same browser and port when reopening projects: IndexedDB is scoped to the origin. `npm run build` checks TypeScript and creates the static application in `dist/`.

`npm run dev` also starts the two local services when it can:

| Service | Port | Started when | Notes |
|---|---|---|---|
| CV backend (FastAPI) | 8000 | `server/.venv` exists | Setup and limits: `server/README.md`. Loopback only, with a per-session token. |
| DUET screening server | 3000 | always | Loopback only by default. |

Browser origins allowed to call the CV backend are `http://127.0.0.1` or `http://localhost` on ports 5173-5180. Add others with `EDITMAP_ORIGINS=http://127.0.0.1:4000,...`.

### Wi-Fi screening (optional)

To let other devices on your network join a DUET screening, start with `EDITMAP_DUET_LAN=1 npm run dev`. The server then listens on all interfaces and requires a secret that changes on every launch. The host's DUET page shows a **Wi-Fi join link** (the server also prints it): share that link only with your audience. Opening it sets a cookie on the joining device. Uploads, video, pages and the WebSocket all require it, and the secret travels over plain HTTP, so use trusted networks only. Without `EDITMAP_DUET_LAN=1`, nothing is reachable from other machines.

## Workflow

1. Create a project and name it.
2. Import a browser-playable film (H.264/AAC MP4 or WebM recommended).
3. Import a CMX 3600 EDL. Confirm frame rate. The first video event's record in maps to video zero by default; use **Advanced → Timeline start timecode** only if your film includes leading black or has a different record start.
4. Click shots to select and seek. Double-click to play a single shot. Use Space outside editable controls, transport, frame steps, or the seek slider.
5. Set shot sizes and notes in the inspector. Use zoom, horizontal scroll, fit, and the rhythm chart.
6. Save locally. Open restores annotations and asks you to relink the original film. Media bytes are never stored in the project database.

## Timecode and import rules

- Supported rates: 23.976 (24000/1001), 24, 25, 29.97 (30000/1001), 30.
- Non-drop timecodes count nominal frames; elapsed seconds use the exact fractional frame rate.
- 29.97 drop-frame follows SMPTE skipped labels, including ten-minute exceptions.
- Record in/out determine shot positions. Source in/out and transition types are retained.
- Audio-only events are ignored; the film supplies original embedded audio.
- Gaps are preserved. Malformed timecodes, reversed ranges and overlapping video events produce errors. V0 targets flattened, cuts-oriented EDLs; transition effects are supplied by the finished video, not synthesized.
- Shot playback pauses at the exclusive record-out boundary. Native browser scheduling may allow a small playback overshoot before correction. Frame stepping seeks by one project frame; browser decoding and variable-frame-rate media can limit displayed-frame precision.

## Verification

```sh
npm test                       # unit tests (Node), including the DUET server's access rules
npm run build                  # type-check + production build
server/.venv/bin/python -m unittest discover -s server -p 'test_*.py'   # CV backend
npx vite --host 127.0.0.1 --port 5174 --strictPort --no-open &         # dev server for browser tests
PLAYWRIGHT_BASE_URL=http://127.0.0.1:5174 npm run test:browser
```

The browser tests use installed Google Chrome and a running dev server; set `PLAYWRIGHT_BASE_URL` to its URL. They cover project setup, EDL import, seeking, playback across cuts, tagging and persistence, the Cast, Cuts, Color, Framing and Explore drawers, the Screening hub and Duet review, and scanning with the CV service mocked.

Writing a browser test:

- Start with `startNewProject(page)` from `tests/browser/helpers.ts`. It creates a project from the File menu, links `fixtures/test-film.mp4` and switches to Studio, which stays locked until a film is linked. For a saved project, seed IndexedDB, reload and use `openRecentProjectInStudio`.
- The Screening hub is an iframe (`.duet-console-iframe`), so use `page.frameLocator(...)` for anything inside it.
- Navigate with relative URLs (`page.goto("/")`) and write screenshots under `test-results/`, never to absolute paths.
- Specs written for the pre-redesign UI are kept in `tests/browser/_retired/` (excluded by `testIgnore`; see its README). Port one by updating it to the current UI and moving it back.

CI (`.github/workflows/ci.yml`) runs the build and unit tests, the Python tests, and the browser suite on every pull request. The synthetic MP4 contains a 440 Hz tone so original embedded audio can also be checked by ear.

Fixtures: `cuts-24.edl` (1, 2.5 and 10 second shots), `drop-2997.edl` (minute boundary), `gaps-25.edl` (audio and gap), `invalid-24.edl` (expected rejection), `test-film.mp4` (13.5 second synthetic video/audio).

## Structure

- `src/app/`: project orchestration and interface styles
- `src/playback/`: the playback clock (`playhead.ts`) and components that follow it
- `server/`: local CV backend (FastAPI)
- `duet_server.cjs`, `public/`: DUET screening server and its pages
- `src/models/`: typed project and shot records
- `src/parsers/`: CMX 3600 ingestion
- `src/utils/`: timecode conversion
- `src/analysis/`: generic color mapping and playback lookup
- `src/timeline/`: duration-scaled map
- `src/components/`: rhythm visualization
- `src/storage/`: IndexedDB projects (single connection, migrations, quota-aware errors)

### Playback clock

Playback time is not React state. It lives in `src/playback/playhead.ts`, and the player writes it every animation frame. Read it in event handlers with `playhead.get()`. Components that show or follow the time call `usePlayhead(active)`, passing `false` while hidden so they stop re-rendering; use `usePlayheadSelector` when only a value derived from the time matters (for example the active shot). Putting the time back into a parent's state re-renders the whole workspace on every frame.

## Limits

Projects remain in this browser's storage and may be removed by browser-data clearing. Save explicitly before closing or refreshing. Reconnect the same film when reopening. Codec support depends on the browser. Real Resolve exports and long-film performance should be validated with production media before relying on this prototype professionally.

## Files inspected and created

The workspace was empty at inspection; no existing application files were modified or replaced. The supplied brief was read from `/Users/indievision/.codex/attachments/2c3d8205-831d-4ca6-b33c-7cb565078145/pasted-text.txt`.

Created application files:

- `.gitignore`
- `package.json`
- `package-lock.json`
- `tsconfig.json`
- `index.html`
- `src/main.tsx`
- `src/app/App.tsx`
- `src/app/styles.css`
- `src/models/project.ts`
- `src/utils/timecode.ts`
- `src/parsers/edl.ts`
- `src/analysis/colors.ts`
- `src/analysis/playback.ts`
- `src/storage/projects.ts`
- `src/timeline/EditingMap.tsx`
- `src/components/Rhythm.tsx`

Created validation and documentation files:

- `playwright.config.ts`
- `tests/core.test.ts`
- `tests/browser/workflow.spec.ts`
- `fixtures/cuts-24.edl`
- `fixtures/drop-2997.edl`
- `fixtures/gaps-25.edl`
- `fixtures/invalid-24.edl`
- `fixtures/test-film.mp4`
- `README.md`

Generated outputs include `dist/`, TypeScript build metadata, browser test results and `tests/browser/workspace.png`; these are ignored by Git.

## Fast shot tagging

Select a shot, then use 1–5 for Wide, Full, Medium, Close, Extreme close, or U for Unknown. The visible tagging buttons do the same. **Advance after tagging** moves to the next shot and pauses playback; disable it to stay on the selected shot. The inspector dropdown remains a direct edit without advancing. Shortcuts do not run while editing notes or other input fields, with modifier keys, or on held-key repeats.

Wide-enough map blocks show a midpoint thumbnail from the linked video. A separate muted decoder generates small local previews sequentially and pauses generation during playback. Previews are temporary and regenerate after relinking; unsupported decoding retains the normal colored blocks. A midpoint is a visual aid and does not automatically determine shot size.

This update inspected and changed `src/app/App.tsx`, `src/timeline/EditingMap.tsx`, `src/app/styles.css`, `tests/browser/workflow.spec.ts`, and `README.md`; it added `src/video/useThumbnails.ts`.

## Local pacing

03 / LOCAL PACING sits below Rhythm. The curve measures contiguous hard-cut starts in a centered 10, 30 (default), or 60 second window, normalized to cuts/minute using the actual window length at film edges. Opening events, gaps and non-cut transitions are excluded. The curve samples 601 film positions; hovered values are computed at the exact pointer time. Click to seek; keyboard focus supports arrows (one second), Home and End. A marker follows playback.

Files inspected for this change: `src/components/Rhythm.tsx`, `src/app/App.tsx`, `src/models/project.ts`, `src/analysis/playback.ts`. Files changed: `src/app/App.tsx`, `src/app/styles.css`, `tests/browser/workflow.spec.ts`, `README.md`. Files added: `src/components/LocalPacing.tsx`, `src/analysis/pacing.ts`, `tests/pacing.test.ts`.

## Separate classification fields

The inspector now separates framing size, composition (single person / two-shot / group / unknown), content (people / object-detail / text-title / other / unknown), and uncertain framing. Existing projects default missing fields to Unknown / false without overwriting tags. Text content sets size to Not applicable and blocks size shortcuts. Changing text to another content resets size to Unknown. Legacy sizes remain visible when already assigned, but are no longer offered as new framing sizes. Keys 1–5 and U assign the active framing sizes. All fields save in the project.

This change inspected and modified src/models/project.ts, src/analysis/colors.ts, src/app/App.tsx, src/app/styles.css, tests/pacing.test.ts, tests/browser/workflow.spec.ts, and README.md. Benchmark reference labels were not changed.

## Analyze selected shot (local CV)

Analysis now moves the paused monitor and timeline playhead to each shot's midpoint. While the model processes it, the monitor displays the exact JPEG sent to the model. Suggestions save that image and timestamp, with a small inspector preview and a **Show in preview** action. Old suggestions without a saved image still load normally. Saving images increases project storage usage. Selecting a shot seeks half a frame inside its start to avoid displaying the preceding frame at a cut boundary.

Drag the timeline playhead to scrub with live video updates; the inspector follows the shot under the playhead. Pointer capture keeps dragging active outside its handle, and decoding coalesces rapid moves to the latest requested position. Arrow keys on the focused playhead step one frame, with Home/End for timeline boundaries. Seeking or playback clears the analyzed-image overlay. During bulk scanning, the next sample moves the monitor back to the shot being analyzed.

Preview and scrubbing update — inspected and changed: `src/app/App.tsx`, `src/app/styles.css`, `src/models/project.ts`, `src/components/ShotAnalysis.tsx`, `src/components/AllShotsAnalysis.tsx`, `src/timeline/EditingMap.tsx`, `tests/browser/bulk-analysis.spec.ts`, and `README.md`. Also inspected `src/analysis/localModel.ts`. Verification: production build, 21 unit tests, nine analysis/browser workflows including exact request-image matching, sequential scan seeking, persistent suggestions, and pointer/keyboard scrubbing.

**Scan all shots** above the editing map scans shot size, people in frame, and main subject for every imported EDL shot with one click, without selecting shots individually. It uses the same local model and midpoint sampling as selected-shot analysis, processing one shot at a time. Frames are compact (336px wide) and the service returns a small validated classification object, which reduces model work without changing the reviewable four-field result. Results are written directly into the inspector fields and remain marked Needs review until confirmed. Progress shows completed shots; Cancel scan retains completed readings, and Resume scan continues from the unfinished shot. A failed or timed-out request stops the queue and can be retried with Resume scan. Relinking video, replacing the EDL, or changing projects ends the scan. You can keep navigating and editing while it runs; individual model requests and review confirmation are disabled during a bulk scan. Thumbnail generation pauses during analysis to reduce decoder contention. Scanning invokes local computer vision once per shot, so sustained CPU/GPU use and fan activity are expected on longer films.

Bulk and selected-shot results are written directly into the inspector fields, then marked Needs review. Edit the fields as needed and use Confirm current tags when satisfied. Confirmed shots are protected from later bulk reanalysis; notes are always preserved. Save stores completed readings with the project; an unfinished scan queue itself is not saved across reloads. The local Python CV service must be running, and each shot has a two-minute timeout.

Bulk scan file inventory:

- Added: `src/components/AllShotsAnalysis.tsx`, `tests/browser/bulk-analysis.spec.ts`.
- Inspected and changed: `src/app/App.tsx`, `src/app/styles.css`, `src/components/ShotAnalysis.tsx`, `README.md`.
- Also inspected: `package.json`, `tsconfig.json`, `playwright.config.ts`, `vite.config.ts`, `src/analysis/localModel.ts`, `src/models/project.ts`, `src/storage/projects.ts`, `src/video/useThumbnails.ts`, `tests/tags.test.ts`, `tests/browser/analysis.spec.ts`, `tests/browser/workflow.spec.ts`.

Select an EDL shot with video linked, then choose Analyze selected shot in the inspector. EDITMAP samples a midpoint using an independent muted decoder and requests tags from the local Python CV service through the Vite localhost proxy. Start the backend as described in `server/README.md`. The bridge is development-server-only: a static dist deployment does not include inference; Tauri integration remains future work. No remote inference endpoint is used.

Analysis writes its four-field result directly into the inspector and marks the shot Needs review; it does not silently confirm it. Inspector edits also mark fields Needs review. Confirm current tags works without a model. Next unreviewed wraps through shots not confirmed. Small outlined markers identify unconfirmed map tags. Confirmed shots are not overwritten by a later bulk reanalysis, and notes are preserved. Cancel, selection change, media relink and project change abort the active request; a two-minute timeout also ends waiting. All predictions need review regardless of the model uncertainty flag. A single midpoint does not classify changing framing over an entire shot.

This implementation inspected package.json, src/models/project.ts, src/analysis/colors.ts, src/app/App.tsx and src/video/useThumbnails.ts. Added vite.config.ts, src/analysis/localModel.ts, src/components/ShotAnalysis.tsx and tests/browser/analysis.spec.ts. Changed src/models/project.ts, src/app/App.tsx, src/timeline/EditingMap.tsx, src/app/styles.css and README.md. No benchmark labels were changed. Validation: production build, 15 unit tests, six browser workflows (model response stubbed for deterministic acceptance/persistence), plus a separate real local Qwen bridge smoke check.


## Reliability and local processing

The header Analyze action opens the existing-shot workflow when a timeline exists; it does not redetect or replace imported EDL boundaries. For a new timeline, completed framing results are checkpointed so cancellation retains work. Framing, targeted character scans, and rediscovery distinguish failures from successful empty detections. Resume discovery retains sampled faces in memory for the current linked media; persisted failures remain retryable after reopening. Single midpoint character detections are markers, not whole-shot visibility claims.

Rediscovery preserves existing cast IDs, names, references, and confirmed appearances. Ambiguous matches become new suggestions that can be merged manually. Backups retain color, motion, eye trace, DME, suggestion, and failure data as well as manual annotations.

DME runs as one cancellable local background job with progress. Audio processing uses bounded chunks; changing media/project cancels the request and prevents stale results from being applied. The service limits media to 8 GB / four hours. No media is sent to a remote inference service; model weights may need to be downloaded during first use.

Verify with `npm run build`, `npm test`, and `server/.venv/bin/python -m unittest discover -s server -p 'test_*.py'`. Run browser tests against a running preview with `PLAYWRIGHT_BASE_URL=http://127.0.0.1:5179 npm run test:browser`.
