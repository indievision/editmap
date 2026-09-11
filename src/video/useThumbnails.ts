import { useEffect, useRef, useState } from "react";
import type { ColorProfile, Shot } from "../models/project";
import { extractColorProfile } from "../analysis/colorExtraction";

// A separate muted decoder never seeks or changes the playback monitor.
export function useThumbnails(url: string, shots: Shot[], playing: boolean) {
  const [frames, setFrames] = useState<Record<string, string>>({});
  const [colorProfiles, setColorProfiles] = useState<Record<string, ColorProfile>>({});
  const paused = useRef(playing);
  paused.current = playing;
  const boundaries = JSON.stringify(
    shots.map((s) => [s.id, s.startSeconds, s.endSeconds]),
  );
  useEffect(() => {
    setFrames({});
    setColorProfiles({});
    if (!url) return;
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
      const items = JSON.parse(boundaries) as [string, number, number][];
      const BATCH_SIZE = 15;
      let pendingBatch: Record<string, string> = {};
      let pendingProfilesBatch: Record<string, ColorProfile> = {};
      let countInBatch = 0;
      for (const [id, start, end] of items) {
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
        pendingBatch[id] = frame;
        pendingProfilesBatch[id] = profile;
        countInBatch++;

        const isLast = id === items[items.length - 1][0];
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
