# Review — screening and evidence room

Implemented Review as a functional module in the third workspace tab. Studio and Map Focus retain their existing interfaces. No new dependencies or backend changes were introduced for this feature.

## Use

1. Open a project, link its video, and select **Review**.
2. Press **M** to record a reaction without pausing. **Space** retains play/pause. The cut magnet is optional and attaches a reaction within 1.5 seconds after a contiguous hard cut to that cut. The raw reaction timestamp and mirror/darken/mute conditions are always retained.
3. Use Mirror screen, Darken screen, and Mute audio independently. These only affect Review playback, not the source media or analysis.
4. Choose **Finish pass**, or let playback end. Select a mark to replay its context. The default seven-second pre-roll is measured from the preceding seam; selectable six/eight-second alternatives are available. The loop includes the reaction and at least one second after the seam so a reaction exactly on a cut still provides context.
5. Inspect local cut-rate and shot-motion curves, A-out/B-in boundary frames, duration comparison, and valid speech evidence. Add your reading, mark it reviewed, or return to Studio at its anchor.
6. Expand **NLE experiment** to enter trim and J-cut frame counts and export a text note with elapsed, record, and source references. No edit is applied.

## Evidence boundaries

- Duration comparisons use the smallest enclosing manually named passage, otherwise a clearly labelled local ±15-second neighborhood. They include the target shot. No inferred scene boundary or pacing diagnosis is claimed.
- Motion uses existing total kinetic energy estimates for the two shots, on their stored 0–100 scale. It is not instantaneous boundary velocity, a percentage of movement, or emotional energy.
- Speech evidence is shown only when the existing media-signature/model validation succeeds. Gaps are between detected speech regions; they do not imply silence. J/L cut topology and audio collisions are not reliably available from the current mixed-track analysis and are not fabricated.
- Changed cut boundaries invalidate the old seam relationship while preserving the original reaction.
- Marks and human notes are saved with the project and validated on backup import. Missing video shows a relink action; saved marks and non-media evidence remain readable.
- The 1.5-second magnet equals 36 frames at 24 fps and 45 at 30 fps. It is an adjustable-use heuristic (on/off), not a measured human reaction-time claim.

## Files changed for this feature

- `src/app/App.tsx` — route Review, isolate keyboard actions, preserve playback time on return, and connect persistence/media callbacks.
- `src/components/ProjectHeader.tsx` — third tab label and description.
- `src/components/ScreeningReview.tsx` — two-phase playback, marking, context loops, boundary sampling.
- `src/components/ScreeningReview.css` — scoped dark/gold responsive layout.
- `src/components/ReviewEvidenceCapsule.tsx` — evidence, human notes and NLE export.
- `src/components/ReviewContextCurves.tsx` — shared-time context plots using existing pacing and motion values.
- `src/analysis/screening.ts` — pure anchoring, evidence and loop helpers.
- `src/models/project.ts` — additive screening mark contract.
- `src/storage/backup.ts` — additive mark validation and restore.
- `tests/screening.test.ts` — anchoring, timing, missing evidence, stale seams and backup coverage.
- `tests/browser/screening-review.spec.ts` — complete fixture workflow and screenshots.

Additional existing sources inspected: `AGENTS.md`, `package.json`, `playwright.config.ts`, `src/app/styles.css`, `src/analysis/cuts.ts`, `src/analysis/pacing.ts`, `src/analysis/motion.ts`, `src/analysis/speech.ts`, `src/analysis/localModel.ts`, `src/components/MotionEnergyArc.tsx`, `src/components/WelcomeScreen.tsx`, `src/storage/projects.ts`, `tests/backup.test.ts`, `tests/sequenceReading.test.ts`, `tests/browser/workspace-modes.spec.ts`, `tests/browser/studio-simplification.spec.ts`.

Pre-existing changes in these files and elsewhere in the working tree were preserved. The diff against HEAD includes work predating this feature.

## Verification

- `npm run build` passed (existing large-bundle warning remains).
- `npm test` passed: 116 tests.
- `server/.venv/bin/python -m unittest discover -s server -p 'test_*.py'` passed: 31 tests.
- Targeted Playwright test passed against `http://127.0.0.1:5173`: live marking without pause, cut anchoring, perception controls, bridge captures, replay looping, curves, NLE note export, Studio/Map navigation, saved marks/reopen without linked video, automatic end-of-screening transition, desktop and 390px layout. No page errors observed.
- Screenshots inspected: `screening-desktop.png`, `evidence-desktop.png`, `evidence-mobile.png`. They intentionally use the synthetic test-film fixture and seeded motion estimates, not real-film analysis results.
- Full historical browser suite and representative long-film performance were not verified. Historical Review Desk browser expectations refer to the replaced UI.
