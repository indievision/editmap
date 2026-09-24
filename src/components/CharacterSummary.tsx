import { useMemo, useState } from "react";
import type { CastMember, Project, Shot } from "../models/project";
import { alternations, appearanceGaps, sharedPresence, type PresenceRange } from "../analysis/characterPresence";

const duration = (intervals: { startSeconds: number; endSeconds: number }[]) =>
  intervals.reduce((total, interval) => total + Math.max(0, interval.endSeconds - interval.startSeconds), 0);
const clock = (seconds: number) => `${Math.floor(seconds / 60)}:${String(Math.round(seconds % 60)).padStart(2, "0")}`;

export function CastGallery({
  cast,
  shot,
  disabled,
  onAdd,
  onReference,
  onRemove,
  onRename,
  onMerge,
}: {
  cast: CastMember[];
  shot?: Shot;
  disabled: boolean;
  onAdd: (name: string) => void;
  onReference: (memberId: string) => Promise<void>;
  onRemove: (memberId: string) => void;
  onRename?: (memberId: string, newName: string) => void;
  onMerge?: (sourceMemberId: string, targetMemberId: string) => void;
}) {
  const [name, setName] = useState("");
  const [editingId, setEditingId] = useState<string | null>(null);
  const [tempName, setTempName] = useState("");
  const [open, setOpen] = useState(() => !cast.some((member) => member.references.length));
  const referenceCount = cast.reduce((total, member) => total + member.references.length, 0);
  return (
    <section className={`cast-gallery panel ${open ? "setup-open" : "setup-collapsed"}`} aria-label="Cast gallery">
      <div className="section-head">
        <div>
          <span className="eyebrow">CAST GALLERY</span>
          <span className="muted">{cast.length} cast · {referenceCount} reference {referenceCount === 1 ? "view" : "views"}</span>
        </div>
        <button className="disclosure-toggle" aria-expanded={open} onClick={() => setOpen((value) => !value)}>
          {open ? "Collapse cast" : "Show cast"}
        </button>
      </div>
      {open && (
        <div className="cast-body">
          <div className="cast-add">
            <input aria-label="Character name" placeholder="Anna, Detective…" value={name} onChange={(event) => setName(event.target.value)} />
            <button disabled={!name.trim()} onClick={() => { onAdd(name.trim()); setName(""); }}>Add character</button>
          </div>
          {!cast.length ? (
            <p className="tag-help">Characters can be automatically discovered using the scanner, or added manually with reference views you control.</p>
          ) : (
            <div className="cast-members">
              {cast.map((member) => (
                <article key={member.id} className="cast-member">
                  {member.references[0] ? (
                    <img src={`data:image/jpeg;base64,${member.references[0].image}`} alt={`${member.name} reference`} />
                  ) : (
                    <div className="portrait-empty">?</div>
                  )}
                  <div>
                    <input
                      className="cast-name-input"
                      aria-label={`Rename ${member.name}`}
                      title="Click to rename"
                      value={editingId === member.id ? tempName : member.name}
                      onFocus={() => {
                        setEditingId(member.id);
                        setTempName(member.name);
                      }}
                      onChange={(e) => setTempName(e.target.value)}
                      onBlur={() => {
                        if (editingId === member.id) {
                          const trimmed = tempName.trim();
                          if (trimmed && trimmed !== member.name) {
                            onRename?.(member.id, trimmed);
                          }
                          setEditingId(null);
                        }
                      }}
                      onKeyDown={(e) => {
                        if (e.key === "Enter") e.currentTarget.blur();
                        if (e.key === "Escape") setEditingId(null);
                      }}
                    />
                    <small>{member.references.length} reference {member.references.length === 1 ? "view" : "views"}</small>
                  </div>
                  <div className="cast-member-actions">
                    {cast.length > 1 && onMerge && (
                      <select
                        className="merge-select"
                        aria-label={`Merge ${member.name} into another character`}
                        title="Merge this character into another"
                        defaultValue=""
                        onChange={(e) => {
                          if (e.target.value) {
                            onMerge(member.id, e.target.value);
                            e.target.value = "";
                          }
                        }}
                      >
                        <option value="" disabled>Merge into…</option>
                        {cast
                          .filter((other) => other.id !== member.id)
                          .map((other) => (
                            <option key={other.id} value={other.id}>{other.name}</option>
                          ))}
                      </select>
                    )}
                    <button
                      disabled={!shot || disabled}
                      title={shot ? `Use Shot ${shot.index} midpoint` : "Select a representative shot first"}
                      onClick={() => void onReference(member.id).then(() => setOpen(false))}
                    >
                      Add view
                    </button>
                    <button className="quiet" aria-label={`Remove ${member.name}`} onClick={() => onRemove(member.id)}>
                      ×
                    </button>
                  </div>
                </article>
              ))}
            </div>
          )}
        </div>
      )}
    </section>
  );
}

export default function CharacterSummary({ project, range, selectedMember, onSelect, onInspect, onConfirmShot, onRemoveAppearance, onRangeChange, onPlayRange, onSeek }: {
  project: Project; range?: { start: number; end: number }; selectedMember?: string;
  onSelect: (memberId?: string) => void; onInspect: (shot: Shot) => void;
  onConfirmShot: (shotId: string) => void; onRemoveAppearance: (shotId: string, memberId: string) => void;
  onRangeChange: (range?: PresenceRange) => void; onPlayRange: (range: PresenceRange) => void; onSeek: (time: number) => void;
}) {
  const [comparisonMember, setComparisonMember] = useState<string>();
  const allSummary = useMemo(() => project.cast?.map((member) => {
    const intervals = project.shots.flatMap((shot) => {
      const analysis = shot.characterAnalysis;
      // A confirmed manual decision (including an empty list) is the source
      // of truth for this shot and suppresses old model evidence.
      if (analysis?.manualReviewStatus === "Confirmed") return [];
      return (analysis?.intervals ?? []).filter((interval) => interval.memberId === member.id).map((interval) => ({ ...interval, shot }));
    });
    const seconds = duration(intervals);
    const shots = new Map(intervals.map((interval) => [interval.shot.id, interval.shot])).values();
    const manualShots = project.shots.filter((shot) => shot.characterAnalysis?.manualReviewStatus === "Confirmed" && shot.characterAnalysis.manualMemberIds?.includes(member.id));
    return { member, intervals, seconds, shots: [...new Map([...shots, ...manualShots].map((shot) => [shot.id, shot])).values()], manualShots };
  }) ?? [], [project.cast, project.shots]);
  const summary = useMemo(() => allSummary.map((item) => ({ ...item, intervals: item.intervals.flatMap((interval) => {
    const startSeconds = Math.max(interval.startSeconds, range?.start ?? -Infinity);
    const endSeconds = Math.min(interval.endSeconds, range?.end ?? Infinity);
    return endSeconds > startSeconds || (interval.startSeconds === interval.endSeconds && interval.startSeconds >= (range?.start ?? -Infinity) && interval.startSeconds <= (range?.end ?? Infinity)) ? [{ ...interval, startSeconds, endSeconds }] : [];
  }) })).map((item) => ({ ...item, seconds: duration(item.intervals), shots: [...new Map([...item.intervals.map((interval) => [interval.shot.id, interval.shot] as const), ...item.manualShots.filter((shot) => !range || (shot.endSeconds > range.start && shot.startSeconds < range.end)).map((shot) => [shot.id, shot] as const)]).values()] })), [allSummary, range]);
  const comparison = selectedMember && comparisonMember && comparisonMember !== selectedMember ? [allSummary.find((item) => item.member.id === selectedMember), allSummary.find((item) => item.member.id === comparisonMember)] as const : undefined;
  const pairReadings = comparison?.[0] && comparison?.[1] ? {
    shared: sharedPresence(comparison[0].intervals, comparison[1].intervals, range),
    alternating: alternations(project.shots, comparison[0].member.id, comparison[1].member.id, range),
  } : undefined;
  const coverage = project.shots.reduce((total, shot) => total + (shot.characterAnalysis?.sampleTimes.length ?? 0), 0);
  const unresolved = project.shots.reduce((total, shot) => total + (shot.characterAnalysis?.unresolvedTimes.length ?? 0), 0);
  const failed = project.shots.reduce((total, shot) => total + (shot.characterAnalysis?.failedTimes?.length ?? 0), 0);
  const lastCharacterError = [...project.shots].reverse().map((shot) => shot.characterAnalysis?.lastError).find(Boolean);
  const scannedShots = project.shots.filter((shot) => shot.characterAnalysis).length;
  const partialShots = project.shots.filter((shot) => shot.characterAnalysis?.partial).length;
  const matchedShots = project.shots.filter((shot) => (shot.characterAnalysis?.intervals.length ?? 0) > 0 || (shot.characterAnalysis?.manualMemberIds?.length ?? 0) > 0).length;
  const noReferences = (project.cast ?? []).filter((member) => !member.references.length).length;
  const timelineDuration = project.duration || 1;
  const selectPassage = (passage: PresenceRange) => { onRangeChange(passage); passage.end > passage.start ? onPlayRange(passage) : onSeek(passage.start); };
  if (!project.cast?.length) return null;
  return <section className="character-summary panel" aria-label="Character screen time">
    <div className="section-head"><div><span className="eyebrow">CHARACTER APPEARANCES</span><span className="muted">Sampled presence and manual shot review</span></div><span className="muted">{coverage} samples · {unresolved} unresolved{failed ? ` · ${failed} failed` : ""}</span></div>
    <p className="tag-help">{matchedShots ? "Sampled intervals are estimates; midpoint results are markers, not measured screen time. A non-match is unresolved, never an absence." : `No matches yet. ${scannedShots ? `${scannedShots} scanned shot${scannedShots === 1 ? "" : "s"}, ${unresolved} unresolved` : "No character samples have run"}.${partialShots ? ` ${partialShots} detailed shot${partialShots === 1 ? " is" : "s are"} partial and can resume.` : ""}${noReferences ? ` ${noReferences} cast member${noReferences === 1 ? " has" : "s have"} no reference image; manual review still works.` : ""}${range ? " The active range may hide appearances outside it." : ""}`}</p>
    {failed > 0 && <p className="tag-help character-error">{failed} character request{failed === 1 ? "" : "s"} failed or timed out. Last: {lastCharacterError}</p>}
    <div className="presence-arc" aria-label="Character presence over time">
      <div className="presence-head"><b>PRESENCE ARC</b><span className="muted">Click a block to select and play its sampled passage.</span>{project.sequences?.some((s) => (s.kind ?? "passage") === "passage") ? <span className="presence-scenes">{project.sequences.filter((s) => (s.kind ?? "passage") === "passage").map((scene) => <button key={scene.id} className={range?.start === scene.startSeconds && range.end === scene.endSeconds ? "selected" : ""} onClick={() => onRangeChange({ start: scene.startSeconds, end: scene.endSeconds })}>{scene.name}</button>)}</span> : null}</div>
      <div className="presence-lanes">{allSummary.map(({ member, intervals, manualShots }) => <div className={`presence-lane ${selectedMember === member.id ? "selected" : ""}`} key={member.id}><button className="presence-name" onClick={() => onSelect(selectedMember === member.id ? undefined : member.id)}>{member.name}</button><div className="presence-track" aria-label={`${member.name} visible intervals`}>{range && <i className="presence-selection" style={{ left: `${range.start / timelineDuration * 100}%`, width: `${(range.end - range.start) / timelineDuration * 100}%` }} />}{intervals.map((interval, index) => <button key={`${interval.shot.id}-${index}`} className={`presence-block ${interval.reviewStatus === "Confirmed" ? "confirmed" : ""}`} title={`${member.name}: ${clock(interval.startSeconds)}–${clock(interval.endSeconds)} (${interval.reviewStatus})`} aria-label={`Play ${member.name} from ${clock(interval.startSeconds)} to ${clock(interval.endSeconds)}`} style={{ left: `${interval.startSeconds / timelineDuration * 100}%`, width: `${Math.max(0.5, (interval.endSeconds - interval.startSeconds) / timelineDuration * 100)}%` }} onClick={() => selectPassage({ start: interval.startSeconds, end: interval.endSeconds })} />)}{manualShots.map((manual) => <button key={`manual-${manual.id}`} className="presence-manual" title={`${member.name}: manually assigned to Shot ${manual.index}; no timing inferred`} aria-label={`Inspect manual ${member.name} assignment in Shot ${manual.index}`} style={{ left: `${((manual.startSeconds + manual.endSeconds) / 2) / timelineDuration * 100}%` }} onClick={() => onInspect(manual)} />)}{project.shots.flatMap((shot) => shot.characterAnalysis?.unresolvedTimes ?? []).map((time, index) => <i key={`${time}-${index}`} className="presence-unresolved" title={`Unresolved sample at ${clock(time)}`} style={{ left: `${time / timelineDuration * 100}%` }} />)}</div></div>)}</div>
    </div>
    <div className="character-rows">{summary.map(({ member, intervals, seconds, shots, manualShots }) => <article className={`character-row ${selectedMember === member.id ? "selected" : ""}`} key={member.id}>
      <button className="character-main" onClick={() => onSelect(selectedMember === member.id ? undefined : member.id)}>{member.references[0] ? <img src={`data:image/jpeg;base64,${member.references[0].image}`} alt="" /> : <i>?</i>}<b>{member.name}</b><span className="character-meter"><i style={{ width: `${project.duration ? Math.min(100, seconds / project.duration * 100) : 0}%` }} /></span><strong>{intervals.some((item) => item.endSeconds > item.startSeconds) ? clock(seconds) : intervals.length ? "Unmeasured" : clock(seconds)}</strong><small>{intervals.some((item) => item.endSeconds > item.startSeconds) ? `${project.duration ? (seconds / project.duration * 100).toFixed(1) : "0.0"}% · ` : "Fast markers · "}{shots.length} shots</small></button>
      {selectedMember === member.id && <div className="character-intervals">{intervals.length ? intervals.map((item, index) => <span className="appearance-item" key={`${item.shot.id}-${index}`}><button onClick={() => onInspect(item.shot)}>Shot {item.shot.index} · {clock(item.startSeconds)}–{clock(item.endSeconds)}</button><button className="quiet" title="Remove this mistaken match and protect the corrected shot on future scans" onClick={() => onRemoveAppearance(item.shot.id, member.id)}>×</button>{item.shot.characterAnalysis?.reviewStatus !== "Confirmed" && <button className="quiet" onClick={() => onConfirmShot(item.shot.id)}>Confirm</button>}</span>) : <span className="muted">No sampled appearances in this selection.</span>}{manualShots.map((manual) => <span className="appearance-item" key={`manual-${manual.id}`}><button onClick={() => onInspect(manual)}>Shot {manual.index} · manual assignment</button></span>)}{appearanceGaps(allSummary.find((item) => item.member.id === member.id)?.intervals ?? [], range).map((gap, index) => <button className="presence-finding" key={`${gap.start}-${index}`} onClick={() => selectPassage(gap)}>Sampled gap · {clock(gap.start)}–{clock(gap.end)}</button>)}</div>}
    </article>)}</div>
    {selectedMember && <div className="pair-reading"><label>Compare with <select aria-label="Compare character presence" value={comparisonMember ?? ""} onChange={(event) => setComparisonMember(event.target.value || undefined)}><option value="">Choose character…</option>{allSummary.filter((item) => item.member.id !== selectedMember).map((item) => <option key={item.member.id} value={item.member.id}>{item.member.name}</option>)}</select></label>{comparison?.[0] && comparison?.[1] && <><span className="muted">{comparison[0].member.name} × {comparison[1].member.name}</span><div>{pairReadings?.shared.length ? pairReadings.shared.map((passage, index) => <button className="presence-finding" key={`shared-${index}`} onClick={() => selectPassage(passage)}>Shared visibility · {clock(passage.start)}–{clock(passage.end)}</button>) : <span className="muted">No sampled shared visibility in this selection.</span>}{pairReadings?.alternating.map((passage, index) => <button className="presence-finding" key={`alternate-${index}`} onClick={() => selectPassage(passage)}>Separate-shot alternation · {clock(passage.start)}–{clock(passage.end)}</button>)}</div></>}</div>}
  </section>;
}
