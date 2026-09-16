import { useEffect, useRef, useState } from "react";
import {
  analyzeFrames,
  createFrameSampler,
  sampleShotFrames,
  fetchLocalModel,
  type Tags,
} from "../analysis/localModel";
import type { CastMember, CharacterAnalysis, Shot } from "../models/project";
import {
  characterReferenceSignature,
  discoverCharactersAcrossShots,
  type DiscoveryCheckpoint,
  isEligibleForCharacterScan,
  scanCharactersInShot,
  type CharacterScanMode,
} from "../analysis/characters";

export default function AllShotsAnalysis({
  shots,
  url,
  disabled,
  onBusyChange,
  onResult,
  onPreview,
  cast = [],
  onCharacterResult,
  onAutoDiscoverComplete,
  onComplete,
  onFramingFailure,
}: {
  shots: Shot[];
  url: string;
  disabled: boolean;
  onBusyChange: (busy: boolean) => void;
  onPreview: (shot: Shot, time: number, image?: string) => void;
  onResult: (id: string, tags: Tags) => void;
  cast?: CastMember[];
  onCharacterResult?: (id: string, analysis: CharacterAnalysis) => void;
  onAutoDiscoverComplete?: (cast: CastMember[], shotAnalyses: Map<string, CharacterAnalysis>) => void;
  /** Return the foreground monitor to ordinary video decoding after sampling. */
  onComplete?: () => void;
  onFramingFailure?: (id: string, message: string) => void;
}) {
  const [activeScan, setActiveScan] = useState<"framing" | "characters" | null>(null);
  const isAlreadyAnalyzed =
    shots.length > 0 &&
    shots.every((s) => s.reviewStatus === "Confirmed" || (s.suggestion && !s.analysisFailures?.framing));
  const hasCast = Boolean(cast && cast.length > 0);
  const [setupOpen, setSetupOpen] = useState(!isAlreadyAnalyzed && !hasCast);

  // Step 1 state (Framing & Composition)
  const [framingProgress, setFramingProgress] = useState({ completed: 0, total: 0 });
  const [framingStatus, setFramingStatus] = useState("");
  const [framingError, setFramingError] = useState("");
  const remainingFraming = useRef<Shot[]>([]);

  // Step 2 state (Characters)
  const [characterProgress, setCharacterProgress] = useState({ completed: 0, total: 0 });
  const [characterStatus, setCharacterStatus] = useState("");
  const [characterError, setCharacterError] = useState("");
  const [characterMode, setCharacterMode] = useState<CharacterScanMode>("fast");
  const remainingCharacters = useRef<string[]>([]);

  const discoveryCheckpoint = useRef<DiscoveryCheckpoint>(new Map());
  const [discoveryPending, setDiscoveryPending] = useState(false);
  const controller = useRef<AbortController | null>(null);
  const latestShots = useRef(shots);

  const isBusy = activeScan !== null;
  const [serviceStatus, setServiceStatus] = useState("Checking local CV service…");
  useEffect(() => {
    const controller = new AbortController();
    let mounted = true;
    const timeout = setTimeout(() => controller.abort(), 5000);
    void fetchLocalModel("/api/health", { method: "GET", signal: controller.signal })
      .then(async response => {
        if (!response.ok) throw new Error("offline");
        const data = await response.json();
        const framing = data.engines?.framing;
        const characters = data.engines?.characters;
        setServiceStatus(`Local CV · framing ${framing?.status ?? "unknown"} · faces ${characters?.status ?? "unknown"}`);
      }).catch(() => { if (mounted) setServiceStatus("Local CV offline · start the Python service to analyze"); })
      .finally(() => clearTimeout(timeout));
    return () => { mounted = false; clearTimeout(timeout); controller.abort(); };
  }, [isBusy]);

  useEffect(() => {
    onBusyChange(isBusy);
    return () => onBusyChange(false);
  }, [isBusy, onBusyChange]);

  useEffect(() => () => controller.current?.abort(), []);
  useEffect(() => { latestShots.current = shots; }, [shots]);

  const referencedCast = cast.filter((member) => member.references.length);
  const peopleShots = shots.filter(isEligibleForCharacterScan);

  // Step 1: Scan Shot Sizes & Composition
  const runFramingScan = async (resume = false, discoverAfter = false) => {
    if (controller.current || disabled || !url || !shots.length) return;
    const queue = resume
      ? remainingFraming.current
      : shots.filter((s) => s.reviewStatus !== "Confirmed");

    if (!queue.length) {
      setFramingStatus("All shots are already confirmed.");
      if (discoverAfter) await runAutoCharacterDiscovery();
      return;
    }

    const c = new AbortController();
    controller.current = c;
    remainingFraming.current = queue;
    let completed = resume ? framingProgress.completed : 0;
    const total = completed + queue.length;

    setActiveScan("framing");
    setFramingError("");
    setFramingProgress({ completed, total });

    let sampler: Awaited<ReturnType<typeof createFrameSampler>> | undefined;
    const startedAt = performance.now();
    try {
      sampler = await createFrameSampler(url, c.signal);
      let prepared = await prepareFrame(remainingFraming.current[0], sampler);

      while (remainingFraming.current.length && prepared && !c.signal.aborted) {
        const shot = prepared.shot;
        setFramingStatus(
          `Scanning shot ${shot.index} · ${completed} of ${total} complete`,
        );
        const request = new AbortController();
        const abort = () => request.abort();
        c.signal.addEventListener("abort", abort, { once: true });
        const timeout = setTimeout(abort, 120000);

        try {
          onPreview(shot, prepared.time, prepared.image);
          const nextShot = remainingFraming.current[1];
          const tags = await analyzeFrames(prepared.images, request.signal);

          if (c.signal.aborted) break;
          if (request.signal.aborted) throw new Error("Analysis timed out.");

          onResult(shot.id, tags);
          latestShots.current = latestShots.current.map(s => s.id === shot.id ? { ...s, ...tags } : s);
          await nextPaint();
          if (c.signal.aborted) break;

          const next = nextShot
            ? prepareFrame(nextShot, sampler).then(
                (value) => ({ value }),
                (error) => ({ error }),
              )
            : undefined;

          remainingFraming.current = remainingFraming.current.slice(1);
          completed++;
          setFramingProgress({ completed, total });

          if (next) {
            const result = await next;
            if ("error" in result) throw result.error;
            if (!result.value)
              throw new Error("Could not sample this video frame.");
            prepared = result.value;
          } else {
            prepared = undefined;
          }
        } catch (e) {
          if (!c.signal.aborted) {
            const failedShot = remainingFraming.current[0] ?? shot;
            const message = `Shot ${failedShot.index}: ${request.signal.aborted ? "Analysis timed out." : e instanceof Error ? e.message : "Local analysis failed."} Completed readings are kept. Resume to retry this shot.`;
            setFramingError(message);
            onFramingFailure?.(failedShot.id, message);
            setSetupOpen(true);
          }
          break;
        } finally {
          clearTimeout(timeout);
          c.signal.removeEventListener("abort", abort);
        }
      }

      setFramingStatus(
        completed === total
          ? `Framing scan complete · ${total} of ${total} shots ready for review`
          : `Framing scan stopped · ${completed} of ${total} complete`,
      );
      if (completed === total) {
        setSetupOpen(false);
        if (discoverAfter && !c.signal.aborted) await runAutoCharacterDiscovery(sampler);
      }
    } catch (error) {
      if (!c.signal.aborted) { setFramingError(error instanceof Error ? error.message : "Could not sample video."); setSetupOpen(true); }
    } finally {
      sampler?.dispose();
      console.info("EDITMAP framing scan timing", {
        totalMs: performance.now() - startedAt,
      });
      controller.current = null;
      setActiveScan(null);
      onComplete?.();
    }
  };

  // Step 2: Scan Characters across shots with people
  const runCharacterScan = async (resume = false) => {
    if (controller.current || disabled || !url || !shots.length) return;

    if (!referencedCast.length) {
      setCharacterError(
        "Add at least one character with a reference image in the Cast Gallery first.",
      );
      return;
    }

    const queue = resume
      ? remainingCharacters.current.map((id) => latestShots.current.find((shot) => shot.id === id)).filter((shot): shot is Shot => Boolean(shot))
      : shots.filter((shot) => {
          if (!isEligibleForCharacterScan(shot)) return false;
          if (
            shot.characterAnalysis?.reviewStatus === "Confirmed" ||
            shot.characterAnalysis?.manualReviewStatus === "Confirmed"
          ) {
            return false;
          }
          const existing = shot.characterAnalysis;
          const isUpToDate =
            existing &&
            !existing.partial &&
            !(existing.failedTimes?.length) &&
            existing.mode === characterMode &&
            existing.referenceSignature === characterReferenceSignature(referencedCast);
          return !isUpToDate;
        });

    if (!queue.length) {
      const hasAnyPeopleShots = shots.some(isEligibleForCharacterScan);
      if (!hasAnyPeopleShots) {
        setCharacterStatus(
          "No shots tagged with people yet. Run Step 1 first or set people tags in the inspector.",
        );
      } else {
        setCharacterStatus(
          "All character appearances in people shots are already analyzed or confirmed.",
        );
      }
      return;
    }

    const c = new AbortController();
    controller.current = c;
    remainingCharacters.current = queue.map((shot) => shot.id);
    let completed = resume ? characterProgress.completed : 0;
    const total = completed + queue.length;

    setActiveScan("characters");
    setCharacterError("");
    setCharacterProgress({ completed, total });

    let sampler: Awaited<ReturnType<typeof createFrameSampler>> | undefined;
    const startedAt = performance.now();
    try {
      sampler = await createFrameSampler(url, c.signal);

      while (remainingCharacters.current.length && !c.signal.aborted) {
        const shot = latestShots.current.find((item) => item.id === remainingCharacters.current[0]);
        if (!shot) { remainingCharacters.current = remainingCharacters.current.slice(1); continue; }
        setCharacterStatus(
          `Scanning characters · shot ${shot.index} · ${completed} of ${total} complete`,
        );

        const request = new AbortController();
        const abort = () => request.abort();
        c.signal.addEventListener("abort", abort, { once: true });
        const timeout = setTimeout(abort, 120000);

        try {
          const midpointTime = (shot.startSeconds + shot.endSeconds) / 2;
          onPreview(shot, midpointTime);

          const analysis = await scanCharactersInShot(
            shot,
            sampler,
            referencedCast,
            request.signal,
            (time, image) => onPreview(shot, time, image),
            {
              mode: characterMode,
              existing: shot.characterAnalysis,
              onProgress: (partial) => {
                if (!c.signal.aborted) onCharacterResult?.(shot.id, partial);
              },
            },
          );

          if (c.signal.aborted) break;
          if (request.signal.aborted) throw new Error("Character analysis timed out.");

          onCharacterResult?.(shot.id, analysis);
          if (analysis.failedTimes?.length) throw new Error(analysis.lastError ?? "Character samples failed.");
          await nextPaint();
          if (c.signal.aborted) break;

          remainingCharacters.current = remainingCharacters.current.slice(1);
          completed++;
          setCharacterProgress({ completed, total });
        } catch (e) {
          if (!c.signal.aborted) {
            setCharacterError(
              `Shot ${shot.index}: ${request.signal.aborted ? "Analysis timed out." : e instanceof Error ? e.message : "Character analysis failed."} Completed readings are kept. Resume to retry this shot.`,
            );
            setSetupOpen(true);
          }
          break;
        } finally {
          clearTimeout(timeout);
          c.signal.removeEventListener("abort", abort);
        }
      }

      setCharacterStatus(
        completed === total
          ? `Character scan complete · ${total} of ${total} shots analyzed`
          : `Character scan stopped · ${completed} of ${total} complete`,
      );
      if (completed === total) setSetupOpen(false);
    } catch (error) {
      if (!c.signal.aborted) setCharacterError(error instanceof Error ? error.message : "Could not initialize character frame sampling.");
    } finally {
      sampler?.dispose();
      console.info("EDITMAP character scan timing", {
        totalMs: performance.now() - startedAt,
      });
      controller.current = null;
      setActiveScan(null);
      onComplete?.();
    }
  };

  // Auto-discover characters across shots with people and group into Character 1, 2...
  const runAutoCharacterDiscovery = async (providedSampler?: Awaited<ReturnType<typeof createFrameSampler>>) => {
    if ((controller.current && !providedSampler) || disabled || !url || !shots.length) return;

    const peopleEligible = latestShots.current.filter(isEligibleForCharacterScan);
    if (!peopleEligible.length) {
      setCharacterStatus("No shots tagged with people yet. Run Step 1 first or set people tags in the inspector.");
      return;
    }

    const c = providedSampler ? controller.current ?? new AbortController() : new AbortController();
    if (!providedSampler) controller.current = c;

    setActiveScan("characters");
    setCharacterError("");
    setCharacterProgress({ completed: 0, total: peopleEligible.length });
    setDiscoveryPending(true);
    setCharacterStatus(`Discovering characters across ${peopleEligible.length} shots...`);

    let sampler = providedSampler;
    const ownSampler = !providedSampler;
    const startedAt = performance.now();
    try {
      if (!sampler) {
        sampler = await createFrameSampler(url, c.signal);
      }

      const result = await discoverCharactersAcrossShots(
        latestShots.current,
        sampler,
        c.signal,
        {
          existingCast: cast,
          checkpoint: discoveryCheckpoint.current,
          onCheckpoint: onCharacterResult,
          minAppearances: 1,
          onProgress: (prog) => {
            setCharacterProgress({ completed: prog.completedShots, total: prog.totalShots });
            if (prog.stage === "sampling") {
              setCharacterStatus(
                `Sampling faces · shot ${prog.completedShots} of ${prog.totalShots} (${prog.facesFound} faces found)`
              );
            } else {
              setCharacterStatus(`Clustering ${prog.facesFound} faces into characters...`);
            }
          },
          onFrame: (shot, time, image) => {
            onPreview(shot, time, image);
          },
        }
      );

      if (c.signal.aborted) return;

      onAutoDiscoverComplete?.(result.cast, result.shotAnalyses);
      const failed = [...result.shotAnalyses.values()].filter(a => a.failedTimes?.length).length;
      setDiscoveryPending(failed > 0);
      setCharacterStatus(`Character discovery · ${result.shotAnalyses.size - failed} completed · ${failed} failed · ${result.cast.length} cast members`);
      if (failed) setCharacterError("Some face samples failed. Resume discovery retries failures and keeps completed samples.");
      else discoveryCheckpoint.current.clear();
      setSetupOpen(failed > 0);
    } catch (error) {
      if (!c.signal.aborted) {
        setCharacterError(error instanceof Error ? error.message : "Auto-character discovery failed.");
        setSetupOpen(true);
      }
    } finally {
      if (ownSampler) {
        sampler?.dispose();
        controller.current = null;
        setActiveScan(null);
        onComplete?.();
      }
      console.info("EDITMAP auto character discovery timing", {
        totalMs: performance.now() - startedAt,
      });
    }
  };

  // The full workflow shares the same queue, checkpoints, and failure semantics.
  const runFullPipeline = () => runFramingScan(false, true);

  return (
    <section className={`all-shots-analysis panel ${setupOpen ? "setup-open" : "setup-collapsed"}`} aria-label="Scan workflow">
      <div className="section-head">
        <div>
          <span className="eyebrow">SCAN WORKFLOW</span>
          <span className="muted">
            {activeScan
              ? activeScan === "framing"
                ? `Framing ${framingProgress.completed}/${framingProgress.total}`
                : `Characters ${characterProgress.completed}/${characterProgress.total}`
              : framingStatus || characterStatus
              ? framingStatus || characterStatus
              : isAlreadyAnalyzed
              ? `Framing ready for review · ${shots.length} shots · ${cast?.length ?? 0} characters in cast`
              : framingStatus || characterStatus || `${shots.filter((shot) => shot.reviewStatus !== "Confirmed").length} framing review · ${shots.reduce((count, shot) => count + (shot.characterAnalysis?.failedTimes?.length ?? 0), 0)} character failures`}
          </span>
        </div>
        <button
          className="disclosure-toggle"
          aria-expanded={setupOpen}
          onClick={() => setSetupOpen((open) => !open)}
        >
          {setupOpen ? "Collapse setup" : isAlreadyAnalyzed ? "Re-scan options" : "Show setup"}
        </button>
      </div>
      {activeScan && (
        <div className="scan-live-controls">
          <span role="status" aria-live="polite" aria-atomic="true">
            {activeScan === "framing" ? framingStatus : characterStatus}
          </span>
          <button onClick={() => controller.current?.abort()}>Cancel scan</button>
        </div>
      )}
      {setupOpen && (
        <div className="scan-setup-content">
          <div className="full-scan-action">
            <div>
              <b style={{ color: "#f2dfb3", fontSize: 13 }}>✨ Full Auto Analysis</b>
              <span className="muted" style={{ display: "block", fontSize: 11, marginTop: 2 }}>
                Runs Step 1 (Framing & People), then immediately auto-discovers and clusters characters.
              </span>
            </div>
            <button
              className="primary"
              disabled={disabled || isBusy || !url || !shots.length}
              onClick={() => void runFullPipeline()}
              title="Run complete framing and character discovery in one click"
            >
              Analyze Movie
            </button>
          </div>
          <div className="scan-steps-grid">
            {/* Step 1: Shot Sizes & Composition */}
            <div className="scan-step-card">
              <div className="scan-step-header">
                <span className="scan-step-badge">Step 1</span>
                <span className="scan-step-title">Shot Sizes & Composition</span>
              </div>
              <p className="tag-help">
                Identifies shot scale, people count, and main subject using one frame per shot.
              </p>
              <div className="scan-step-actions">
                <button
                  disabled={disabled || isBusy || !url || !shots.length}
                  onClick={() => void runFramingScan()}
                >
                  1. Scan framing & people
                </button>
                {!isBusy && remainingFraming.current.length > 0 ? (
                  <button
                    disabled={disabled || !url}
                    onClick={() => void runFramingScan(true)}
                  >
                    Resume scan
                  </button>
                ) : null}
              </div>
              {framingStatus && (
                <div className="scan-progress" aria-live="polite" aria-atomic="true">
                  <progress
                    aria-label="Framing scan progress"
                    value={framingProgress.completed}
                    max={framingProgress.total}
                  />
                  <span role="status">{framingStatus}</span>
                </div>
              )}
              {framingError && (
                <p role="alert" aria-live="assertive" className="scan-error-text">
                  {framingError}
                </p>
              )}
            </div>

            {/* Step 2: Character Appearances */}
            <div className="scan-step-card">
              <div className="scan-step-header">
                <span className="scan-step-badge">Step 2</span>
                <span className="scan-step-title">Character Discovery & Appearances</span>
              </div>
              <p className="tag-help">
                {!referencedCast.length
                  ? `Auto-discovers faces across ${peopleShots.length} shot${peopleShots.length === 1 ? "" : "s"} with people and creates Character 1, Character 2, etc.`
                  : `Scans ${peopleShots.length} shot${peopleShots.length === 1 ? "" : "s"} tagged with people using Cast Gallery references.`}
              </p>
              <div className="scan-step-actions">
                {!referencedCast.length ? (
                  <button
                    disabled={disabled || isBusy || !url || !shots.length || !peopleShots.length}
                    onClick={() => void runAutoCharacterDiscovery()}
                    title={!peopleShots.length ? "Run Step 1 first to identify shots with people" : "Auto-discover characters across people shots"}
                  >
                    2. Auto-discover characters
                  </button>
                ) : (
                  <>
                    <button
                      disabled={disabled || isBusy || !url || !shots.length || !peopleShots.length}
                      onClick={() => void runCharacterScan()}
                    >
                      2. Scan characters
                    </button>
                    <button
                      disabled={disabled || isBusy || !url || !shots.length || !peopleShots.length}
                      onClick={() => void runAutoCharacterDiscovery()}
                      title="Re-discover and cluster characters from scratch"
                    >
                      Auto-discover
                    </button>
                  </>
                )}
                {!isBusy && remainingCharacters.current.length > 0 ? (
                  <button
                    disabled={disabled || !url}
                    onClick={() => void runCharacterScan(true)}
                  >
                    Resume scan
                  </button>
                ) : null}
                {!isBusy && discoveryPending && (
                  <button disabled={disabled || !url} onClick={() => void runAutoCharacterDiscovery()}>Resume discovery</button>
                )}
                {referencedCast.length > 0 && (
                  <label className="character-pass-toggle">
                    Mode
                    <select
                      aria-label="Character scan mode"
                      value={characterMode}
                      disabled={isBusy}
                      onChange={(event) =>
                        setCharacterMode(event.target.value as CharacterScanMode)
                      }
                    >
                      <option value="fast">Fast · midpoint</option>
                      <option value="detailed">Detailed · 5 samples</option>
                    </select>
                  </label>
                )}
              </div>
              {characterStatus && (
                <div className="scan-progress" aria-live="polite" aria-atomic="true">
                  <progress
                    aria-label="Character scan progress"
                    value={characterProgress.completed}
                    max={characterProgress.total}
                  />
                  <span role="status">{characterStatus}</span>
                </div>
              )}
              {characterError && (
                <p role="alert" aria-live="assertive" className="scan-error-text">
                  {characterError}
                </p>
              )}
            </div>
          </div>

        {!shots.length ? (
          <p className="tag-help">Import an EDL to scan shots.</p>
        ) : !url ? (
          <p className="tag-help">Link a video to scan shots.</p>
        ) : (
          <p className="tag-help">
            {serviceStatus} · Runs entirely on this Mac.
          </p>
        )}
        </div>
      )}
    </section>
  );
}

async function prepareFrame(
  shot: Shot | undefined,
  sampler: Awaited<ReturnType<typeof createFrameSampler>>,
) {
  if (!shot) return undefined;
  const startedAt = performance.now();
  const samples = await sampleShotFrames(sampler, shot.startSeconds, shot.endSeconds);
  return { shot, ...samples, image: samples.previewImage, durationMs: performance.now() - startedAt };
}

function nextPaint() {
  return new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
}
