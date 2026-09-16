# EDITMAP AI Agent & Development Guidelines

## Core Philosophy
> **"Editing is emotion, story, and rhythm. From all these, rhythm is measurable. That's why EditMap."**
> Every feature, metric, and visualization in EditMap exists to translate the intangible emotion and narrative flow of a film into concrete, measurable rhythmic architecture (pacing waves, cut frequency, visual deltas, sensory shock, framing elevation, and sonic rivers).

## Local Vision Model (Ollama)
- This project integrates with a local Ollama instance running `qwen3-vl:4b` on `http://127.0.0.1:11434`.
- **CRITICAL**: When starting the development server (`npm run dev` / `vite`), you MUST run the command with `BypassSandbox: true`!
  - Running Vite inside the sandbox restricts host network access, causing Vite's proxy to fail with `connect EPERM 127.0.0.1:11434` (HTTP 500 error).
  - Outside the sandbox, Vite proxy communicates seamlessly with Ollama.
- **Direct Fallback**: The client-side code uses `fetchLocalModel`, which attempts the Vite proxy first (`/local-model/api/chat`), and if a proxy failure occurs, automatically falls back to connecting directly to `http://127.0.0.1:11434/api/chat`.

## Scanning Architecture
- **Step 1: Shot Sizes & Composition**: Scans unconfirmed shots for scale, people count, and subject category using one frame per shot. Decoupled from character detection.
- **Step 2: Character Appearances & Auto-Discovery**:
  - **Auto-Discovery Mode**: Scans shots where people are present (`isEligibleForCharacterScan`), extracts normalized ArcFace embeddings and cropped face avatars via `/api/detect-shot-faces`, and groups them into `Character 1`, `Character 2`, etc., via `/api/cluster-faces`.
  - **Targeted Scan Mode**: When reference images exist, compares faces directly against established cast members.
  - **Editing**: Users can rename auto-discovered characters (`Character 1` -> `Anna`) directly in the Cast Gallery or merge split characters.
