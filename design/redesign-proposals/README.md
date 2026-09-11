# EDITMAP — three redesign proposals

## 1. Current state

Captured `current-main-window.png` from the actual Chrome window at http://127.0.0.1:5173/ after opening the most recent saved project, “Untitled film”. It contains three shots at 24 FPS. Its video needs relinking; the screenshot represents that actual state. Concept images use fictional footage and project data, not analysis results.

The existing layout has an analytical deck on the left, a film monitor on the right, and a duration-scaled editing map below. The dark graphite and champagne accent already suit the product.

## 2. Problem

- The header exposes twelve competing actions, including infrequent file operations.
- Two rows of analytical tabs compete for limited horizontal space.
- Shot inspection occupies an analysis tab, making it harder to keep analysis and shot details visible together.
- Tagging shortcuts and review filters share a crowded map toolbar.
- Small text, many borders, and similar button treatments weaken hierarchy.
- The map has less visual prominence than its importance to the product warrants.

## 3. Proposed fix

### Version 1 — Studio: recommended default

A balanced workspace with labeled navigation, analysis at left, a monitor in the center, an independent shot inspector at right, and a substantial editing map below.

Keep common commands visible: Import, Analyze, Export. Group New/Open/Save and backup operations in a labeled Project menu; retain direct Save access or a clear unsaved-state action. Do not imply autosave unless implemented. Import opens Video/EDL/Project options; Export opens Project/PDF options. Keep Undo available next to review actions and via its existing shortcut.

Replace nested tab rows with one section navigation and one clearly labeled analysis selector. A persistent inspector allows users to select a shot, check its context, edit tags, and confirm without losing the chart. Cuts remain directly accessible from navigation or a selected boundary.

Best for everyday use and the smallest coherent evolution of the existing app. Tradeoff: three upper panels need a wide screen. Below approximately 1280px, open the inspector as a drawer; keep the map and monitor visible.

### Version 2 — Map Focus: best for understanding the film

Give most of the viewport to the duration-scaled map. Keep a compact monitor and sequence context above it. Align framing, cast, scene boundaries, and sound information to a shared ruler; offer a Layers control to hide unnecessary lanes.

Keep film-wide navigation and zoom visible. Selecting a shot opens its inspector; selecting a boundary opens cut analysis; selecting a range opens sequence analysis. A whole-film overview retains position when zoomed in.

Best for rhythm, structure, and comparison across sequences. Tradeoff: detailed shot editing needs an inspector drawer, and additional aligned lanes require more implementation work. Character lanes must distinguish confirmed temporal intervals from shot-level presence; manual shot assignment must not imply exact screen time.

### Version 3 — Review Desk: best for fast manual confirmation

A searchable review queue at left, a large monitor in the center, and a clear classification form at right. A compact map stays visible beneath them. Display why each shot is queued: unreviewed, uncertain, or failed.

Use full shot-size names with existing keyboard hints. Keep People, Subject, and Cast together. Make Confirm & next the clear primary action; keep Mark uncertain, Skip, and Undo readily accessible. Advance only after explicit confirmation or the user's chosen auto-advance behavior. Preserve the selected shot and queue position when switching views.

Best for validating local model suggestions. Tradeoff: less simultaneous analytical context. It could become a dedicated mode alongside Studio rather than replace the default workspace.

### Shared interaction and visual rules

- Preserve graphite surfaces and restrained champagne selection/action accents. Reserve semantic colors for framing and status.
- Target 14px body/control text, 12px secondary labels, a consistent spacing scale, and comfortably sized pointer targets. Use 44px targets for touch layouts.
- Make keyboard focus visible and expose names for every icon. Tooltips supplement labels; they do not replace them.
- Distinguish Unreviewed, Suggested, Confirmed, Uncertain, and Failed with words and icons, not color alone. Exact status mapping must follow the existing data model.
- Keep timecode and explicit FPS visible; preserve EDL record boundaries and duration-scaled shots.
- Analysis should expose its scope, progress, cancel/resume behavior, and failures. Protect confirmed/manual classifications. Rebuilding shot boundaries needs a clear separate action.
- Keep media processing local. Show an actionable Relink video state and preserve already available project data.
- On smaller windows, collapse optional panels instead of shrinking all controls. Avoid making the page a long dashboard that loses the map offscreen.

## 4. Files affected

Inspected: `AGENTS.md`, `package.json`, `src/app/App.tsx`, `src/app/styles.css`, `src/timeline/EditingMap.tsx`.

Created only proposal artifacts in `design/redesign-proposals/`. No application source files were changed.

An implementation would primarily affect `src/app/App.tsx`, `src/app/styles.css`, and `src/timeline/EditingMap.tsx`; existing analysis components should be reused. Additional focused components can hold the project toolbar and inspector if extraction reduces the size of App.tsx.

## 5. Risks / edge cases

These are visual concepts, not tested interactive implementations. Generated chart values, footage, and shortcut labels are illustrative; existing shortcut bindings must be retained and conflicts checked during implementation. Do not infer new data capabilities from mockup lanes.

Specific visual corrections before implementation: Studio's generated Add shot/Split/Set in/Set out/Remove toolbar is outside this proposal and should be replaced with the existing tagging actions. Its chart and thumbnail widths are layout illustrations, not accurate duration data. Use the existing chronological shot-duration chart. Omit generated metadata such as inferred location unless supported by real project data. Keep Cuts explicitly accessible. Do not use the generated S shortcut for confirmation without checking existing bindings. Avoid making Export the dominant accent when review confirmation is the active task.

Validate the chosen direction with real long projects, very short adjacent shots, missing video, incomplete scans, keyboard-only use, and 1280px-wide windows. Check readable contrast, discoverability of grouped commands, and whether playback and map interaction remain responsive.

## 6. Summary of changes

Captured the current workspace and proposed three layouts. Start with Studio, preserve the existing components and visual identity, and consider Review Desk as a focused secondary mode. Use Map Focus if structural analysis is the dominant daily activity.

Mockups were generated with the built-in image generation tool. The exact prompts are saved in `prompts.json`.
