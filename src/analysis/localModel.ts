import { peopleLabels, selectableShotSizes, subjectLabels, type Shot } from "../models/project";

export type Tags = Pick<
  Shot,
  "shotSize" | "composition" | "content" | "uncertain"
>;

export const MODEL = "ultralytics-yolo";

// The classifier needs only four short enum values. Keeping the image and
// generation budget compact substantially lowers local vision-model work.
const FRAME_WIDTH = 336;
const FRAME_JPEG_QUALITY = 0.75;

const sizes = [...selectableShotSizes, "Not applicable"];

export const TAG_SCHEMA = {
  type: "object",
  properties: {
    shotSize: { type: "string", enum: sizes },
    composition: { type: "string", enum: Object.keys(peopleLabels) },
    content: { type: "string", enum: Object.keys(subjectLabels) },
    uncertain: { type: "boolean" },
  },
  required: ["shotSize", "composition", "content", "uncertain"],
  additionalProperties: false,
};

export function validateTags(value: unknown): Tags {
  const p = value as Record<string, unknown>;
  // Older unconstrained responses sometimes copy the prompt's count explanation.
  const composition =
    p?.composition === "Single person (one)" ? "Single person" : p?.composition;
  if (
    !p ||
    typeof p.shotSize !== "string" ||
    !sizes.includes(p.shotSize) ||
    typeof composition !== "string" ||
    !Object.keys(peopleLabels).includes(composition) ||
    typeof p.content !== "string" ||
    !Object.keys(subjectLabels).includes(p.content) ||
    typeof p.uncertain !== "boolean"
  )
    throw new Error(
      "The model returned invalid tags. Your existing tags were preserved.",
    );
  return {
    shotSize: p.content === "Text / title card" ? "Not applicable" : p.shotSize,
    composition,
    content: p.content,
    uncertain: p.uncertain,
  } as Tags;
}

export const BACKEND_URL = "http://127.0.0.1:8000";

export async function fetchLocalModel(
  path: string,
  options: RequestInit,
): Promise<Response> {
  const directUrl = `${BACKEND_URL}${path}`;
  const proxyUrl = path.startsWith("/api") ? path : `/api${path}`;
  try {
    const response = await fetch(proxyUrl, options);
    if (![500, 502, 503, 504].includes(response.status)) {
      return response;
    }
    const clone = response.clone();
    try {
      const json = await clone.json();
      if (json && typeof json === "object" && "detail" in json) {
        return response;
      }
      if (json && typeof json === "object" && "error" in json) {
        return response;
      }
    } catch {
      // Non-JSON proxy error response
    }
    return await fetch(directUrl, options);
  } catch {
    return await fetch(directUrl, options);
  }
}

export async function analyzeFrame(
  image: string,
  signal: AbortSignal,
): Promise<Tags> {
  const options = {
    method: "POST",
    signal,
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ image }),
  };

  let response = await fetchLocalModel("/api/analyze-shot", options);

  // A warm model runner can fail transiently; retry the same frame only once.
  if ([500, 502, 503, 504].includes(response.status)) {
    await response.text().catch(() => "");
    signal.throwIfAborted();
    response = await fetchLocalModel("/api/analyze-shot", options);
  }

  if (!response.ok) {
    const detail = await response.json().catch(() => null);
    const errMessage =
      typeof detail?.detail === "string"
        ? detail.detail
        : typeof detail?.error === "string"
        ? detail.error
        : null;

    throw new Error(
      errMessage
        ? `Local analysis failed (HTTP ${response.status}): ${errMessage}`
        : `Local analysis failed (HTTP ${response.status}). Check that the local CV engine is running on ${BACKEND_URL}.`,
    );
  }

  const out = await response.json();
  if (out.error) throw new Error(String(out.error));

  // Extract tags from direct response or legacy/mock nested structure
  let tagsCandidate = out;
  if (out && typeof out === "object" && "message" in out && out.message) {
    const text = out.message.content || out.message.thinking || "";
    try {
      tagsCandidate = JSON.parse(text);
    } catch {
      tagsCandidate = out;
    }
  }

  try {
    return validateTags(tagsCandidate);
  } catch {
    throw new Error(
      "The model returned invalid tags. Your existing tags were preserved.",
    );
  }
}

export async function sampleFrame(
  url: string,
  time: number,
  signal: AbortSignal,
): Promise<string> {
  const sampler = await createFrameSampler(url, signal);
  try {
    return await sampler.sample(time);
  } finally {
    sampler.dispose();
  }
}

export type FrameSampler = {
  sample: (time: number) => Promise<string>;
  dispose: () => void;
};

/**
 * Keeps a single off-screen decoder and canvas alive for a sequence of seeks.
 * Bulk scanning owns this sampler; the selected-shot flow still uses sampleFrame.
 */
export async function createFrameSampler(
  url: string,
  signal: AbortSignal,
): Promise<FrameSampler> {
  const v = document.createElement("video");
  const c = document.createElement("canvas");
  v.muted = true;
  v.preload = "auto";
  v.playsInline = true;
  const wait = (event: string) =>
    new Promise<void>((resolve, reject) => {
      let settled = false;
      const clean = () => {
        clearTimeout(timer);
        v.removeEventListener(event, ok);
        v.removeEventListener("error", fail);
        signal.removeEventListener("abort", abort);
      };
      const ok = () => {
        if (settled) return;
        settled = true;
        clean();
        resolve();
      };
      const fail = () => {
        if (settled) return;
        settled = true;
        clean();
        reject(new Error("Could not sample this video frame."));
      };
      const abort = () => {
        if (settled) return;
        settled = true;
        clean();
        reject(new DOMException("Frame sampling cancelled.", "AbortError"));
      };
      const timer = setTimeout(fail, 15000);
      v.addEventListener(event, ok, { once: true });
      v.addEventListener("error", fail, { once: true });
      signal.addEventListener("abort", abort, { once: true });
      if (signal.aborted) abort();
    });

  const ready = wait("loadeddata");
  v.src = url;
  await ready;

  return {
    async sample(time) {
      if (time >= v.duration)
        throw new Error("This shot is outside the linked video.");
      const seek = wait("seeked");
      v.currentTime = Math.max(0.001, time);
      await seek;
      c.width = FRAME_WIDTH;
      c.height = Math.round((FRAME_WIDTH * v.videoHeight) / v.videoWidth);
      c.getContext("2d")!.drawImage(v, 0, 0, c.width, c.height);
      return c.toDataURL("image/jpeg", FRAME_JPEG_QUALITY).split(",")[1];
    },
    dispose() {
      v.removeAttribute("src");
      v.load();
      c.width = 0;
      c.height = 0;
    },
  };
}
