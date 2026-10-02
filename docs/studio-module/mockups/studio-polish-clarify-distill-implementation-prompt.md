# Implement the approved EditMap Studio polish mockup

Work in `/Users/indievision/Proiecte/EDITMAP_NEW`. First read `AGENTS.md` and inspect the current Studio implementation. The visual reference is `docs/studio-module/mockups/studio-polish-clarify-distill-2026-10-02.png`; its adjacent HTML is a static design artifact, not application code or a source of real data. Implement the visual direction in the existing React Studio page with small, maintainable changes. Do not stop at a plan: implement, verify in the browser, and report the result.

## Scope and exclusions

- Limit this pass to the normal Studio workbench: the Rhythm > Shot duration view, program preview's missing-media state, Shot Inspector presentation, upper-pane spacing, and the shared timeline's visual hierarchy. Carry the same styling through other Studio analytical tabs only where it is a shared wrapper; do not redesign their internal workflows.
- Keep `src/components/ProjectHeader.tsx` and top navigation behavior and styling as they are. The mockup's header is context, not a request to rebuild the header.
- Preserve the three existing resizable/collapsible upper panes and the adjustable upper/timeline split. Do not hardcode the mockup's fixed 1600 × 900 dimensions or column percentages.
- Preserve the one mounted video and one editable `EditingMap`. Do not replace either with a screenshot, static HTML, a second player, a new timeline, or fabricated chart bars. Do not introduce dependencies.
- The working tree already has unrelated modified and untracked files. Inspect before editing and leave unrelated work intact; do not reset, clean, or overwrite it.

## Visual outcome

1. Make the active shot easy to trace: consistent restrained antique-gold selection across the real Rhythm bar, selected-shot summary, timeline shot, playhead, and inspector. Retain current semantic colors in nonselected data; do not recolor the entire chart gold.
2. In the Rhythm drawer, reduce nested boxes and repeated borders. Align the scale toggle, five Rhythm subtabs, three real summary statistics, chart label, chart, and selected-shot details into a clear scan order. Keep `Compressed (log)` and `Linear`; preserve the existing `SHOT ORDER` axis and the click-to-select-and-seek affordance. Avoid adding a second redundant “Shot duration” label when the selected subtab already names the view.
3. Give the monitor a quieter frame. For an existing project whose original video is disconnected, show the actual stored filename, the truthful relink message, and one prominent `Relink video` action. Keep playback controls and current timecode in their present live component. Do not imply playback or local CV is available until the video is linked. Do not add a new privacy claim beyond existing product wording.
4. Tighten the Shot Inspector using section spacing and subtle rules so framing choices, subject/people, camera movement and Detect, cast chips, color/motion evidence, note input, `? Uncertain`, `Confirm & next`, Local CV status, and reanalysis remain discoverable. Keep the review actions visible at the bottom while the body scrolls. Preserve real AI/review/confirmed/uncertain states and actual analysis values.
5. Keep the timeline visually calm: one icon-only edit/navigation toolbar, readable lane labels, clear selected shot/playhead, and the existing colored analytical lanes. Do not remove tracks that extend below the mockup viewport. Do not add duplicate Rhythm/Structure/Sound/Cuts/Cast/Color shortcuts, a palette toggle, or an extra tools menu to the toolbar. Keep the current Split, Merge, In, Out, Clear In/Out, Snap, Marker, Squint, Fit, zoom, and fullscreen controls, with their existing accessible names and tooltips.
6. Keep the dark, clean EditMap palette and hierarchy. Use the existing CSS and component patterns; avoid large rewrites, blanket global selectors, extra cards, decorative motion, and new UI copy that does not help a decision.

## Existing code to inspect before editing

- `src/app/App.tsx`: Studio pane composition, collapse/resize state, persistent monitor, relink flow, `ShotInspector` and `EditingMap` wiring.
- `src/app/styles.css`: `.workspace.mode-studio`, `.top-stage`, `.studio-detail-drawer`, `.studio-tabs`, `.screen-empty`, `.studio-transport-bar`, `.mode-studio-inspector`, `.studio-toolbar-row`, and `.studio-map-expanded` rules, including later overrides and responsive rules.
- `src/components/EditingRhythm.tsx` and its shot-duration child `src/components/Rhythm.tsx`: live chart, scale, metrics, selected-shot summary, subtabs, selection and seek callbacks.
- `src/components/ShotInspector.tsx`, `src/components/StudioToolRail.tsx`, `src/components/StudioToolbar.tsx`, and `src/timeline/EditingMap.tsx`: present controls and state. Change component markup only if targeted CSS cannot achieve the layout cleanly.

## Behavior that must survive

Preserve the shared selected shot, playhead, seeking, scrubbing, playback, zoom, scroll positions, pane resizing/collapse, expanded-map mode, fullscreen graph versus video fullscreen, timeline edits, marker/story tracks, scan/retry flows, shot tagging and notes, confirmation and auto-advance, undo/redo and persistence. Preserve keyboard access, visible focus, ARIA state, and realistic pointer targets. No data should change merely because the layout changed. Display real project statistics, timecodes, filenames, suggestions and status; missing or partial analysis stays visibly unavailable rather than becoming sample values from the mockup.

## Verification

- Run `npm run build`, `npm test`, and `server/.venv/bin/python -m unittest discover -s server -p 'test_*.py'` after relevant changes, per `AGENTS.md`.
- Start the Vite development server with loopback host-network access as `AGENTS.md` requires; run relevant Playwright specs with `PLAYWRIGHT_BASE_URL`. At minimum cover `tests/browser/studio-rhythm-drawer.spec.ts`, `tests/browser/studio-toolbar-simplification.spec.ts`, `tests/browser/studio-timeline-design.spec.ts`, and `tests/browser/studio-expanded-map.spec.ts`. Update only assertions whose visual intent genuinely changed; do not weaken behavior checks. Avoid writing screenshots to external absolute paths; save new evidence under the project.
- Inspect actual browser renders at a wide desktop viewport, a medium/narrow viewport, normal Studio, expanded-map Studio, linked video, and the disconnected-video relink state. Check no clipped inspector footer, no overlapping toolbar, no lost timeline lanes, and no horizontal text overflow. Exercise the real chart selection/seek, scale toggle, relink button, shot navigation, note edit, Uncertain, Confirm & next, collapse/resize, and toolbar controls. Verify no new console errors.
- Compare against the approved mockup for hierarchy, spacing, and color, while prioritizing correct live behavior and responsive layout over pixel matching.
- Finish with a concise report: exact files changed, what changed, commands and browser checks with results, screenshot paths, and any unverified behavior or remaining limitation. Do not report the mockup itself as implemented UI.
