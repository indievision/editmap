import type { LoudnessAnalysis } from "../models/project";
import { fetchLocalModel } from "./localModel";
import { fetchJobStatus } from "./jobPolling";

export type LoudnessJob = {
  status: string;
  progress?: number;
  elapsedSeconds?: number;
  etaSeconds?: number;
  phase?: string;
  error?: string;
  result?: LoudnessAnalysis;
};

const wait = (signal: AbortSignal) =>
  new Promise<void>((resolve, reject) => {
    const timer = setTimeout(resolve, 1000);
    signal.addEventListener(
      "abort",
      () => {
        clearTimeout(timer);
        reject(new DOMException("Cancelled", "AbortError"));
      },
      { once: true },
    );
  });

export async function scanLoudnessAudio(
  file: File,
  signature: string,
  onProgress: (job: LoudnessJob) => void,
  signal?: AbortSignal,
  binCount = 1400,
): Promise<LoudnessAnalysis> {
  const controller = new AbortController();
  const abort = () => controller.abort();
  signal?.addEventListener("abort", abort, { once: true });

  let jobId: string | undefined;
  try {
    const form = new FormData();
    jobId = crypto.randomUUID();
    form.append("file", file, file.name);
    form.append("jobId", jobId);
    form.append("binCount", String(binCount));

    const started = await fetchLocalModel("/api/scan-loudness", {
      method: "POST",
      body: form,
      signal: controller.signal,
    });

    if (!started.ok) {
      throw new Error(
        (await started.json().catch(() => null))?.detail ??
          `Loudness scan request failed (HTTP ${started.status}).`,
      );
    }

    jobId = (await started.json()).jobId;

    while (jobId) {
      controller.signal.throwIfAborted();
      const job = await fetchJobStatus<LoudnessJob>(
        `/api/loudness-jobs/${encodeURIComponent(jobId)}`,
        "Loudness",
        controller.signal,
      );
      onProgress(job);

      if (job.status === "complete" && job.result) {
        const result = job.result;
        jobId = undefined;
        return {
          ...result,
          mediaSignature: signature,
          scannedAt: new Date().toISOString(),
        };
      }

      if (job.status === "failed" || job.status === "cancelled") {
        throw new Error(job.error ?? "Loudness scan cancelled.");
      }

      await wait(controller.signal);
    }

    throw new Error("Invalid loudness scan response.");
  } finally {
    signal?.removeEventListener("abort", abort);
    if (jobId) {
      await fetchLocalModel(`/api/loudness-jobs/${encodeURIComponent(jobId)}`, {
        method: "DELETE",
        signal: AbortSignal.timeout(5000),
      }).catch(() => undefined);
    }
  }
}
