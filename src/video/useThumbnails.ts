import { useEffect, useRef, useState } from "react";
import type { ColorProfile, Shot } from "../models/project";
import { extractColorProfile } from "../analysis/colorExtraction";
import { temporalColorProfile } from "../analysis/colorTemporal";

// A separate muted decoder never seeks or changes the playback monitor.
export function useThumbnails(url: string, shots: Shot[], playing: boolean) {
  const [frames, setFrames] = useState<Record<string, string>>({});
  const [colorProfiles, setColorProfiles] = useState<Record<string, ColorProfile>>({});
  
  // Persistent caches across edits to avoid flashing/refreshing existing thumbnails
  const framesCache = useRef<Record<string, string>>({});
  const profilesCache = useRef<Record<string, ColorProfile>>({});
  const sampledBoundsCache = useRef<Record<string, string>>({});
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
      sampledBoundsCache.current = {};
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
        delete sampledBoundsCache.current[cachedId];
      }
    }

    // Determine which shots actually need extraction:
    // 1) Shot does not have a frame yet
    // 2) Shot bounds changed, invalidating its interior colour samples.
    const items = JSON.parse(boundaries) as [string, number, number][];
    const neededItems = items.filter(([id, start, end]) => {
      const cached = framesCache.current[id];
      const previousBounds = sampledBoundsCache.current[id];
      if (!cached) return true;
      return previousBounds !== `${start.toFixed(3)}:${end.toFixed(3)}`;
    });

    // If all shots are already cached and unchanged, nothing to decode!
    if (neededItems.length === 0) return;

    const controller = new AbortController();
    const { signal } = controller;
    const decoder = document.createElement("video");
    decoder.muted = true;
    decoder.preload = "auto";
    const THUMB_WIDTH = 320;
    const THUMB_HEIGHT = 180;
    const canvas = document.createElement("canvas");
    canvas.width = THUMB_WIDTH;
    canvas.height = THUMB_HEIGHT;
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
        const sampleAtTime = async (time: number) => {
          const target = Math.min(time, decoder.duration - 0.001);
          const sought = wait("seeked");
          decoder.currentTime = Math.max(0, target);
          await sought;
          if (signal.aborted || !context) throw new Error("Colour sampling aborted");
          context.fillStyle = "#0a0c0d";
          context.fillRect(0, 0, THUMB_WIDTH, THUMB_HEIGHT);
          const scale = Math.min(THUMB_WIDTH / decoder.videoWidth, THUMB_HEIGHT / decoder.videoHeight);
          const w = decoder.videoWidth * scale, h = decoder.videoHeight * scale;
          const dx = Math.max(0, (THUMB_WIDTH - w) / 2), dy = Math.max(0, (THUMB_HEIGHT - h) / 2);
          context.drawImage(decoder, dx, dy, w, h);
          return {
            time: target,
            profile: extractColorProfile(context, dx, dy, w, h, 8),
            frame: canvas.toDataURL("image/jpeg", 0.85),
          };
        };
        const sampleAt = (fraction: number) => sampleAtTime(start + (end - start) * fraction);
        const samples = [];
        // One muted decoder owns the seek state, so interior samples stay ordered.
        for (const fraction of [.2, .5, .8]) samples.push(await sampleAt(fraction));
        // Keep boundary evidence separate: it is for cut matching, while the
        // three interior samples describe colour change within a shot.
        const edgeInset = Math.min(.08, Math.max(.001, (end - start) * .2));
        const boundary = {
          start: await sampleAtTime(start + edgeInset),
          end: await sampleAtTime(Math.max(start, end - edgeInset)),
        };
        let profile = temporalColorProfile(samples, boundary);
        // Only long shots with a measured initial change incur two extra seeks.
        if (end - start >= 12 && profile.temporal?.changed) {
          const extra = [await sampleAt(.35), await sampleAt(.65)];
          profile = temporalColorProfile([...samples, ...extra], boundary);
        }
        const frame = samples[1].frame;

        framesCache.current[id] = frame;
        profilesCache.current[id] = profile;
        sampledBoundsCache.current[id] = `${start.toFixed(3)}:${end.toFixed(3)}`;

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
