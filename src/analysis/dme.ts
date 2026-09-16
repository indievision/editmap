import type { DmeWaveforms } from "../models/project";
import { fetchLocalModel } from "./localModel";

export async function checkDmeService(): Promise<{
  available: boolean;
  status: string;
  device?: string;
}> {
  try {
    const res = await fetchLocalModel("/api/dme-status", { method: "GET" });
    if (!res.ok) return { available: false, status: "offline" };
    const data = await res.json();
    return {
      available: true,
      status: data.status,
      device: data.device,
    };
  } catch {
    return { available: false, status: "offline" };
  }
}

export async function separateDmeAudio(
  file: File,
  binCount = 1400,
  onProgress?: (statusText: string) => void,
  signal?: AbortSignal,
): Promise<DmeWaveforms> {
  const controller = new AbortController();
  const abort = () => controller.abort();
  signal?.addEventListener("abort", abort, { once: true });
  const deadline = setTimeout(abort, 4 * 60 * 60 * 1000);
  let jobId: string | undefined;
  try {
    signal?.throwIfAborted();
    onProgress?.("Sending media to the local DME engine...");
    const formData = new FormData();
    formData.append("file", file, file.name);
    formData.append("binCount", String(binCount));
    jobId = crypto.randomUUID();
    formData.append("jobId", jobId);
    const response = await fetchLocalModel("/api/separate-dme", { method: "POST", body: formData, signal: controller.signal });
    if (!response.ok) {
      const error = await response.json().catch(() => null);
      throw new Error(typeof error?.detail === "string" ? error.detail : `DME request failed (HTTP ${response.status}).`);
    }
    const started = await response.json();
    if (typeof started.jobId !== "string") throw new Error("Invalid DME job response.");
    jobId = started.jobId;
    while (true) {
      controller.signal.throwIfAborted();
      const response = await fetchLocalModel(`/api/dme-jobs/${encodeURIComponent(jobId!)}`, { method: "GET", signal: controller.signal });
      if (!response.ok) throw new Error(`DME status failed (HTTP ${response.status}).`);
      const job = await response.json();
      if (job.status === "failed" || job.status === "cancelled") throw new Error(job.error ?? "DME separation cancelled.");
      if (job.status === "complete") {
        const data = job.result;
        if (!data || !Number.isFinite(data.duration) || data.duration <= 0 || data.binCount !== binCount || ![data.dialogue, data.music, data.effects].every(a => Array.isArray(a) && a.length === binCount && a.every(v => Number.isFinite(v) && v >= 0 && v <= 1))) throw new Error("Invalid DME waveform response.");
        jobId = undefined;
        return { dialogue: data.dialogue, music: data.music, effects: data.effects, binCount, duration: data.duration, separatedAt: new Date().toISOString() };
      }
      onProgress?.(`Separating Dialogue, Music, and Effects · ${Math.round((job.progress ?? 0) * 100)}%`);
      await new Promise<void>((resolve, reject) => {
        const stop = () => { clearTimeout(timer); reject(new DOMException("Cancelled", "AbortError")); };
        const timer = setTimeout(() => { controller.signal.removeEventListener("abort", stop); resolve(); }, 1000);
        controller.signal.addEventListener("abort", stop, { once: true });
        if (controller.signal.aborted) stop();
      });
    }
  } finally {
    clearTimeout(deadline);
    signal?.removeEventListener("abort", abort);
    if (jobId) await fetchLocalModel(`/api/dme-jobs/${encodeURIComponent(jobId)}`, { method: "DELETE", signal: AbortSignal.timeout(5000) }).catch(() => undefined);
  }
}
