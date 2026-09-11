import { useEffect, useRef, useState } from "react";
import type { ColorProfile, Shot } from "../models/project";
import { extractColorProfile } from "../analysis/colorExtraction";

// A separate muted decoder never seeks or changes the playback monitor.
export function useThumbnails(url: string, shots: Shot[], playing: boolean) {
  const [frames, setFrames] = useState<Record<string, string>>({});
  const [colorProfiles, setColorProfiles] = useState<Record<string, ColorProfile>>({});
  
  // Persistent caches across edits to avoid flashing/refreshing existing thumbnails
  const framesCache = useRef<Record<string, string>>({});
  const profilesCache = useRef<Record<string, ColorProfile>>({});
  const sampledMidpointCache = useRef<Record<string, number>>({});
  const currentUrlRef = useRef<string>("");

  const paused = useRef(playing);
  paused.current = playing;

  const boundaries = JSON.stringify(
    shots.map((s) => [s.id, s.startSeconds, s.endSeconds]),
  );

  useEffect(() => {
    // If the video URL changed, completely reset all caches
    if (currentUrlRef.current !== url) {
      currentUrlRef.current = url;
      framesCache.current = {};
      profilesCache.current = {};
      sampledMidpointCache.current = {};
      setFrames({});
      setColorProfiles({});
    }

    if (!url || shots.length === 0) return;

    // Prune cache entries for shots that no longer exist (e.g. after a merge)
    const validShotIds = new Set(shots.map((s) => s.id));
    for (const cachedId of Object.keys(framesCache.current)) {
      if (!validShotIds.has(cachedId)) {
        delete framesCache.current[cachedId];
        delete profilesCache.current[cachedId];
        delete sampledMidpointCache.current[cachedId];
      }
    }

    // Determine which shots actually need extraction:
    // 1) Shot does not have a frame yet
    // 2) Shot's midpoint changed significantly (> 0.25s) from what was previously sampled
    const items = JSON.parse(boundaries) as [string, number, number][];
    const neededItems = items.filter(([id, start, end]) => {
      const target = (start + end) / 2;
      const cached = framesCache.current[id];
      const prevMid = sampledMidpointCache.current[id];
      if (!cached) return true;
      if (prevMid === undefined || Math.abs(prevMid - target) > 0.25) return true;
      return false;
    });

    // If all shots are already cached and unchanged, nothing to decode!
    if (neededItems.length === 0) return;

    const controller = new AbortController();
    const { signal } = controller;
    const decoder = document.createElement("video");
    decoder.muted = true;
    decoder.preload = "auto";
    const canvas = document.createElement("canvas");
    canvas.width = 160;
    canvas.height = 90;
    const context = canvas.getContext("2d");

    const wait = (event: string) =>
      new Promise<void>((resolve, reject) => {
        const cleanup = () => {
          clearTimeout(timeout);
          decoder.removeEventListener(event, success);
          decoder.removeEventListener("error", failure);
          signal.removeEventListener("abort", failure);
        };
        const success = () => {
          cleanup();
          resolve();
        };
        const failure = () => {
          cleanup();
          reject(new Error("Thumbnail unavailable"));
        };
        const timeout = setTimeout(failure, 10000);
        decoder.addEventListener(event, success, { once: true });
        decoder.addEventListener("error", failure, { once: true });
        signal.addEventListener("abort", failure, { once: true });
      });

    const run = async () => {
      const ready = wait("loadeddata");
      decoder.src = url;
      await ready;

      const BATCH_SIZE = 10;
      let pendingBatch: Record<string, string> = {};
      let pendingProfilesBatch: Record<string, ColorProfile> = {};
      let countInBatch = 0;

      for (let i = 0; i < neededItems.length; i++) {
        const [id, start, end] = neededItems[i];
        while (paused.current && !signal.aborted)
          await new Promise((r) => setTimeout(r, 250));
        if (signal.aborted) return;
        if (start >= decoder.duration) continue;
        const target = Math.min((start + end) / 2, decoder.duration - 0.001);
        const sought = wait("seeked");
        decoder.currentTime = Math.max(0, target);
        await sought;
        if (signal.aborted || !context) return;
        context.fillStyle = "#0a0c0d";
        context.fillRect(0, 0, 160, 90);
        const scale = Math.min(
          160 / decoder.videoWidth,
          90 / decoder.videoHeight,
        );
        const w = decoder.videoWidth * scale,
          h = decoder.videoHeight * scale;
        const dx = Math.max(0, (160 - w) / 2);
        const dy = Math.max(0, (90 - h) / 2);
        context.drawImage(decoder, dx, dy, w, h);
        const frame = canvas.toDataURL("image/jpeg", 0.65);
        const profile = extractColorProfile(context, dx, dy, w, h);

        framesCache.current[id] = frame;
        profilesCache.current[id] = profile;
        sampledMidpointCache.current[id] = target;

        pendingBatch[id] = frame;
        pendingProfilesBatch[id] = profile;
        countInBatch++;

        const isLast = i === neededItems.length - 1;
        if (countInBatch >= BATCH_SIZE || isLast) {
          const toFlushFrames = { ...pendingBatch };
          const toFlushProfiles = { ...pendingProfilesBatch };
          pendingBatch = {};
          pendingProfilesBatch = {};
          countInBatch = 0;
          setFrames((previous) => ({ ...previous, ...toFlushFrames }));
          setColorProfiles((previous) => ({ ...previous, ...toFlushProfiles }));
        }

        // Give breathing room for user interaction and browser render pipeline
        if ("requestIdleCallback" in window) {
          await new Promise((r) => {
            (window as unknown as { requestIdleCallback: (cb: () => void, opts: { timeout: number }) => void }).requestIdleCallback(
              () => r(null),
              { timeout: 50 },
            );
          });
        } else {
          await new Promise((r) => setTimeout(r, 16));
        }
      }

      if (countInBatch > 0) {
        setFrames((previous) => ({ ...previous, ...pendingBatch }));
        setColorProfiles((previous) => ({ ...previous, ...pendingProfilesBatch }));
      }
    };

    void run().catch(() => {
      /* Unsupported decoding leaves the analytical color block intact. */
    });

    return () => {
      controller.abort();
      decoder.removeAttribute("src");
      decoder.load();
    };
  }, [url, boundaries]);

  return { frames, colorProfiles };
}
