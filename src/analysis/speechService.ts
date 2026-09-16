import type { SpeechAnalysis, SpeechRegion } from "../models/project";
import { normalizeSpeechRegions } from "./speech";
import { fetchLocalModel } from "./localModel";

type SpeechJob = { status: string; progress?: number; elapsedSeconds?: number; etaSeconds?: number; phase?: string; error?: string; result?: { regions: SpeechRegion[]; duration: number; model: string; modelVersion: string; settingsVersion: string; threshold: number; minSpeechMs: number; minSilenceMs: number; processingSeconds: number } };
const wait = (signal: AbortSignal) => new Promise<void>((resolve, reject) => {
  const timer = setTimeout(resolve, 1000);
  signal.addEventListener("abort", () => { clearTimeout(timer); reject(new DOMException("Cancelled", "AbortError")); }, { once: true });
});

export async function scanSpeechAudio(file: File, signature: string, onProgress: (job: SpeechJob) => void, signal?: AbortSignal): Promise<SpeechAnalysis> {
  const controller = new AbortController(), abort = () => controller.abort(); signal?.addEventListener("abort", abort, { once: true });
  let jobId: string | undefined;
  try {
    const form = new FormData(); jobId = crypto.randomUUID(); form.append("file", file, file.name); form.append("jobId", jobId);
    const started = await fetchLocalModel("/api/scan-speech", { method: "POST", body: form, signal: controller.signal });
    if (!started.ok) throw new Error((await started.json().catch(() => null))?.detail ?? `Speech scan request failed (HTTP ${started.status}).`);
    jobId = (await started.json()).jobId;
    while (jobId) {
      controller.signal.throwIfAborted();
      const response = await fetchLocalModel(`/api/speech-jobs/${encodeURIComponent(jobId)}`, { signal: controller.signal });
      if (!response.ok) throw new Error(`Speech status failed (HTTP ${response.status}).`);
      const job = await response.json() as SpeechJob; onProgress(job);
      if (job.status === "complete" && job.result) {
        const result = job.result; jobId = undefined;
        return { ...result, model: "silero-vad", modelVersion: "6.2.0", settingsVersion: "vad-1", regions: normalizeSpeechRegions(result.regions, result.duration), mediaSignature: signature, scannedAt: new Date().toISOString() };
      }
      if (job.status === "failed" || job.status === "cancelled") throw new Error(job.error ?? "Speech scan cancelled.");
      await wait(controller.signal);
    }
    throw new Error("Invalid speech scan response.");
  } finally {
    signal?.removeEventListener("abort", abort);
    if (jobId) await fetchLocalModel(`/api/speech-jobs/${encodeURIComponent(jobId)}`, { method: "DELETE", signal: AbortSignal.timeout(5000) }).catch(() => undefined);
  }
}
