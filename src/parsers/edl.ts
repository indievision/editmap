import type { Shot } from "../models/project";
import { timecodeSeconds } from "../utils/timecode";
export interface SkippedEvent {
  /** 1-based line number in the EDL text. */
  line: number;
  reason: string;
}

/**
 * Parses a CMX-3600 style EDL. By default the first bad event aborts the parse
 * (exact, all-or-nothing). With `lenient`, unreadable events are skipped and
 * reported in `skipped` so the readable ones can still be imported; global
 * problems (unsupported frame rate, no usable events) still throw.
 */
export function parseEDL(
  text: string,
  fps: number,
  origin?: string,
  options: { lenient?: boolean } = {},
) {
  const lenient = options.lenient === true;
  const skipped: SkippedEvent[] = [];
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
    if (p.length < 8) {
      if (lenient) {
        skipped.push({ line: lineIndex + 1, reason: "incomplete EDL event" });
        continue;
      }
      throw new Error(`Line ${lineIndex + 1}: incomplete EDL event.`);
    }
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
    for (const ev of [...rawEvents]) {
      try {
        const sec = timecodeSeconds(ev.times[2], fps, drop);
        if (sec < minSeconds) {
          minSeconds = sec;
          recordOrigin = ev.times[2];
        }
      } catch (e) {
        if (!lenient) throw new Error(`Line ${ev.lineIndex + 1}: ${(e as Error).message}`);
        // Reported once, in the per-event pass below.
        rawEvents.splice(rawEvents.indexOf(ev), 1);
        skipped.push({ line: ev.lineIndex + 1, reason: (e as Error).message });
      }
    }
    if (!rawEvents.length) throw new Error("No readable video events found.");
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
      if (!lenient) throw new Error(`Line ${ev.lineIndex + 1}: ${(e as Error).message}`);
      skipped.push({ line: ev.lineIndex + 1, reason: (e as Error).message });
    }
  }

  shots.sort((a, b) => a.startSeconds - b.startSeconds);
  if (!shots.length)
    throw new Error("No non-zero-duration video events found.");
  if (lenient) {
    // Keep the earlier event of any overlapping pair rather than hiding shots.
    let kept = 0;
    for (const shot of shots.slice()) {
      if (kept > 0 && shot.startSeconds < shots[kept - 1].endSeconds - 0.00001) {
        skipped.push({ line: Number(shot.id.split("-").pop()) + 1, reason: "overlaps the previous video event" });
      } else {
        shots[kept++] = shot;
      }
    }
    shots.length = kept;
  }
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
    skipped: skipped.sort((a, b) => a.line - b.line),
  };
}
