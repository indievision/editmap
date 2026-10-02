import {
  AdaptiveCutDetector,
  buildShotsFromCuts,
  computeFrameDelta,
  type SceneDetectionOptions,
} from "./sceneDetection";
import { fetchLocalModel } from "./localModel";
import type { Shot } from "../models/project";

export interface ScanProgress {
  percent: number; // 0 to 100
  currentTime: number;
  totalDuration: number;
  shotsCount: number;
  detector?: "transnet" | "browser";
}

export interface VideoScanOptions extends SceneDetectionOptions {
  /**
   * Sampling stride in seconds. Default: 0.25s (approx 4 samples per second).
   * Ensures no rapid cuts or short shots are skipped.
   */
  sampleIntervalSeconds?: number;
  /**
   * Frame rate of the project (e.g. 24, 25, 29.97).
   */
  fps?: number;
  /**
   * Drop frame timecode flag.
   */
  dropFrame?: boolean;
  /**
   * Callback fired as scanning progresses.
   */
  onProgress?: (progress: ScanProgress) => void;
  /**
   * Abort signal to cancel detection.
   */
  signal?: AbortSignal;
  /** Reports which scanner produced the cut map for truthful progress copy. */
  onDetector?: (detector: "transnet" | "browser", reason?: string) => void;
}

const CANVAS_WIDTH = 160;
const CANVAS_HEIGHT = 90;

/**
 * Scans an HTML video source to automatically detect scene cuts and return EDITMAP Shot objects.
 * Uses high-speed fixed-anchor binary search boundary refinement.
 */
interface TransNetShotResponse {
  start_seconds: number;
  end_seconds: number;
  transition_type?: "cut" | "soft";
}

interface TransNetResponse {
  fps: number;
  model_backend: "onnx" | "torch" | "heuristic";
  shots: TransNetShotResponse[];
}

interface TransNetStatusResponse { available: boolean; }

async function detectVideoShotsWithTransNet(
  file: File,
  options: VideoScanOptions,
): Promise<Shot[]> {
  const { dropFrame = false, onProgress, signal, onDetector } = options;
  signal?.throwIfAborted();
  onProgress?.({ percent: 0, currentTime: 0, totalDuration: 0, shotsCount: 0, detector: "transnet" });

  const status = await fetchLocalModel("/api/detect-shots-status", { method: "GET", signal });
  const availability = status.ok ? await status.json() as TransNetStatusResponse : null;
  if (!availability?.available) throw new Error("TransNet V2 weights are not available locally.");

  const form = new FormData();
  form.append("file", file, file.name);
  form.append("threshold", "0.5");
  form.append("min_shot_len_frames", "10");
  const response = await fetchLocalModel("/api/detect-shots-upload", {
    method: "POST",
    body: form,
    signal,
  });
  if (!response.ok) {
    const detail = await response.json().catch(() => null);
    throw new Error(typeof detail?.detail === "string" ? detail.detail : `TransNet V2 unavailable (HTTP ${response.status}).`);
  }

  const result = await response.json() as TransNetResponse;
  if (!Array.isArray(result.shots) || !Number.isFinite(result.fps) || result.fps <= 0) {
    throw new Error("TransNet V2 returned an invalid shot map.");
  }
  // Do not silently present the backend's visual-difference fallback as TransNet V2.
  if (result.model_backend !== "onnx" && result.model_backend !== "torch") {
    throw new Error("TransNet V2 weights are not available locally.");
  }
  const duration = result.shots.at(-1)?.end_seconds ?? 0;
  const projectFps = options.fps ?? result.fps;
  const shots = buildShotsFromCuts(
    result.shots.slice(1).map((shot) => shot.start_seconds),
    duration,
    projectFps,
    dropFrame,
    1 / result.fps,
  ).map((shot) => {
    const source = result.shots.find((candidate) => Math.abs(candidate.start_seconds - shot.startSeconds) < 1 / result.fps);
    return { ...shot, transition: source?.transition_type === "soft" ? "SOFT" : "CUT" };
  });
  onDetector?.("transnet");
  onProgress?.({ percent: 100, currentTime: duration, totalDuration: duration, shotsCount: shots.length, detector: "transnet" });
  return shots;
}

/**
 * Prefer the local TransNet V2 engine whenever the original file is available.
 * Browser-side adaptive detection is retained only for unlinked media and
 * unavailable/misconfigured local model weights.
 */
export async function detectVideoShots(
  videoSource: string | File,
  options: VideoScanOptions = {},
): Promise<Shot[]> {
  if (videoSource instanceof File) {
    try {
      return await detectVideoShotsWithTransNet(videoSource, options);
    } catch (error) {
      if (options.signal?.aborted) throw error;
      console.warn("TransNet V2 cut scan unavailable; using browser fallback.", error);
      options.onDetector?.("browser", error instanceof Error ? error.message : "TransNet V2 unavailable.");
      const objectUrl = URL.createObjectURL(videoSource);
      try {
        return await detectVideoShotsInBrowser(objectUrl, options);
      } finally {
        URL.revokeObjectURL(objectUrl);
      }
    }
  }
  options.onDetector?.("browser");
  return detectVideoShotsInBrowser(videoSource, options);
}

async function detectVideoShotsInBrowser(
  videoUrl: string,
  options: VideoScanOptions = {},
): Promise<Shot[]> {
  const {
    sampleIntervalSeconds = 0.5,
    fps = 24,
    dropFrame = false,
    adaptiveThreshold = 2.8,
    minContentVal = 16.0,
    minShotDurationSeconds = 0.4,
    windowWidth = 8,
    onProgress: reportProgress,
    signal,
  } = options;
  const onProgress = (progress: ScanProgress) => reportProgress?.({ ...progress, detector: "browser" });

  return new Promise<Shot[]>((resolve, reject) => {
    if (signal?.aborted) {
      return reject(new DOMException("Aborted", "AbortError"));
    }

    const video = document.createElement("video");
    video.muted = true;
    video.preload = "auto";
    video.playsInline = true;
    video.style.cssText = "position:fixed;top:-9999px;left:-9999px;width:1px;height:1px;opacity:0;pointer-events:none;z-index:-1;";
    if (typeof document !== "undefined" && document.body) {
      document.body.appendChild(video);
    }

    const canvas = document.createElement("canvas");
    canvas.width = CANVAS_WIDTH;
    canvas.height = CANVAS_HEIGHT;
    const ctx = canvas.getContext("2d", { willReadFrequently: true });

    if (!ctx) {
      if (video.parentNode) video.parentNode.removeChild(video);
      return reject(new Error("Could not create 2D canvas context for scene detection."));
    }

    const detector = new AdaptiveCutDetector({
      adaptiveThreshold,
      minContentVal,
      minShotDurationSeconds,
      windowWidth,
    });

    const cleanup = () => {
      video.removeAttribute("src");
      video.load();
      if (video.parentNode) {
        video.parentNode.removeChild(video);
      }
    };

    signal?.addEventListener("abort", () => {
      cleanup();
      reject(new DOMException("Aborted", "AbortError"));
    }, { once: true });

    video.onerror = () => {
      cleanup();
      reject(new Error("Failed to load video for scene detection."));
    };

    const runDetection = async () => {
      try {
        const duration = video.duration;
        if (!duration || duration <= 0 || !Number.isFinite(duration)) {
          cleanup();
          return resolve([]);
        }

        // Immediately report 0% with total duration so live timecode displays right away
        onProgress({
          percent: 0,
          currentTime: 0,
          totalDuration: duration,
          shotsCount: 1,
        });

        const effectiveStride = options.sampleIntervalSeconds ?? (
          duration > 300 ? 1.0 : (duration > 120 ? 0.75 : 0.5)
        );

        const seekTo = (targetSeconds: number): Promise<void> =>
          new Promise<void>((res, rej) => {
            const target = Math.min(Math.max(0, targetSeconds), duration - 0.001);
            if (Math.abs(video.currentTime - target) < 0.001) {
              res();
              return;
            }

            const onSeeked = () => {
              cleanupListeners();
              res();
            };
            const onError = () => {
              cleanupListeners();
              rej(new Error("Seek failed"));
            };
            const onAbort = () => {
              cleanupListeners();
              rej(new DOMException("Aborted", "AbortError"));
            };
            const timeout = setTimeout(() => {
              cleanupListeners();
              rej(new Error("Seek timeout"));
            }, 8000);

            const cleanupListeners = () => {
              clearTimeout(timeout);
              video.removeEventListener("seeked", onSeeked);
              video.removeEventListener("error", onError);
              signal?.removeEventListener("abort", onAbort);
            };

            video.addEventListener("seeked", onSeeked, { once: true });
            video.addEventListener("error", onError, { once: true });
            signal?.addEventListener("abort", onAbort, { once: true });

            video.currentTime = target;
          });

        let currentTime = 0;
        let lastFrameData: Uint8ClampedArray | null = null;
        let lastSampleTime = 0;
        let sampleCount = 0;

        while (currentTime < duration) {
          if (signal?.aborted) throw new DOMException("Aborted", "AbortError");

          await seekTo(currentTime);

          ctx.drawImage(video, 0, 0, CANVAS_WIDTH, CANVAS_HEIGHT);
          const frameImg = ctx.getImageData(0, 0, CANVAS_WIDTH, CANVAS_HEIGHT);
          const currentFrameData = frameImg.data;

          if (lastFrameData) {
            const delta = computeFrameDelta(currentFrameData, lastFrameData);
            const frameDuration = 1 / fps;
            const timeSpan = currentTime - lastSampleTime;

            // If delta indicates a likely cut between lastSampleTime and currentTime,
            // refine boundary with fixed-anchor binary search
            if (delta >= minContentVal && timeSpan > 1.5 * frameDuration) {
              let tLow = lastSampleTime;
              let tHigh = currentTime;
              let frameHigh = currentFrameData;

              const maxIters = Math.min(4, Math.ceil(Math.log2(timeSpan / frameDuration)));
              for (let iter = 0; iter < maxIters && (tHigh - tLow) > frameDuration; iter++) {
                if (signal?.aborted) throw new DOMException("Aborted", "AbortError");

                const tMid = (tLow + tHigh) / 2;
                await seekTo(tMid);
                ctx.drawImage(video, 0, 0, CANVAS_WIDTH, CANVAS_HEIGHT);
                const midData = ctx.getImageData(0, 0, CANVAS_WIDTH, CANVAS_HEIGHT).data;
                const deltaFromStart = computeFrameDelta(midData, lastFrameData);

                if (deltaFromStart >= delta * 0.7) {
                  tHigh = tMid;
                  frameHigh = midData;
                } else {
                  tLow = tMid;
                }
              }

              // Register cut at refined boundary
              detector.processFrame(frameHigh, tHigh);

              if (currentTime - tHigh > frameDuration) {
                detector.processFrame(currentFrameData, currentTime);
                lastFrameData = new Uint8ClampedArray(currentFrameData);
                lastSampleTime = currentTime;
              } else {
                lastFrameData = new Uint8ClampedArray(frameHigh);
                lastSampleTime = tHigh;
              }
            } else {
              detector.processFrame(currentFrameData, currentTime);
              lastFrameData = new Uint8ClampedArray(currentFrameData);
              lastSampleTime = currentTime;
            }
          } else {
            detector.processFrame(currentFrameData, currentTime);
            lastFrameData = new Uint8ClampedArray(currentFrameData);
            lastSampleTime = currentTime;
          }

          // Advance time with effective stride
          currentTime += effectiveStride;
          sampleCount++;

          // Notify progress
          if (onProgress) {
            const percent = Math.min(100, Math.round((currentTime / duration) * 100));
            onProgress({
              percent,
              currentTime: Math.min(currentTime, duration),
              totalDuration: duration,
              shotsCount: detector.getCuts().length + 1,
            });
          }

          // Periodic yield to UI event loop and hardware video decoder
          if (sampleCount % 2 === 0) {
            await new Promise((r) => setTimeout(r, 16));
          }
        }

        const cuts = detector.getCuts();
        const shots = buildShotsFromCuts(cuts, duration, fps, dropFrame, 0.25);

        cleanup();
        resolve(shots);
      } catch (err) {
        cleanup();
        reject(err);
      }
    };

    if (video.readyState >= 1) {
      void runDetection();
    } else {
      video.onloadedmetadata = () => void runDetection();
    }

    video.src = videoUrl;
    video.load();
  });
}
