# EDITMAP_GEMINI audit — 11 September 2026

## 1. Current state

EDITMAP has a useful local editing-analysis workflow, but its next milestone should be trustworthy results and recoverable work. More analytical features would currently compound inconsistencies in the underlying tags and character evidence.

The existing React/TypeScript/Vite architecture remains appropriate. The dark interface has a consistent identity, record-based timing remains central, and there is useful separation between measured editing properties and the user's interpretation. Keep these foundations.

Compared with the neighboring EDITMAP source snapshot, the Gemini folder contains targeted improvements: separate framing and character passes, debounced autosave, playback-state throttling, thumbnail batching, timeline culling when zoomed, a large-file waveform guard, local-model fallback, and parser support for track B and out-of-order events. These are useful directions. There is no Git repository in this folder, so this comparison establishes file differences, not a verified commit history or authorship.

The runtime model remains **local Ollama `qwen3-vl:4b`**. Gemini Flash is not an inference dependency in the inspected application.

### Verification performed

| Check | Result and scope |
| --- | --- |
| Unit tests | 39/39 passed using `npm test`. |
| Production build | `npm run build` passed; generated JS is approximately 284 kB, 89 kB gzip. |
| Existing browser suite | 9 passed, 9 failed in isolated Chrome, using `--timeout=10000`. Eight failures target the removed “Scan all shots” control; one expects “Analyze selected shot” after an edit now changes the button to “Reanalyze shot”. These failures prevent the old tests from exercising the revised scan behaviors. |
| Updated two-step workflow smoke check | Three framing requests and three character requests completed with controlled model responses through the current buttons. This is functional coverage, not an accuracy evaluation. |
| Real inference | Model inventory returned HTTP 200; Qwen was present; sampling and classifying one synthetic fixture frame returned valid tags in approximately 12.6 seconds including inventory/sampling. This verifies the local bridge, not film-classification quality. |
| Targeted reproductions | Confirmed lost in-flight notes, whole-shot confirmation after one field edit, taxonomy denominator mismatch, inconsistent multi-reference cast numbering, failed-sample completion state, missing fast-match shot counts, and empty parsed timeline with nonfinite duration. |
| Visual review | Inspected desktop at 1440×1000 and a narrow 390×844 layout. The narrow sample had no horizontal document overflow. The map was approximately 1462 px below the top in that sample. |

The first browser launch was blocked by the execution sandbox; the reported test results come from the subsequent successful Chrome launch outside it. The existing development server later stopped responding and was restarted from this checkout on `127.0.0.1:5174` outside the sandbox.

## 2. Problem

### P1 — A selected-shot model result can erase edits made while it runs

**Reproduced in the browser.** Start “Reanalyze shot”, type a note while the request is pending, then return valid model tags. The note becomes empty.

`ShotAnalysis.run` retains its initial `onUpdate` callback. That callback reaches `editShot`, which builds an entire shot array from the project captured before the request. This can overwrite newer notes and other intervening project changes.

Evidence: `src/components/ShotAnalysis.tsx:29`, `src/app/App.tsx:412`, `src/app/App.tsx:975`; `workflow-checks.json` records the empty result after entering a note.

**Smallest fix:** apply the result through a functional project update, addressed by project ID, EDL/media revision, and shot ID. Merge only returned fields into the current shot and preserve later human edits. Add a pending-request regression test with concurrent annotation.

### P1 — Model, inspector, and analytical views disagree about framing

The model produces FS and AS. The manual selector offers MWS, Insert, OTS and POV instead. The framing rank excludes FS and AS, while sequence analysis has its own ordering that includes them.

**Reproduced:** a 10-second FS shot plus a 10-second CU shot yields only 10 seconds of recognized framing and a 100% CU/ECU share. With both valid scale tags recognized, the share should be 50%. The application can therefore give different analytical treatment to a model result and a manual tag.

Evidence: `src/models/project.ts:19`, `src/analysis/localModel.ts:16`, `src/analysis/framing.ts:3`, `src/analysis/pacing.ts:58`.

**Smallest fix:** centralize the active scale taxonomy and use it for the prompt, validation, inspector, shortcuts, legend, ranking and summaries. Preserve stored legacy values. Keep shot scale distinct from OTS/POV/insert descriptions; a close-up may also be an OTS. Do not silently reinterpret existing annotations.

### P1 — Multiple cast reference images can identify the wrong character

**Reproduced request/response contract:** give Anna two references and Bob one. The prompt numbers images `1=Anna, 2=Anna, 3=Bob`, but the output schema allows only character slots `1, 2`. A reply of `2` is decoded as Bob even though the prompt labels image 2 as Anna. This is a numbering defect independent of model accuracy.

Evidence: `src/analysis/characters.ts:44` and `src/analysis/characters.ts:68`.

**Smallest fix:** distinguish image indices from character slots in the prompt and map every reference to its owner's stable output slot. Test two characters with unequal reference counts. Existing reference images are whole shot midpoints; later add a current-frame choice and crop so references can isolate the intended person.

### P1 — Editing one field confirms unrelated fields

**Reproduced:** changing only shot size changes the shot's overall status to Confirmed. Keyboard size tagging does the same. Composition and subject may still be unknown or unreviewed model output, but the entire shot is skipped by the next framing scan and by “Next unreviewed”.

Evidence: `src/app/App.tsx:280`, `src/app/App.tsx:412`, `src/components/AllShotsAnalysis.tsx:66`.

**Smallest fix:** preserve an explicit whole-shot confirmation step. If immediate confirmation of manual size tags is desired, track protection/review by field so it does not implicitly approve composition and subject. Preserve the speed of manual tagging.

### P1 — Failed character requests can become permanently “up to date”

**Reproduced at the scan-function level:** a failed request produces `failedTimes: [5]`, `sampleTimes: [5]`, and `partial: false`. The bulk queue's up-to-date condition checks mode, reference signature and partial state, but ignores failed samples. A subsequent fresh scan excludes that result. The UI can report completion even when samples failed.

Resuming also reconstructs prior readings from intervals without restoring their failure metadata. The queue retains old shot objects, so partial evidence published during an interrupted scan is not necessarily the evidence used by its Resume action.

Evidence: `src/analysis/characters.ts:103`, `src/analysis/characters.ts:143`, `src/components/AllShotsAnalysis.tsx:172`.

**Smallest fix:** distinguish completed-successful, unresolved and failed sample states. Retry failed samples explicitly; retain successful samples; resume by current shot ID and current evidence. Catch initial sampler creation/first-frame failures at the outer scan level so they become visible errors rather than rejected event-handler promises.

### P1 — Fast character matches are not consistently reviewable

**Reproduced through the complete two-step UI:** three successful midpoint matches create presence marks, but the character row says `0:00`, `0.0% · 0 shots`. Fast results deliberately have zero-length intervals; `CharacterSummary` filters them out with `endSeconds > startSeconds`, removing the corresponding inspection/confirmation entries. Clicking a midpoint presence block sends a zero-length playback range, which the player rejects.

There is a separate source-confirmed precedence problem: manually clearing all names does not remove the earlier model intervals from summary/highlight logic. Manual assignments and model matches are combined, so a confirmed “no characters” decision can coexist with an old positive match. Manual assignments are also not filtered by the selected range in the summary.

Evidence: `src/components/CharacterSummary.tsx:38`, `src/components/CharacterSummary.tsx:44`, `src/app/App.tsx:463`, `src/app/App.tsx:1065`.

**Smallest fix:** count midpoint evidence as matched shots and seek to its sample on activation; display screen time as unmeasured for fast scans. Apply confirmed manual assignments before model suggestions in every view. Clip manual shot lists to the active passage. Keep sampled duration estimates clearly labeled in detailed mode.

### P1/P2 — Persistence needs revision safety and a portable backup

Autosave is a valuable improvement, but its completion unconditionally clears `dirty`. **Source-inspection finding, not a timing reproduction:** an older save completing after a newer edit can clear the new dirty state and cancel its pending autosave. Autosave failures are silently swallowed. No export/import backup, schema version, project deletion or recovery history is exposed. `listProjects` loads complete records, including embedded reference/analysis images, to show a project list.

Evidence: `src/app/App.tsx:129`, `src/storage/projects.ts:11`, `src/storage/projects.ts:25`, `src/models/project.ts:152`.

**Smallest fix:** acknowledge only the revision actually saved, show Saving/Saved/Failed status, and serialize writes. Add a versioned project export/import with validation, preserving tags, notes, cast, spans and review state. This protects work across browser/profile/port changes and enables later migrations. Add undo for destructive edits and EDL replacement.

### P2 — Import and relinking need stronger integrity checks

**Reproduced:** an EDL containing only a zero-duration non-cut event passes the raw-event check, skips all shots, and returns `shots: []` with `duration: -Infinity`. Reject an empty parsed timeline and require finite duration.

Source inspection also shows that replacing the EDL replaces shot annotations without reconciling existing cut annotations, cast-reference shot IDs, sequences or sound spans. Relinking overwrites media metadata without checking whether the file matches the expected film. A delayed waveform decode can update a later project/video because the promise has no generation guard.

Evidence: `src/parsers/edl.ts:76`, `src/parsers/edl.ts:110`, `src/app/App.tsx:371`, `src/app/App.tsx:386`.

**Smallest fix:** explicit replacement handling with a recoverable snapshot, media mismatch diagnostics, and generation checks for asynchronous media work. Keep frame-rate confirmation mandatory. Validate production exports at their known rate; the two supplied EDL headers specify non-drop but do not establish the frame rate.

### P2 — Analytical edge cases deserve explicit contracts

`alternations` accepts any next start greater than or equal to the previous end, so it can join shots across gaps despite its contiguous-shot description. Its current test does not include that gap case. Sequence framing changes compare all selected neighbors, including gaps/non-cut transitions, while the UI calls these changes “Across cuts”. Sequence duration statistics use full durations for partially intersected shots; document this denominator or use clipped durations where appropriate. CutReading samples the incoming image one frame after the boundary while calling it the first frame.

Evidence: `src/analysis/characterPresence.ts:40`, `src/analysis/pacing.ts:62`, `src/components/SequenceReading.tsx:29`, `src/components/CutReading.tsx:45`.

## 3. Proposed fix

### First milestone: trustworthy analysis and preserved work

Fix stale selected-shot updates, autosave revision handling, taxonomy consistency, multi-reference cast mapping, review protection, failed-sample retry, and fast-marker/manual-override presentation. Add focused regressions for these actual failures and update the browser tests to the two-step workflow. Do not rewrite the application.

Acceptance: concurrent edits survive model completion; one manual field does not falsely confirm other fields; every active scale has the same meaning across views; failed requests remain retryable; confirmed manual character decisions win; fast matches can be inspected and counted; the browser suite reaches the behaviors it claims to test.

### Second milestone: finish one real editing session safely

Add portable project backup/restore, visible save status, undo for destructive operations, relink validation, and EDL replacement handling. Test importing a real known-rate EDL, tagging, scanning, correcting, saving, reopening/relinking, exporting and restoring in a separate origin. Verify that every annotation survives.

### Third milestone: make the map easier to work with

Preserve the existing visual language. Make scan setup and cast setup collapsible after use; keep the monitor, map and manual tagging controls close together. In the inspected desktop view, setup panels push the map below the initial viewport, and the tag strip sits below several reading panels. Add a compact review filter for unreviewed, uncertain, failed and selected-character shots. Add a keyboard-accessible way to define a passage; shift-drag alone does not serve keyboard or touch use well.

The narrow layout reflows without document overflow in the tested sample, but scrolling distance is substantial. Prioritize desktop/laptop editing ergonomics before spending effort on a separate mobile workflow. No formal screen-reader or contrast audit was performed.

### Fourth milestone: measure quality and sustained performance

The copied blind benchmark records 13/40 size agreement, 24/40 composition, and 32/40 content; it is historical same-film evidence using older frozen settings. It does not establish accuracy of the current taxonomy/prompt or character scanner. Preserve those labels and outputs.

Build a separate held-out set across multiple films, including wide/profile/occluded people, groups, objects, graphics and changing framing. Freeze the current prompt, taxonomy and images. Measure per-field accuracy, character precision/recall, failure rate, correction time, and time per shot. Measure whether assistance saves review time. A successful local request is not evidence of classification accuracy.

Profile 500–2,000 shots on an actual long film with a known timebase. Zoomed timeline culling and thumbnail batching help, but fit view still renders all shots, hidden rhythm tabs remain mounted, inline callback props weaken memoization, and all thumbnails are eventually generated. The waveform guard uses compressed file size, which does not bound decoded PCM memory; long low-bitrate media can still be expensive. Measure heap and long tasks before optimizing further; then consider viewport-prioritized thumbnails and bounded/chunked audio work.

For delivery, define a supported local launch path and stable origin. The Vite proxy was verified; static hosting has no equivalent proxy, and the fallback does not cover every missing-proxy response such as HTML 200 or HTTP 404. Add a clear local-model readiness check before scanning. Desktop packaging can follow once the real workflow is reliable.

## 4. Files affected

### Inspected

Paths below are relative to `/Users/indievision/Proiecte/EDITMAP_GEMINI`.

- Instructions/configuration: `AGENTS.md`, `GEMINI.md`, `README.md`, `package.json`, `vite.config.ts`, `playwright.config.ts`, `tsconfig.json`, `.gitignore`.
- Application: `src/main.tsx`, `src/app/App.tsx`, relevant layout/responsive rules in `src/app/styles.css`, `src/models/project.ts`, `src/storage/projects.ts`, `src/parsers/edl.ts`, `src/utils/timecode.ts`, `src/video/useThumbnails.ts`, `src/timeline/EditingMap.tsx`.
- Analysis: `src/analysis/audio.ts`, `characterPresence.ts`, `characters.ts`, `colors.ts`, `cuts.ts`, `framing.ts`, `localModel.ts`, `pacing.ts`, `playback.ts`.
- Components: `src/components/AllShotsAnalysis.tsx`, `CharacterSummary.tsx`, `CutReading.tsx`, `EditingRhythm.tsx`, `FramingArc.tsx`, `FramingSummary.tsx`, `LocalPacing.tsx`, `Rhythm.tsx`, `SequenceReading.tsx`, `ShotAnalysis.tsx`, `SoundReading.tsx`.
- Tests: `tests/core.test.ts`, `characterPresence.test.ts`, `characters.test.ts`, `framing.test.ts`, `pacing.test.ts`, `tags.test.ts`; browser setup/assertions in `tests/browser/analysis.spec.ts`, `bulk-analysis.spec.ts`, `workflow.spec.ts`. All four browser spec files, including `framing.spec.ts`, were executed.
- Evidence: `benchmark/blind/summary.json`, `benchmark/blind/README.md`; headers of `FILME/how to shoot a ghost_EDl.edl` and `FILME/ap14.edl`. Used `fixtures/test-film.mp4` and `fixtures/cuts-24.edl` in isolated browser checks. Unit tests exercised the other EDL fixtures.
- Comparison: source-tree differences against `/Users/indievision/Proiecte/EDITMAP/src`; detailed diffs of `app/App.tsx` and `analysis/characters.ts`.

### Created or regenerated

No application source or existing test definitions were changed. Audit outputs are in this directory: `AUDIT.md`, `browser-tests.log`, `reproductions.json`, `workflow-checks.json`, `live-model.json`, `desktop.png`, `character-marker.png`, `mobile.png`. Builds/tests regenerated ignored `dist/`, TypeScript build metadata, `test-results/`, and browser screenshots. Temporary audit scripts were created under `/private/tmp`; test projects lived in isolated disposable Chrome contexts, not the user's saved browser projects.

## 5. Risks / edge cases

This is a source audit, synthetic workflow verification and a single real local-inference smoke check. It is not a completed feature-film endurance test, independent current-model accuracy benchmark, comprehensive accessibility certification, dependency vulnerability audit, or validation across all codecs/browsers.

The inspected application sends inference only to local endpoints; no cloud upload or telemetry path was found. Local reference and analysis images persist in browser storage and need to be included in backup/privacy documentation. A small dependency footprint is helpful but is not proof of dependency security.

Synthetic cast references in `reproductions.json` use placeholder image bytes, which explain the broken reference thumbnails in `character-marker.png` and `mobile.png`; those broken thumbnails are not reported as a product bug. The separate complete workflow check used a real captured synthetic-video reference.

Taxonomy and review-state changes must preserve old projects. Previously auto-confirmed records cannot reliably be distinguished from deliberately confirmed records without provenance; do not reset them indiscriminately. Historical accuracy figures must not be relabeled as results for the current implementation.

## 6. Summary of changes

Audit only: documented and reproduced correctness problems, ran tests/build, verified the real local bridge, compared the two source folders, and inspected desktop/narrow layouts. The highest-value next step is a small reliability release focused on preserving edits and making every displayed result consistent, reviewable and recoverable.
