# EDITMAP AI Agent & Development Guidelines

## Core Philosophy
> **"Editing is emotion, story, and rhythm. From all these, rhythm is measurable. That's why EditMap."**
> Every feature, metric, and visualization in EditMap exists to translate the intangible emotion and narrative flow of a film into concrete, measurable rhythmic architecture (pacing waves, cut frequency, visual deltas, sensory shock, framing elevation, and sonic rivers).

## Local CV backend
- The current backend is FastAPI on `http://127.0.0.1:8000`, using YOLO for framing, InsightFace / face_recognition for identities, and Demucs for DME. Ollama is not required by this checkout.
- Start Vite outside the sandbox with host-network access (`require_escalated` in Codex). Sandboxed proxies can fail with `connect EPERM`.
- `fetchLocalModel` tries the Vite `/api` proxy, then the loopback backend on transport/proxy failure. It obtains a local session token when requested by the backend.
- Keep the service bound to loopback. Do not weaken origin/token checks. See `server/README.md` for limits, jobs, and model provisioning.
- Run `npm run build`, `npm test`, and `server/.venv/bin/python -m unittest discover -s server -p 'test_*.py'` after relevant changes. Browser tests require the development server with `PLAYWRIGHT_BASE_URL` set to its URL.

## Scanning Architecture
- **Step 1: Shot Sizes & Composition**: Scans unconfirmed shots for scale, people count, and subject category using one frame per shot. Decoupled from character detection.
- **Step 2: Character Appearances & Auto-Discovery**:
  - **Auto-Discovery Mode**: Scans shots where people are present (`isEligibleForCharacterScan`), extracts normalized ArcFace embeddings and cropped face avatars via `/api/detect-shot-faces`, and groups them into `Character 1`, `Character 2`, etc., via `/api/cluster-faces`.
  - **Targeted Scan Mode**: When reference images exist, compares faces directly against established cast members.
  - **Editing**: Users can rename auto-discovered characters (`Character 1` -> `Anna`) directly in the Cast Gallery or merge split characters.

## Local screening server (DUET) and access
- `duet_server.cjs` (port 3000) is loopback-only by default. Wi-Fi access is opt-in with `EDITMAP_DUET_LAN=1` and requires the per-launch join secret (cookie set by the join link). Never bind it to `0.0.0.0` without that check, and never serve files from outside `uploads/` and `public/`. The access rules are covered by `tests/duetServer.test.ts`.
- The CV backend only accepts the Vite origins listed in `server/local_access.py` (extend with `EDITMAP_ORIGINS`). Do not reintroduce endpoints that take filesystem paths.

## Playback clock
- Playback time lives in `src/playback/playhead.ts`, not in React state. Read it with `playhead.get()` in handlers and `usePlayhead(active)` / `usePlayheadSelector` in components. Do not pass the time down as a prop from `App`.

## Testing
- Unit: `npm test`. Python: `server/.venv/bin/python -m unittest discover -s server -p 'test_*.py'`. Browser: Playwright against a running dev server (`PLAYWRIGHT_BASE_URL`); build specs on `tests/browser/helpers.ts`. Specs for the old UI live in `tests/browser/_retired/`. CI runs all three on pull requests.
