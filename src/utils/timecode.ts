export const rates = [23.976, 24, 25, 29.97, 30];
export const actualRate = (fps: number) =>
  fps === 23.976 ? 24000 / 1001 : fps === 29.97 ? 30000 / 1001 : fps;
export function timecodeFrames(tc: string, fps: number, drop = false): number {
  if (!rates.includes(fps)) throw new Error("Unsupported frame rate.");
  const m = /^(\d{2}):(\d{2}):(\d{2})[:;](\d{2})$/.exec(tc);
  if (!m) throw new Error(`Malformed timecode: ${tc}`);
  const [h, min, s, f] = m.slice(1).map(Number),
    nominal = Math.round(fps);
  drop = drop || tc.includes(";");
  if (min > 59 || s > 59 || f >= nominal)
    throw new Error(`Timecode outside frame-rate range: ${tc}`);
  if (drop && fps !== 29.97)
    throw new Error("Drop-frame timecode requires 29.97 fps.");
  if (drop && min % 10 !== 0 && s === 0 && f < 2)
    throw new Error(`Invalid dropped frame label: ${tc}`);
  const minutes = h * 60 + min;
  return (
    (h * 3600 + min * 60 + s) * nominal +
    f -
    (drop ? 2 * (minutes - Math.floor(minutes / 10)) : 0)
  );
}
export const timecodeSeconds = (tc: string, fps: number, drop = false) =>
  timecodeFrames(tc, fps, drop) / actualRate(fps);
export function formatTimecode(
  seconds: number,
  fps: number,
  drop = false,
): string {
  let n = Math.max(0, Math.round(seconds * actualRate(fps)));
  const nominal = Math.round(fps);
  if (drop && fps === 29.97) {
    const d = Math.floor(n / 17982),
      m = n % 17982;
    n += 18 * d + (m >= 2 ? 2 * Math.floor((m - 2) / 1798) : 0);
  }
  const f = n % nominal,
    total = Math.floor(n / nominal);
  return [Math.floor(total / 3600), Math.floor(total / 60) % 60, total % 60, f]
    .map((v) => String(v).padStart(2, "0"))
    .join(":")
    .replace(/:(\d{2})$/, `${drop ? ";" : ":"}$1`);
}
