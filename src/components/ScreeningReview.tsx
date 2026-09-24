import { useEffect, useMemo, useRef, useState } from "react";
import type { Project, ScreeningMark, SpeechAnalysis } from "../models/project";
import {
  CUT_MAGNET_SECONDS,
  screeningAnchor,
  screeningEvidence,
  screeningLoop,
} from "../analysis/screening";
import { sampleFrame } from "../analysis/localModel";
import { formatTimecode } from "../utils/timecode";
import "./ScreeningReview.css";
import ReviewContextCurves from "./ReviewContextCurves";
import ReviewEvidenceCapsule from "./ReviewEvidenceCapsule";
import ScreeningSeekBar from "./ScreeningSeekBar";

type Props = {
  project: Project;
  url: string;
  initialTime: number;
  speech?: SpeechAnalysis;
  onChange: (marks: ScreeningMark[]) => void;
  onTime: (time: number) => void;
  onRelink: () => void;
  onStudio: (time: number) => void;
  onMediaLoaded: (video: HTMLVideoElement) => void;
};

export default function ScreeningReview({
  project,
  url,
  initialTime,
  speech,
  onChange,
  onTime,
  onRelink,
  onStudio,
  onMediaLoaded,
}: Props) {
  const video = useRef<HTMLVideoElement>(null);
  const cinemaRef = useRef<HTMLDivElement>(null);
  const [isFullscreen, setIsFullscreen] = useState(false);
  const initial = useRef(initialTime);
  const [phase, setPhase] = useState<"screening" | "evidence">("screening");
  const [time, setTime] = useState(initialTime);
  const [playing, setPlaying] = useState(false);
  const [ready, setReady] = useState(false);
  const [mirror, setMirror] = useState(false);
  const [darken, setDarken] = useState(false);
  const [muted, setMuted] = useState(false);
  const [magnet, setMagnet] = useState(true);
  const [passId, setPassId] = useState(() => crypto.randomUUID());
  const [selectedId, setSelectedId] = useState<string>();
  const [looping, setLooping] = useState(false);
  const [preRoll, setPreRoll] = useState(7);
  const [notice, setNotice] = useState("");
  const [error, setError] = useState("");
  const [bridge, setBridge] = useState<{
    key: string;
    images?: string[];
    error?: string;
  }>();
  const marks = project.screeningMarks ?? [];
  const selected = marks.find((m) => m.id === selectedId);
  const evidence = useMemo(
    () => (selected ? screeningEvidence(project, selected, speech) : undefined),
    [project, selected, speech],
  );
  const loop = useMemo(
    () => (selected ? screeningLoop(project, selected, preRoll) : undefined),
    [project, selected, preRoll],
  );
  const tc = (t: number) =>
    formatTimecode(t, project.frameRate, project.dropFrame);
  const updateMark = (patch: Partial<ScreeningMark>) =>
    onChange(marks.map((m) => (m.id === selectedId ? { ...m, ...patch } : m)));
  const sync = () => {
    const t = video.current?.currentTime ?? 0;
    setTime(t);
    onTime(t);
  };
  const seekTo = (target: number) => {
    const clamped = Math.max(
      0,
      Math.min(project.duration || (video.current?.duration ?? 0), target),
    );
    if (video.current && ready) {
      video.current.currentTime = clamped;
    }
    setTime(clamped);
    onTime(clamped);
  };
  const play = () => {
    setError("");
    void video.current
      ?.play()
      .catch(() =>
        setError(
          "Playback could not start. Check the linked video and try again.",
        ),
      );
  };
  const toggle = () => {
    if (!ready) return;
    if (video.current?.paused) play();
    else video.current?.pause();
  };
  const dropMark = () => {
    if (!ready || !video.current || phase !== "screening") return;
    const raw = Math.min(
      project.duration,
      Math.max(0, video.current.currentTime),
    );
    const mark: ScreeningMark = {
      id: crypto.randomUUID(),
      passId,
      time: raw,
      ...screeningAnchor(project.shots, raw, magnet),
      createdAt: new Date().toISOString(),
      mirror,
      darken,
      muted,
      notes: "",
      resolved: false,
    };
    onChange([...marks, mark]);
    setNotice(
      `Mark ${marks.length + 1} saved · ${mark.incomingId ? "cut anchored" : "time marked"}`,
    );
  };
  const choose = (mark: ScreeningMark) => {
    setSelectedId(mark.id);
    setPhase("evidence");
    setLooping(true);
    if (video.current && ready) {
      video.current.currentTime = screeningLoop(project, mark, preRoll).start;
      sync();
      play();
    }
  };
  const finish = () => {
    video.current?.pause();
    setLooping(false);
    setNotice("");
    setPhase("evidence");
    const last =
      [...marks].reverse().find((m) => m.passId === passId) ?? marks.at(-1);
    if (last) choose(last);
  };

  const toggleFullscreen = () => {
    if (!document.fullscreenElement) {
      cinemaRef.current?.requestFullscreen?.().catch(() => {});
    } else {
      document.exitFullscreen?.().catch(() => {});
    }
  };

  useEffect(() => {
    const handleFsChange = () => {
      setIsFullscreen(Boolean(document.fullscreenElement));
    };
    document.addEventListener("fullscreenchange", handleFsChange);
    return () =>
      document.removeEventListener("fullscreenchange", handleFsChange);
  }, []);

  useEffect(() => {
    if (!notice) return;
    const timer = window.setTimeout(() => setNotice(""), 1700);
    return () => clearTimeout(timer);
  }, [notice]);
  useEffect(() => {
    setReady(false);
    setError("");
    setLooping(false);
  }, [url]);
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (
        e.repeat ||
        e.ctrlKey ||
        e.metaKey ||
        e.altKey ||
        (e.target as HTMLElement).closest(
          "input,textarea,select,[contenteditable=true]",
        )
      )
        return;
      if (e.key.toLowerCase() === "m" && phase === "screening") {
        e.preventDefault();
        dropMark();
      }
      if (e.code === "Space" && !(e.target as HTMLElement).closest("button")) {
        e.preventDefault();
        toggle();
      }
      if (e.key.toLowerCase() === "f") {
        e.preventDefault();
        toggleFullscreen();
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  });
  // Only run the loop clock during active playback; no background polling.
  useEffect(() => {
    if (
      !playing ||
      !looping ||
      !loop ||
      !selected ||
      phase !== "evidence" ||
      loop.end <= loop.start
    )
      return;
    let frame = 0;
    const tick = () => {
      const v = video.current;
      if (v && v.currentTime >= Math.min(loop.end, v.duration)) {
        v.currentTime = loop.start;
      }
      frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, [playing, looping, loop, selected, phase]);

  const pair = evidence?.pair;
  const bridgeKey = pair
    ? `${url}:${pair.outgoing.id}:${pair.outgoing.endSeconds}:${pair.incoming.id}:${pair.incoming.startSeconds}`
    : "";
  useEffect(() => {
    if (!pair || !url || !ready) return;
    const controller = new AbortController();
    setBridge({ key: bridgeKey });
    void (async () => {
      try {
        const a = await sampleFrame(
          url,
          Math.max(
            pair.outgoing.startSeconds,
            pair.outgoing.endSeconds - 1 / project.frameRate,
          ),
          controller.signal,
        );
        const b = await sampleFrame(
          url,
          pair.incoming.startSeconds,
          controller.signal,
        );
        if (!controller.signal.aborted)
          setBridge({ key: bridgeKey, images: [a, b] });
      } catch {
        if (!controller.signal.aborted)
          setBridge({
            key: bridgeKey,
            error: "Boundary frames unavailable. Use context playback.",
          });
      }
    })();
    return () => controller.abort();
  }, [bridgeKey, ready, project.frameRate]);

  return (
    <main
      className={`screening-review phase-${phase}`}
      aria-label="Screening room"
    >
      <header className="sr-room-head">
        <div>
          <span className="sr-eyebrow">SCREENING ROOM</span>
          <h1>
            {phase === "screening"
              ? "Watch. Feel. Mark."
              : "Return to the feeling."}
          </h1>
        </div>
        <div
          className="sr-phases"
          role="group"
          aria-label="Screening room phase"
        >
          <button
            aria-pressed={phase === "screening"}
            onClick={() => {
              setPhase("screening");
              setLooping(false);
            }}
          >
            01 Screening
          </button>
          <button aria-pressed={phase === "evidence"} onClick={finish}>
            02 Evidence <span>{marks.length}</span>
          </button>
        </div>
        {phase === "screening" ? (
          <button onClick={finish}>Finish pass →</button>
        ) : (
          <button
            onClick={() => {
              video.current?.pause();
              setPassId(crypto.randomUUID());
              setPhase("screening");
              setLooping(false);
            }}
          >
            New pass
          </button>
        )}
      </header>

      <div className="sr-room-body">
        {phase === "evidence" && (
          <aside className="sr-mark-list" aria-label="Screening marks">
            <div className="sr-section-heading">
              <h2>Your marks</h2>
              <span>{marks.length}</span>
            </div>
            {!marks.length && (
              <p className="sr-empty">
                Nothing to reconstruct yet. Start a screening and press M when
                something catches your attention.
              </p>
            )}
            {marks.map((m, i) => (
              <button
                key={m.id}
                className={`sr-mark ${m.id === selectedId ? "selected" : ""}`}
                onClick={() => choose(m)}
              >
                <span className="sr-mark-number">
                  {String(i + 1).padStart(2, "0")}
                </span>
                <span>
                  <strong>{tc(m.anchorTime)}</strong>
                  <small>
                    {m.resolved
                      ? "Reviewed"
                      : m.incomingId
                        ? "Cut seam"
                        : "Moment"}{" "}
                    ·{" "}
                    {m.darken
                      ? "Sound only"
                      : m.muted
                        ? "Picture only"
                        : "Picture + sound"}
                    {m.mirror ? " · Mirrored" : ""}
                  </small>
                  {m.notes && (
                    <small className="sr-note-preview">{m.notes}</small>
                  )}
                </span>
              </button>
            ))}
          </aside>
        )}

        <section className="sr-viewing">
          <div
            ref={cinemaRef}
            className={`sr-cinema ${mirror ? "is-mirrored" : ""} ${darken ? "is-darkened" : ""} ${isFullscreen ? "is-fullscreen" : ""}`}
          >
            <video
              ref={video}
              src={url || undefined}
              playsInline
              muted={muted}
              onLoadedMetadata={(e) => {
                const v = e.currentTarget;
                v.currentTime = Math.min(
                  initial.current,
                  Math.max(0, v.duration - 1 / project.frameRate),
                );
                onMediaLoaded(v);
              }}
              onLoadedData={() => setReady(true)}
              onTimeUpdate={sync}
              onPlay={() => setPlaying(true)}
              onPause={() => {
                setPlaying(false);
                sync();
              }}
              onEnded={() => {
                if (
                  phase === "evidence" &&
                  looping &&
                  loop &&
                  loop.end > loop.start
                ) {
                  if (video.current) video.current.currentTime = loop.start;
                  play();
                } else {
                  setPlaying(false);
                  if (phase === "screening") finish();
                }
              }}
              onError={() => {
                setReady(false);
                setError(
                  "Unable to play this media. Relink a supported video.",
                );
              }}
              aria-label="Screening film player"
            />
            {!url && (
              <div className="sr-no-media">
                <h2>Bring the film back into view.</h2>
                <p>Your marks stay with the project.</p>
                <button onClick={onRelink}>Relink video</button>
              </div>
            )}
            {notice && (
              <div className="sr-mark-toast" role="status">
                ● {notice}
              </div>
            )}
            <button
              type="button"
              className="sr-cinema-fs-btn"
              onClick={toggleFullscreen}
              title={
                isFullscreen ? "Exit Fullscreen (Esc / F)" : "Full Screen (F)"
              }
              aria-label={isFullscreen ? "Exit Fullscreen" : "Full Screen"}
            >
              {isFullscreen ? (
                <svg
                  width="15"
                  height="15"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                >
                  <path d="M8 3v3a2 2 0 0 1-2 2H3m18 0h-3a2 2 0 0 1-2-2V3m0 18v-3a2 2 0 0 1 2-2h3M3 16h3a2 2 0 0 1 2 2v3" />
                </svg>
              ) : (
                <svg
                  width="15"
                  height="15"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                >
                  <path d="M15 3h6v6M9 21H3v-6M21 3l-7 7M3 21l7-7" />
                </svg>
              )}
            </button>
            {isFullscreen && (
              <div
                className="sr-fs-hud"
                role="toolbar"
                aria-label="Fullscreen transport HUD"
              >
                <span className="mono">{tc(time)}</span>
                <button
                  type="button"
                  className="sr-play"
                  disabled={!ready}
                  onClick={toggle}
                  aria-label={playing ? "Pause review" : "Play review"}
                >
                  {playing ? "Ⅱ" : "▶"}
                </button>
                <span className="sr-duration">/ {tc(project.duration)}</span>
                <ScreeningSeekBar
                  currentTime={time}
                  duration={project.duration}
                  frameRate={project.frameRate}
                  dropFrame={project.dropFrame}
                  marks={marks}
                  onSeek={(t) => {
                    if (phase === "evidence") setLooping(false);
                    seekTo(t);
                  }}
                  onSelectMark={(mark) => {
                    if (phase === "evidence") {
                      choose(mark);
                    } else {
                      seekTo(mark.anchorTime ?? mark.time);
                    }
                  }}
                  className="sr-fs-seek"
                  disabled={!ready}
                />
                {phase === "screening" ? (
                  <button
                    type="button"
                    className="sr-drop-mark"
                    disabled={!ready}
                    onClick={dropMark}
                  >
                    Drop mark <kbd>M</kbd>
                  </button>
                ) : (
                  <button
                    type="button"
                    disabled={!ready || !selected}
                    aria-pressed={looping}
                    onClick={() => {
                      setLooping(!looping);
                      if (!looping && loop && video.current) {
                        video.current.currentTime = loop.start;
                        play();
                      }
                    }}
                  >
                    ↻ Context loop
                  </button>
                )}
                <div className="sr-fs-perception">
                  <button
                    type="button"
                    aria-pressed={mirror}
                    onClick={() => setMirror(!mirror)}
                    title="Mirror screen"
                  >
                    ↔ Mirror
                  </button>
                  <button
                    type="button"
                    aria-pressed={darken}
                    onClick={() => setDarken(!darken)}
                    title="Darken screen"
                  >
                    ◐ Darken
                  </button>
                  <button
                    type="button"
                    aria-pressed={muted}
                    onClick={() => setMuted(!muted)}
                    title="Mute audio"
                  >
                    ♫ Mute
                  </button>
                </div>
                <button
                  type="button"
                  className="sr-fs-exit-btn"
                  onClick={toggleFullscreen}
                  title="Exit Fullscreen (Esc / F)"
                  aria-label="Exit Fullscreen"
                >
                  ✕ Exit
                </button>
              </div>
            )}
          </div>
          {error && (
            <p className="sr-error" role="alert">
              {error} <button onClick={onRelink}>Relink video</button>
            </p>
          )}
          <ScreeningSeekBar
            currentTime={time}
            duration={project.duration}
            frameRate={project.frameRate}
            dropFrame={project.dropFrame}
            marks={marks}
            onSeek={(t) => {
              if (phase === "evidence") setLooping(false);
              seekTo(t);
            }}
            onSelectMark={(mark) => {
              if (phase === "evidence") {
                choose(mark);
              } else {
                seekTo(mark.anchorTime ?? mark.time);
              }
            }}
            disabled={!ready}
          />
          <div className="sr-transport">
            <span className="mono">{tc(time)}</span>
            <button
              className="sr-play"
              disabled={!ready}
              onClick={toggle}
              aria-label={playing ? "Pause review" : "Play review"}
            >
              {playing ? "Ⅱ" : "▶"}
            </button>
            <span className="sr-duration">/ {tc(project.duration)}</span>
            {phase === "screening" ? (
              <button
                className="sr-drop-mark"
                disabled={!ready}
                onClick={dropMark}
              >
                Drop mark <kbd>M</kbd>
              </button>
            ) : (
              <button
                disabled={!ready || !selected}
                aria-pressed={looping}
                onClick={() => {
                  setLooping(!looping);
                  if (!looping && loop && video.current) {
                    video.current.currentTime = loop.start;
                    play();
                  }
                }}
              >
                ↻ Context loop
              </button>
            )}
            <button
              type="button"
              className="sr-fullscreen-btn"
              onClick={toggleFullscreen}
              title={
                isFullscreen ? "Exit Fullscreen (Esc / F)" : "Full Screen (F)"
              }
              aria-label={isFullscreen ? "Exit Fullscreen" : "Full Screen"}
            >
              {isFullscreen ? (
                <svg
                  width="14"
                  height="14"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                >
                  <path d="M8 3v3a2 2 0 0 1-2 2H3m18 0h-3a2 2 0 0 1-2-2V3m0 18v-3a2 2 0 0 1 2-2h3M3 16h3a2 2 0 0 1 2 2v3" />
                </svg>
              ) : (
                <svg
                  width="14"
                  height="14"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                >
                  <path d="M15 3h6v6M9 21H3v-6M21 3l-7 7M3 21l7-7" />
                </svg>
              )}
              <span>{isFullscreen ? "Exit Fullscreen" : "Full Screen"}</span>
            </button>
          </div>
          <div
            className="sr-perception"
            role="group"
            aria-label="Perception controls"
          >
            <button aria-pressed={mirror} onClick={() => setMirror(!mirror)}>
              ↔ Mirror screen
            </button>
            <button aria-pressed={darken} onClick={() => setDarken(!darken)}>
              ◐ Darken screen
            </button>
            <button aria-pressed={muted} onClick={() => setMuted(!muted)}>
              ♫ Mute audio
            </button>
            {phase === "evidence" && selected && (
              <div className="sr-context-bar">
                <span>Momentum pre-roll</span>
                <select
                  aria-label="Momentum pre-roll"
                  title="Context begins before the preceding seam and includes at least 1 second after it."
                  value={preRoll}
                  onChange={(e) => {
                    const seconds = Number(e.target.value);
                    setPreRoll(seconds);
                    if (video.current && ready)
                      video.current.currentTime = screeningLoop(
                        project,
                        selected,
                        seconds,
                      ).start;
                  }}
                >
                  <option value={6}>6 seconds</option>
                  <option value={7}>7 seconds</option>
                  <option value={8}>8 seconds</option>
                </select>
                <small>{loop && `${tc(loop.start)} → ${tc(loop.end)}`}</small>
              </div>
            )}
          </div>
          {phase === "screening" ? (
            <div className="sr-screening-foot">
              <p>
                Stay with the film. <kbd>M</kbd> leaves a mark without stopping.{" "}
                <kbd>Space</kbd> plays / pauses.
              </p>
              <label>
                <input
                  type="checkbox"
                  checked={magnet}
                  onChange={(e) => setMagnet(e.target.checked)}
                />{" "}
                Cut magnet · {CUT_MAGNET_SECONDS}s /{" "}
                {Math.round(CUT_MAGNET_SECONDS * project.frameRate)} frames
              </label>
              <small>
                Anchors to the preceding hard cut when nearby. Your original
                reaction time is always kept.
              </small>
            </div>
          ) : (
            selected && (
              <>
                {loop && (
                  <ReviewContextCurves
                    project={project}
                    start={loop.start}
                    end={loop.end}
                    time={time}
                    anchor={pair?.time ?? selected.time}
                    onSeek={seekTo}
                  />
                )}
                {pair && (
                  <section className="sr-bridge">
                    <div className="sr-section-heading">
                      <h2>Bridge view</h2>
                      <span>Original orientation · boundary frames</span>
                    </div>
                    <div className="sr-bridge-pair">
                      {[pair.outgoing, pair.incoming].map((shot, i) => (
                        <figure key={shot.id}>
                          {bridge?.key === bridgeKey && bridge.images ? (
                            <img
                              src={`data:image/jpeg;base64,${bridge.images[i]}`}
                              alt={`Shot ${shot.index} ${i ? "head" : "tail"}`}
                            />
                          ) : (
                            <div className="sr-frame-placeholder">
                              {!ready
                                ? "Relink video for boundary frames"
                                : bridge?.error || "Loading boundary frame…"}
                            </div>
                          )}
                          <figcaption>
                            <b>{i ? "B · IN" : "A · OUT"}</b> Shot {shot.index}{" "}
                            <span>
                              {tc(
                                i
                                  ? shot.startSeconds
                                  : Math.max(
                                      shot.startSeconds,
                                      shot.endSeconds - 1 / project.frameRate,
                                    ),
                              )}
                            </span>
                          </figcaption>
                        </figure>
                      ))}
                    </div>
                  </section>
                )}
              </>
            )
          )}
        </section>

        {phase === "evidence" && (
          <ReviewEvidenceCapsule
            project={project}
            selected={selected}
            speech={speech}
            updateMark={updateMark}
            onSeek={(t) => {
              setLooping(false);
              seekTo(t);
            }}
            onStudio={(t) => {
              video.current?.pause();
              onStudio(t);
            }}
          />
        )}
      </div>
    </main>
  );
}
