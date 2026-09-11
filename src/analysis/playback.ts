import type { Shot } from "../models/project";
export function activeShot(shots: Shot[], time: number) {
  let lo = 0,
    hi = shots.length - 1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1,
      s = shots[mid];
    if (time < s.startSeconds) hi = mid - 1;
    else if (time >= s.endSeconds) lo = mid + 1;
    else return s;
  }
  return undefined;
}
export const clampSeek = (time: number, duration: number) =>
  Math.max(0, Math.min(time, duration));
