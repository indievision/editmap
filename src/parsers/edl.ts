import type { Shot } from "../models/project";
import { timecodeSeconds } from "../utils/timecode";
export function parseEDL(text: string, fps: number, origin?: string) {
  const drop =
    /FCM:\s*DROP FRAME/i.test(text) || /\d{2}:\d{2}:\d{2};\d{2}/.test(text);
  let audio = 0;

  type RawEvent = {
    lineIndex: number;
    num: string;
    reel: string;
    track: string;
    trans: string;
    times: string[];
  };

  const rawEvents: RawEvent[] = [];

  for (const [lineIndex, line] of text.split(/\r?\n/).entries()) {
    if (!/^\s*\d+\s/.test(line)) continue;
    const p = line.trim().split(/\s+/);
    if (p.length < 8)
      throw new Error(`Line ${lineIndex + 1}: incomplete EDL event.`);
    if (!p[2].includes("V") && !p[2].includes("B")) {
      audio++;
      continue;
    }
    rawEvents.push({
      lineIndex,
      num: p[0],
      reel: p[1],
      track: p[2],
      trans: p[3],
      times: p.slice(-4),
    });
  }

  if (!rawEvents.length)
    throw new Error(
      `No video events found.${audio ? " Audio-only events were ignored." : ""}`,
    );

  let recordOrigin = origin ?? "";
  if (!recordOrigin) {
    let minSeconds = Infinity;
    for (const ev of rawEvents) {
      try {
        const sec = timecodeSeconds(ev.times[2], fps, drop);
        if (sec < minSeconds) {
          minSeconds = sec;
          recordOrigin = ev.times[2];
        }
      } catch (e) {
        throw new Error(`Line ${ev.lineIndex + 1}: ${(e as Error).message}`);
      }
    }
  }

  let base = 0;
  try {
    base = timecodeSeconds(recordOrigin, fps, drop);
  } catch (e) {
    throw new Error(`Film origin error: ${(e as Error).message}`);
  }

  const shots: Shot[] = [];
  for (const ev of rawEvents) {
    try {
      const [si, so, ri, ro] = ev.times.map((t) =>
        timecodeSeconds(t, fps, drop),
      );
      if (so < si || ro < ri || (ro === ri && ev.trans === "C"))
        throw new Error("Out timecode must follow in timecode.");
      if (ri < base)
        throw new Error("Record in precedes the chosen film origin.");
      if (ro === ri) continue;
      shots.push({
        id: `event-${ev.num}-${ev.lineIndex}`,
        index: Number(ev.num),
        sourceReel: ev.reel,
        sourceIn: ev.times[0],
        sourceOut: ev.times[1],
        startTimecode: ev.times[2],
        endTimecode: ev.times[3],
        startSeconds: ri - base,
        endSeconds: ro - base,
        duration: ro - ri,
        transition: ev.trans,
        shotSize: "Unknown",
        notes: "",
      });
    } catch (e) {
      throw new Error(`Line ${ev.lineIndex + 1}: ${(e as Error).message}`);
    }
  }

  shots.sort((a, b) => a.startSeconds - b.startSeconds);
  if (!shots.length)
    throw new Error("No non-zero-duration video events found.");
  if (
    shots.some(
      (s, i) => i > 0 && s.startSeconds < shots[i - 1].endSeconds - 0.00001,
    )
  )
    throw new Error(
      "Overlapping video events are not supported in V0. Export a single flattened video track.",
    );
  const duration = Math.max(...shots.map((s) => s.endSeconds));
  if (!Number.isFinite(duration) || duration < 0)
    throw new Error("Parsed timeline has an invalid duration.");
  return {
    shots,
    recordOrigin,
    dropFrame: drop,
    duration,
  };
}
