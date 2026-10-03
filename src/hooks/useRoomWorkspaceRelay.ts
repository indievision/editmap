import { useCallback, useEffect, useRef } from "react";
import { playhead } from "../playback/playhead";
import { buildSnapshot, shouldRelayPlayhead, type WorkspaceView } from "../playback/workspaceState";

/**
 * Tells the screening room what the host is looking at, so guests follow it.
 *
 * The snapshot goes to the room page embedded in the app (it owns the connection
 * to the room server and forwards it). A view change is sent at once; the
 * playhead is sent only while the host is in Studio, on jumps and play/pause
 * changes, and otherwise about once a second.
 */
export function useRoomWorkspaceRelay(view: WorkspaceView, playing: boolean) {
  const viewRef = useRef(view);
  const playingRef = useRef(playing);
  const last = useRef<{ time: number; playing: boolean; at: number } | null>(null);
  viewRef.current = view;
  playingRef.current = playing;

  const send = useCallback(() => {
    const iframe = document.querySelector(".duet-console-iframe") as HTMLIFrameElement | null;
    if (!iframe?.contentWindow) return;
    const current = viewRef.current;
    const head = current.mode === "studio" ? { time: playhead.get(), playing: playingRef.current } : null;
    iframe.contentWindow.postMessage({ type: "WORKSPACE_STATE", state: buildSnapshot(current, head) }, "*");
    last.current = head ? { ...head, at: performance.now() } : null;
  }, []);

  const viewKey = JSON.stringify(view);
  useEffect(() => {
    send();
  }, [viewKey, playing, send]);

  useEffect(
    () =>
      playhead.subscribe(() => {
        if (viewRef.current.mode !== "studio") return;
        const next = { time: playhead.get(), playing: playingRef.current };
        if (shouldRelayPlayhead(last.current, next, performance.now())) send();
      }),
    [send],
  );
}
