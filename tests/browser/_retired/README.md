# Retired browser specs

These specs target the pre-redesign single-page UI (welcome screen, inline scan
panel, shot-size select, ...) and fail against the current four-mode shell
(Screening / Review / Studio / Explore). They are excluded from the run via
`testIgnore` in `playwright.config.ts`, not deleted, so each can be revived by
porting it to the current UI and moving it back to `tests/browser/`.

Shared entry helper: `../helpers.ts` (`startNewProject`).
Maintained replacements live in `core-flow.spec.ts` and `analysis-scan.spec.ts`.
