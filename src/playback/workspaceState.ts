/**
 * What the host is looking at, as sent to everyone in the screening room.
 *
 * The host's app builds one of these whenever something visible changes and the
 * room server stores the latest and relays it (see `WORKSPACE_STATE` in
 * `duet_server.cjs`, which only bounds the size and checks `mode`). Guests follow
 * it. It carries identifiers and view settings only, never analysis data.
 */
import type { ReviewFilter } from "../analysis/review";
import type { WorkspaceMode } from "../components/ProjectHeader";
import type { StudioToolTab } from "../components/StudioToolRail";

export type ExploreSubpage = "assemble" | "compare";

export interface WorkspaceSnapshot {
  mode: WorkspaceMode;
  /**
   * The host's playhead in seconds and whether it is playing. Only sent while the
   * host is in Studio, where the app plays the film. In Screening and Review the
   * room's own player sends the playhead (PLAY, PAUSE, SEEK, TIME_PULSE).
   */
  time?: number;
  playing?: boolean;
  /** Studio: the selected shot, sequence and character, the open tool and whether its drawer is open. */
  selectedShot?: string;
  /** The cut (the incoming shot's id) open in the Cuts tool. */
  selectedCut?: string;
  selectedSequence?: string | null;
  selectedCharacter?: string;
  deckTab?: StudioToolTab;
  drawerOpen?: boolean;
  reviewFilter?: ReviewFilter;
  /** Explore: which subpage is open. */
  exploreSubpage?: ExploreSubpage;
}

/** Everything except the playhead: the part that changes when the host clicks, not when the film plays. */
export type WorkspaceView = Omit<WorkspaceSnapshot, "time" | "playing">;

export function buildSnapshot(view: WorkspaceView, playhead: { time: number; playing: boolean } | null): WorkspaceSnapshot {
  if (!playhead) return { ...view };
  return { ...view, time: Number.isFinite(playhead.time) ? Math.max(0, playhead.time) : 0, playing: playhead.playing };
}

/** True when two views would look the same to a guest. */
export function sameView(a: WorkspaceView, b: WorkspaceView): boolean {
  const keys = new Set([...Object.keys(a), ...Object.keys(b)]) as Set<keyof WorkspaceView>;
  for (const key of keys) if (a[key] !== b[key]) return false;
  return true;
}

/** Longest gap between two playhead updates sent while the film plays (guests phase-lock to them). */
export const PLAYHEAD_RELAY_MS = 500;

/**
 * Decides whether the playhead needs sending now. A jump (seek) or a play/pause
 * change is sent at once; steady playback is sent at most once per
 * `PLAYHEAD_RELAY_MS`; guests keep time between updates and nudge their speed to stay locked.
 */
export function shouldRelayPlayhead(
  last: { time: number; playing: boolean; at: number } | null,
  next: { time: number; playing: boolean },
  now: number,
): boolean {
  if (!last) return true;
  if (last.playing !== next.playing) return true;
  const expected = last.playing ? last.time + (now - last.at) / 1000 : last.time;
  if (Math.abs(next.time - expected) > 0.5) return true;
  return last.playing && now - last.at >= PLAYHEAD_RELAY_MS;
}
