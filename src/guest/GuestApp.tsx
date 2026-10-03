import { useCallback, useEffect, useRef, useState } from "react";
import type { ColorProfile, Project } from "../models/project";
import { activeShot } from "../analysis/playback";
import { playhead, setPlayhead, usePlayheadSelector } from "../playback/playhead";
import { PlayheadTimecode } from "../playback/PlayheadReadouts";
import type { WorkspaceSnapshot } from "../playback/workspaceState";
import EditingMap from "../timeline/EditingMap";
import EditingRhythm from "../components/EditingRhythm";
import FramingDrawer from "../components/FramingDrawer";
import SequenceReading from "../components/SequenceReading";
import SoundDrawer from "../components/SoundDrawer";
import CutReading from "../components/CutReading";
import CastDrawer from "../components/CastDrawer";
import ColorDrawer from "../components/ColorDrawer";
import MapShotSummary from "../components/MapShotSummary";
import ExploreWorkspace from "../components/explore/ExploreWorkspace";
import { StudioToolRail } from "../components/StudioToolRail";
import GuestHeader from "./GuestHeader";

/**
 * The guest's read-only Studio and Explore. It sits inside the guest's screening
 * page, which owns the connection to the room and forwards what the host is doing
 * (`GUEST_STATE`) and when the analysis changes (`ROOM_DATA_UPDATED`). It shows the
 * host's workspace on the host's data and never writes anything back: every edit
 * and scan callback below is a no-op.
 */
type Part = "project" | "thumbnails" | "colorProfiles";
interface GuestState {
  workspace: WorkspaceSnapshot;
  time: number;
  playing: boolean;
  videoUrl: string;
  at: number;
}

const noop = () => {};

async function load<T>(part: Part): Promise<T | undefined> {
  try {
    const res = await fetch(`/api/room-data/${part}`, { cache: "no-store" });
    return res.ok ? ((await res.json()) as T) : undefined;
  } catch {
    return undefined;
  }
}

export default function GuestApp() {
  // The same page serves the header strip (?view=header) and the Studio / Explore view.
  if (new URLSearchParams(window.location.search).get("view") === "header") return <GuestHeader />;
  return <GuestWorkspace />;
}

function GuestWorkspace() {
  const [state, setState] = useState<GuestState | null>(null);
  const [project, setProject] = useState<Project>();
  const [thumbnails, setThumbnails] = useState<Record<string, string>>({});
  const [colorProfiles, setColorProfiles] = useState<Record<string, ColorProfile>>({});
  const video = useRef<HTMLVideoElement>(null);

  const refresh = useCallback(async (part?: Part) => {
    if (!part || part === "project") setProject(await load<Project>("project"));
    if (!part || part === "thumbnails") setThumbnails((await load<Record<string, string>>("thumbnails")) ?? {});
    if (!part || part === "colorProfiles") setColorProfiles((await load<Record<string, ColorProfile>>("colorProfiles")) ?? {});
  }, []);

  useEffect(() => {
    void refresh();
    const onMessage = (event: MessageEvent) => {
      if (event.origin !== window.location.origin) return;
      const data = event.data;
      if (!data || typeof data !== "object") return;
      if (data.type === "GUEST_STATE" && data.workspace) {
        setState({ workspace: data.workspace, time: Number(data.time) || 0, playing: Boolean(data.playing), videoUrl: String(data.videoUrl ?? ""), at: performance.now() });
      } else if (data.type === "GUEST_HIDE") {
        setState(null); // the host left Studio / Explore: drop the picture so it stops decoding
      } else if (data.type === "ROOM_DATA_UPDATED") {
        void refresh(data.part);
      }
    };
    window.addEventListener("message", onMessage);
    window.parent.postMessage({ type: "GUEST_READY" }, window.location.origin);
    return () => window.removeEventListener("message", onMessage);
  }, [refresh]);

  // Keep this device's picture where the host's is: same frame, playing or paused, never with sound.
  const ready = Boolean(project);
  useEffect(() => {
    if (!state) return;
    setPlayhead(state.time);
    const v = video.current;
    if (!v) return;
    // While playing, small differences are removed by speed (below); only a large gap, or a paused frame, seeks.
    if (Math.abs(v.currentTime - state.time) > (state.playing ? 0.6 : 0.05)) v.currentTime = state.time;
    if (state.playing) void v.play().catch(noop);
    else v.pause();
  }, [state, ready]);

  useEffect(() => {
    if (!state?.playing) {
      if (video.current) video.current.playbackRate = 1;
      return;
    }
    let frame = 0;
    const tick = () => {
      const v = video.current;
      if (v) {
        setPlayhead(v.currentTime);
        // Phase-lock to the host: where the host is now, from its last update plus the time since.
        const hostNow = state.time + (performance.now() - state.at) / 1000;
        const gap = Math.abs(hostNow - v.currentTime);
        // Steady 1x playback. Changing the speed made Safari drop frames, so a guest may sit a few frames off the
        // host; only a real gap seeks (a seek lands on a keyframe and shows).
        if (v.playbackRate !== 1) v.playbackRate = 1;
        if (gap > 0.6) v.currentTime = hostNow;
      }
      frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, [state?.playing]);

  const current = usePlayheadSelector((time) => (project ? activeShot(project.shots, time)?.id : undefined));

  if (!state) return <div className="guest-wait">Waiting for the host…</div>;
  if (!project) return <div className="guest-wait">Waiting for the host's analysis…</div>;

  const { workspace } = state;
  const selectedShot = project.shots.find((s) => s.id === workspace.selectedShot);
  const currentShot = project.shots.find((s) => s.id === current);
  const drawerOpen = workspace.drawerOpen !== false;
  const tab = workspace.deckTab ?? "rhythm";
  const url = state.videoUrl;

  if (workspace.mode === "explore") {
    return (
      <div className="app guest-app">
        <ExploreWorkspace
          key={project.id}
          project={project}
          url={url}
          thumbnails={thumbnails}
          colorProfiles={colorProfiles}
          activeWorkspace="explore"
          subpage={workspace.exploreSubpage}
          onUpdateProject={noop}
          onLocateInStudio={noop}
          onRelinkVideo={noop}
        />
      </div>
    );
  }

  const panels = {
    rhythm: <EditingRhythm project={project} waveform={[]} selected={workspace.selectedShot} url={url} onSelect={noop} onSeek={noop} variant="drawer" />,
    framing: <FramingDrawer project={project} selected={workspace.selectedShot} onSelect={noop} onSeek={noop} variant="drawer" />,
    sequence: (
      <SequenceReading
        project={project}
        onRangeChange={noop}
        onSeek={noop}
        onUpdate={noop}
        selectedEntryId={workspace.selectedSequence}
        variant="drawer"
      />
    ),
    sound: (
      <SoundDrawer
        project={project}
        selectedShot={currentShot}
        onRangeChange={noop}
        onPlayRange={noop}
        onUpdateSpans={noop}
        loudnessAnalysis={project.loudnessAnalysis}
        isLoudnessScanning={false}
        loudnessStatus=""
        onScanLoudness={noop}
        onCancelLoudness={noop}
        speechAnalysis={project.speechAnalysis}
        isSpeechScanning={false}
        speechStatus=""
        onScanSpeech={noop}
        onCancelSpeech={noop}
        onRetrySpeech={noop}
        onSeek={noop}
        showSpeechOverlay={false}
        onToggleSpeechOverlay={noop}
      />
    ),
    cuts: <CutReading project={project} incomingId={workspace.selectedCut} url={url} onSeek={noop} onPlay={noop} onUpdate={noop} variant="drawer" />,
    cast: (
      <CastDrawer
        project={project}
        shot={selectedShot ?? currentShot}
        thumbnails={thumbnails}
        selectedMember={workspace.selectedCharacter}
        disabled
        onSelect={noop}
        onAdd={noop}
        onReference={async () => {}}
        onRemove={noop}
        onInspect={noop}
        onConfirmShot={noop}
        onRemoveAppearance={noop}
        onRangeChange={noop}
        onPlayRange={noop}
        onSeek={noop}
        onClose={noop}
      />
    ),
    color: <ColorDrawer project={project} shot={selectedShot ?? currentShot} thumbnails={thumbnails} selected={workspace.selectedShot} onSelect={noop} onSeek={noop} onClose={noop} />,
  } as const;

  return (
    <div className="app guest-app">
      <main
        className="workspace mode-studio"
        style={{ "--left-panel-width": "460px", "--right-panel-width": "300px", height: "100vh" } as React.CSSProperties}
      >
        <div className="top-stage" style={{ height: "calc(58% - 6px)" }}>
          <div className={`analytical-deck studio-detail-drawer panel ${drawerOpen ? "drawer-open" : "drawer-closed"}`} hidden={!drawerOpen}>
            <StudioToolRail activeTab={tab} drawerOpen={drawerOpen} onSelectTab={noop} onToggleDrawer={noop} />
            <div role="tabpanel" id={`studio-tabpanel-${tab}`} aria-labelledby={`studio-tab-${tab}`}>
              <div className="deck-pane">{panels[tab]}</div>
            </div>
          </div>
          <section className="monitor panel">
            <div className="section-head monitor-section-head">
              <div className="monitor-head-left">
                <span className="eyebrow">PROGRAM FILM PREVIEW</span>
              </div>
              <span className="muted">
                {state.playing ? "PLAYING" : "PAUSED"} · {currentShot ? `SHOT ${String(currentShot.index).padStart(3, "0")}` : "—"}
              </span>
            </div>
            <div className="screen">
              <video ref={video} src={url || undefined} muted playsInline />
            </div>
            <div className="transport studio-transport-bar">
              <PlayheadTimecode className="timecode studio-timecode mono" frameRate={project.frameRate} dropFrame={project.dropFrame} />
            </div>
          </section>
          <aside className="expanded-map-context" aria-label="Selected shot">
            <MapShotSummary shot={selectedShot ?? currentShot} project={project} thumbnail={(selectedShot ?? currentShot) ? thumbnails[(selectedShot ?? currentShot)!.id] : undefined} onOpenInspector={noop} onPrevious={noop} onNext={noop} />
          </aside>
        </div>
        <div className="bottom-stage" style={{ flex: "1 1 0", minHeight: "130px" }}>
          <EditingMap
            project={project}
            thumbnails={thumbnails}
            selected={workspace.selectedShot}
            active={current}
            onSeek={noop}
            onScrub={noop}
            onShot={noop}
            onPlayShot={noop}
            selectedCut={workspace.selectedCut}
            onRangeChange={noop}
            selectedSequenceId={workspace.selectedSequence}
            speechAnalysis={project.speechAnalysis}
            loudnessAnalysis={project.loudnessAnalysis}
            hasVideo
            url={url}
            workspaceMode="studio"
            showMinimap={false}
            activeTab={tab}
            drawerOpen={drawerOpen}
            onSelectTab={noop}
            onToggleDrawer={noop}
            highlightedShotIds={undefined}
          />
        </div>
      </main>
    </div>
  );
}

void playhead;
