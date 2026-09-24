# Expanded map in Studio

Studio's timeline toolbar now offers Expand map / Restore Studio. Expanded view keeps the existing video and timeline mounted, puts the film preview and shot summary beside the map, and keeps Studio tools available as overlay drawers. The separate Map Focus tab, its analytical deck and its workspace-layout configuration were removed. Screening Room remains a separate workspace.

Layer controls operate the existing Studio track collapse state. Fullscreen Score remains available. Map Focus's sound, loudness and speech controls are now under Structure > Sound, loudness & speech. The ordinary Studio panel dimensions are untouched by expanding; restoring also restores whether the tool drawer was open.

At narrow widths the preview sits above the map; shot inspection remains available through the monitor's inspector action. The map scrolls horizontally, and its fixed track labels follow vertical scrolling. Story label height follows the actual story lane height.

## Files inspected and changed

- src/app/App.tsx
- src/app/styles.css
- src/components/ProjectHeader.tsx
- src/hooks/useWorkspaceLayout.ts
- src/timeline/EditingMap.tsx
- tests/browser/fullscreen-graph.spec.ts
- tests/browser/screening-review.spec.ts

Added: tests/browser/studio-expanded-map.spec.ts and this report.

Also inspected, unchanged: AGENTS.md, package.json, playwright.config.ts, src/components/MapShotSummary.tsx, tests/browser/studio-simplification.spec.ts, tests/browser/workspace-modes.spec.ts. Existing unrelated working-tree changes were preserved.

## Verification

- npm run build: passed; Vite reports a bundle-size warning.
- npm test: 116 passed.
- server/.venv/bin/python -m unittest discover -s server -p 'test_*.py': 31 passed.
- Targeted Playwright run against http://127.0.0.1:5173: expanded Studio, fullscreen visualization (two tests), and Screening Room all passed.
- Expanded Studio assertions cover removal of the Map Focus tab, video/timeline DOM identity, selected shot and zoom retention, continued playback through expand/restore, layer folding, overlay drawer operation, restoration of drawer visibility, track-label alignment, and responsive widths of 1440, 1024 and 390 pixels.
- Screenshots visually inspected: tests/browser/screenshots/studio-expanded-map-desktop.png and studio-expanded-map-390.png. Tablet screenshot: studio-expanded-map-1024.png.

Browser checks use the local synthetic test-film.mp4 fixture, not a representative feature film. This was a targeted browser run, not the entire legacy browser suite; older tests outside the updated specs still refer to the removed Map Focus tab and require migration before a full-suite run.
