import { fetchLocalModel } from "./localModel";
import type { CameraMovementType, MotionProfile, Shot } from "../models/project";

const SAMPLE_WIDTH = 160;
const SAMPLE_HEIGHT = 90;

export interface FramePair {
  frameA: string;
  frameB: string;
}

/**
 * Samples two pairs of adjacent frames from a shot using an offscreen video decoder.
 * E.g. at 25% and 75% of the shot duration.
 */
export async function sampleShotMotionPairs(
  videoUrl: string,
  shot: Shot,
  signal?: AbortSignal
): Promise<FramePair[]> {
  return new Promise((resolve) => {
    if (signal?.aborted || !videoUrl || shot.duration < 0.1) {
      resolve([]);
      return;
    }

    const video = document.createElement("video");
    video.muted = true;
    video.preload = "auto";
    video.crossOrigin = "anonymous";

    const canvas = document.createElement("canvas");
    canvas.width = SAMPLE_WIDTH;
    canvas.height = SAMPLE_HEIGHT;
    const ctx = canvas.getContext("2d", { willReadFrequently: true });
    if (!ctx) {
      resolve([]);
      return;
    }

    let cleanedUp = false;
    const cleanup = () => {
      if (cleanedUp) return;
      cleanedUp = true;
      video.removeAttribute("src");
      video.load();
    };

    const waitEvent = (event: string, timeoutMs = 4000) =>
      new Promise<void>((res, rej) => {
        const timer = setTimeout(() => rej(new Error("Timeout")), timeoutMs);
        const handler = () => {
          clearTimeout(timer);
          res();
        };
        video.addEventListener(event, handler, { once: true });
        video.addEventListener(
          "error",
          () => {
            clearTimeout(timer);
            rej(new Error("Video error"));
          },
          { once: true }
        );
      });

    const captureFrameAt = async (time: number): Promise<string> => {
      const clamped = Math.max(0, Math.min(time, video.duration - 0.01));
      const seekPromise = waitEvent("seeked", 3000);
      video.currentTime = clamped;
      await seekPromise;
      ctx.drawImage(video, 0, 0, SAMPLE_WIDTH, SAMPLE_HEIGHT);
      return canvas.toDataURL("image/jpeg", 0.75);
    };

    void (async () => {
      try {
        const readyPromise = waitEvent("loadeddata", 5000);
        video.src = videoUrl;
        await readyPromise;

        const duration = shot.duration;
        const t1 = shot.startSeconds + duration * 0.25;
        const dt = Math.min(0.08, duration * 0.1);
        const t2 = shot.startSeconds + duration * 0.75;

        const p1_a = await captureFrameAt(t1);
        const p1_b = await captureFrameAt(t1 + dt);

        const pairs: FramePair[] = [{ frameA: p1_a, frameB: p1_b }];

        if (duration > 0.8) {
          const p2_a = await captureFrameAt(t2);
          const p2_b = await captureFrameAt(t2 + dt);
          pairs.push({ frameA: p2_a, frameB: p2_b });
        }

        cleanup();
        resolve(pairs);
      } catch {
        cleanup();
        resolve([]);
      }
    })();
  });
}

/**
 * Fast client-side motion estimator using 8x8 block matching and robust statistics.
 * Separates dominant background displacement (Camera) from residual outlier displacement (Subject).
 */
export async function extractClientMotion(
  frameADataUrl: string,
  frameBDataUrl: string
): Promise<MotionProfile> {
  return new Promise((resolve) => {
    const imgA = new Image();
    const imgB = new Image();
    let loaded = 0;

    const checkBoth = () => {
      loaded++;
      if (loaded === 2) {
        computeMotion();
      }
    };

    const fallback: MotionProfile = {
      cameraMovement: "Static",
      cameraEnergy: 0,
      subjectEnergy: 0,
      totalKineticEnergy: 0,
      confidence: 0.5,
    };

    imgA.onload = checkBoth;
    imgB.onload = checkBoth;
    imgA.onerror = () => resolve(fallback);
    imgB.onerror = () => resolve(fallback);

    imgA.src = frameADataUrl;
    imgB.src = frameBDataUrl;

    const computeMotion = () => {
      try {
        const w = SAMPLE_WIDTH;
        const h = SAMPLE_HEIGHT;
        const canvas = document.createElement("canvas");
        canvas.width = w;
        canvas.height = h;
        const ctx = canvas.getContext("2d", { willReadFrequently: true });
        if (!ctx) return resolve(fallback);

        ctx.drawImage(imgA, 0, 0, w, h);
        const dataA = ctx.getImageData(0, 0, w, h).data;
        const lumaA = new Uint8Array(w * h);
        for (let i = 0; i < dataA.length; i += 4) {
          lumaA[i >> 2] = (dataA[i] * 77 + dataA[i + 1] * 150 + dataA[i + 2] * 29) >> 8;
        }

        ctx.drawImage(imgB, 0, 0, w, h);
        const dataB = ctx.getImageData(0, 0, w, h).data;
        const lumaB = new Uint8Array(w * h);
        for (let i = 0; i < dataB.length; i += 4) {
          lumaB[i >> 2] = (dataB[i] * 77 + dataB[i + 1] * 150 + dataB[i + 2] * 29) >> 8;
        }

        const blockSize = 10;
        const step = 10;
        const searchRange = 5;
        const vectors: { dx: number; dy: number; diff: number }[] = [];

        for (let by = searchRange; by < h - blockSize - searchRange; by += step) {
          for (let bx = searchRange; bx < w - blockSize - searchRange; bx += step) {
            let bestDx = 0;
            let bestDy = 0;
            let minSAD = Infinity;

            for (let dy = -searchRange; dy <= searchRange; dy += 2) {
              for (let dx = -searchRange; dx <= searchRange; dx += 2) {
                let sad = 0;
                for (let py = 0; py < blockSize; py += 2) {
                  const rowA = (by + py) * w;
                  const rowB = (by + py + dy) * w;
                  for (let px = 0; px < blockSize; px += 2) {
                    sad += Math.abs(lumaA[rowA + bx + px] - lumaB[rowB + bx + px + dx]);
                  }
                }
                if (sad < minSAD) {
                  minSAD = sad;
                  bestDx = dx;
                  bestDy = dy;
                }
              }
            }

            vectors.push({ dx: bestDx, dy: bestDy, diff: minSAD });
          }
        }

        if (vectors.length === 0) return resolve(fallback);

        const sortedDx = [...vectors].map((v) => v.dx).sort((a, b) => a - b);
        const sortedDy = [...vectors].map((v) => v.dy).sort((a, b) => a - b);
        const medianDx = sortedDx[Math.floor(sortedDx.length / 2)];
        const medianDy = sortedDy[Math.floor(sortedDy.length / 2)];
        const globalShift = Math.sqrt(medianDx * medianDx + medianDy * medianDy);

        let subjectDivergence = 0;
        let movingBlocks = 0;

        for (const v of vectors) {
          const distFromGlobal = Math.sqrt((v.dx - medianDx) ** 2 + (v.dy - medianDy) ** 2);
          if (distFromGlobal > 1.2) {
            subjectDivergence += distFromGlobal;
            movingBlocks++;
          }
        }

        const avgSubjectMotion = movingBlocks > 0 ? subjectDivergence / movingBlocks : 0;

        const cameraEnergy = Math.min(100, Math.round(globalShift * 22));
        const subjectEnergy = Math.min(
          100,
          Math.round(avgSubjectMotion * 24 + (movingBlocks / vectors.length) * 35)
        );
        const totalKineticEnergy = Math.min(
          100,
          Math.round(cameraEnergy * 0.55 + subjectEnergy * 0.45)
        );

        let cameraMovement: CameraMovementType = "Static";
        if (cameraEnergy < 8) {
          cameraMovement = "Static";
        } else if (cameraEnergy > 45) {
          cameraMovement = "Dynamic / Action";
        } else if (Math.abs(medianDx) > 1.8 * Math.max(0.5, Math.abs(medianDy))) {
          cameraMovement = "Pan";
        } else if (Math.abs(medianDy) > 1.8 * Math.max(0.5, Math.abs(medianDx))) {
          cameraMovement = "Tilt";
        } else if (globalShift > 1.5 && movingBlocks > vectors.length * 0.3) {
          cameraMovement = "Handheld";
        } else {
          cameraMovement = "Dolly / Track";
        }

        resolve({
          cameraMovement,
          cameraEnergy,
          subjectEnergy,
          totalKineticEnergy,
          confidence: 0.8,
        });
      } catch {
        resolve(fallback);
      }
    };
  });
}

/**
 * Analyzes motion for a shot.
 * First tries the high-precision Python backend endpoint (/api/analyze-motion);
 * falls back to client-side block matching if the server is unreachable.
 */
export async function analyzeShotMotion(
  videoUrl: string,
  shot: Shot,
  signal?: AbortSignal
): Promise<MotionProfile> {
  const pairs = await sampleShotMotionPairs(videoUrl, shot, signal);
  if (!pairs.length) {
    return {
      cameraMovement: "Static",
      cameraEnergy: 0,
      subjectEnergy: 0,
      totalKineticEnergy: 0,
      confidence: 0.5,
    };
  }

  const primaryPair = pairs[0];

  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 2000);
    const response = await fetchLocalModel("/api/analyze-motion", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        frameA: primaryPair.frameA,
        frameB: primaryPair.frameB,
      }),
      signal: controller.signal,
    });
    clearTimeout(timeout);

    if (response.ok) {
      const data = (await response.json()) as MotionProfile;
      if (data && typeof data.totalKineticEnergy === "number") {
        return data;
      }
    }
  } catch {
    // Fall back to client calculation
  }

  const results = await Promise.all(
    pairs.map((p) => extractClientMotion(p.frameA, p.frameB))
  );

  const avgCameraEnergy = Math.round(
    results.reduce((s, r) => s + r.cameraEnergy, 0) / results.length
  );
  const avgSubjectEnergy = Math.round(
    results.reduce((s, r) => s + r.subjectEnergy, 0) / results.length
  );
  const avgTotalKinetic = Math.round(
    results.reduce((s, r) => s + r.totalKineticEnergy, 0) / results.length
  );

  return {
    cameraMovement: results[0].cameraMovement,
    cameraEnergy: avgCameraEnergy,
    subjectEnergy: avgSubjectEnergy,
    totalKineticEnergy: avgTotalKinetic,
    confidence: results[0].confidence,
  };
}
