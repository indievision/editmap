import { actualRate, formatTimecode } from "../utils/timecode";
import { usePlayhead } from "./playhead";

/** Timecode text that follows the playback clock; only this span re-renders per frame. */
export function PlayheadTimecode({ frameRate, dropFrame, className }: { frameRate: number; dropFrame?: boolean; className?: string }) {
  const time = usePlayhead();
  return <span className={className}>{formatTimecode(time, frameRate, dropFrame)}</span>;
}

/** Seek slider bound to the playback clock; only this input re-renders per frame. */
export function PlayheadSeekSlider({ duration, frameRate, onSeek }: { duration: number; frameRate: number; onSeek: (time: number) => void }) {
  const time = usePlayhead();
  return (
    <input
      className="seek"
      aria-label="Seek film"
      type="range"
      min="0"
      max={duration || 1}
      step={1 / actualRate(frameRate)}
      value={time}
      onChange={(e) => onSeek(Number(e.target.value))}
    />
  );
}
