import { fetchLocalModel } from "./localModel";

const MAX_CONSECUTIVE_FAILURES = 5;

const sleep = (ms: number, signal: AbortSignal) =>
  new Promise<void>((resolve, reject) => {
    const stop = () => {
      clearTimeout(timer);
      reject(new DOMException("Cancelled", "AbortError"));
    };
    const timer = setTimeout(() => {
      signal.removeEventListener("abort", stop);
      resolve();
    }, ms);
    signal.addEventListener("abort", stop, { once: true });
    if (signal.aborted) stop();
  });

/**
 * Fetches one job-status snapshot, riding out transient failures (network
 * blips, 429/5xx) with exponential backoff so a hiccup never abandons -- and
 * thereby cancels -- a long-running backend job. A 404 (job lost, e.g. after a
 * backend restart) or any other 4xx is permanent and fails immediately.
 */
export async function fetchJobStatus<T>(url: string, label: string, signal: AbortSignal): Promise<T> {
  let failures = 0;
  for (;;) {
    signal.throwIfAborted();
    let status = 0;
    try {
      const response = await fetchLocalModel(url, { method: "GET", signal });
      if (response.ok) return (await response.json()) as T;
      status = response.status;
      if (status === 404) throw new Error(`${label} job was lost (the local engine may have restarted).`);
      if (status < 500 && status !== 429) throw new Error(`${label} status failed (HTTP ${status}).`);
    } catch (error) {
      if (signal.aborted || (error instanceof Error && /job was lost|status failed/.test(error.message))) throw error;
    }
    if (++failures >= MAX_CONSECUTIVE_FAILURES) {
      throw new Error(`Lost contact with the local engine while checking ${label} status${status ? ` (HTTP ${status})` : ""}.`);
    }
    await sleep(Math.min(1000 * 2 ** failures, 10_000), signal);
  }
}
