import React from "react";
import type { SequenceMarker } from "../../models/project";
import type { PassageMeasurements } from "../../analysis/passageComparison";

interface CompareOverviewViewProps {
  passageA?: SequenceMarker;
  passageB?: SequenceMarker;
  metricsA: PassageMeasurements | null;
  metricsB: PassageMeasurements | null;
  castReviewA?: string;
  castReviewB?: string;
}

export default function CompareOverviewView({
  passageA,
  passageB,
  metricsA,
  metricsB,
  castReviewA,
  castReviewB,
}: CompareOverviewViewProps) {
  const formatDuration = (secs: number | null | undefined) => {
    if (secs === null || secs === undefined || !Number.isFinite(secs)) return "—";
    if (secs >= 60) {
      const mins = Math.floor(secs / 60);
      const rem = Math.round(secs % 60);
      return `${Math.round(secs)} s (${mins}m ${rem < 10 ? "0" : ""}${rem}s)`;
    }
    return `${secs.toFixed(1)} s`;
  };

  const formatSeconds = (secs: number | null | undefined) => {
    if (secs === null || secs === undefined || !Number.isFinite(secs)) return "—";
    return `${secs.toFixed(1)} s`;
  };

  const formatShotsPerMin = (cpm: number | null | undefined) => {
    if (cpm === null || cpm === undefined || !Number.isFinite(cpm)) return "—";
    return `${cpm.toFixed(1)} shots/min`;
  };

  const formatRange = (min: number | null | undefined, max: number | null | undefined) => {
    if (min === null || min === undefined || max === null || max === undefined) return "—";
    return `${min.toFixed(1)} s – ${max.toFixed(1)} s`;
  };

  const formatPacingStyle = (
    stdDev: number | null | undefined,
    style: string | null | undefined,
  ) => {
    if (stdDev === null || stdDev === undefined || !Number.isFinite(stdDev)) return "—";
    return `±${stdDev.toFixed(1)} s${style ? ` (${style})` : ""}`;
  };

  const formatPercent = (pct: number | null | undefined) => {
    if (pct === null || pct === undefined || !Number.isFinite(pct)) return "Unavailable";
    return `${Math.round(pct)}%`;
  };

  const formatLoudness = (lufs: number | null | undefined) => {
    if (lufs === null || lufs === undefined || !Number.isFinite(lufs)) return "—";
    return `${lufs.toFixed(1)} LUFS`;
  };

  const formatDynamicRange = (dr: number | null | undefined) => {
    if (dr === null || dr === undefined || !Number.isFinite(dr)) return "—";
    const label = dr >= 15 ? "Wide" : dr >= 8 ? "Moderate" : "Controlled";
    return `${dr.toFixed(1)} LU (${label})`;
  };

  const formatMood = (mood: string | null | undefined, temp: string | null | undefined) => {
    if (!mood && !temp) return "—";
    if (mood && temp) return `${temp} · ${mood}`;
    return mood || temp || "—";
  };

  const formatLeadingChar = (
    char: { name: string; screenShare: number } | null | undefined,
  ) => {
    if (!char) return "—";
    return `${char.name} (${char.screenShare}%)`;
  };

  // Percentage bar metric rows on shared 0-100 scale
  const percentageMetrics = [
    {
      group: "Framing",
      label: "Close-up share",
      valA: metricsA?.closeShare,
      valB: metricsB?.closeShare,
    },
    {
      group: "Framing",
      label: "Wide share",
      valA: metricsA?.wideShare,
      valB: metricsB?.wideShare,
    },
    {
      group: "Framing",
      label: "People in frame",
      valA: metricsA?.peoplePresence,
      valB: metricsB?.peoplePresence,
    },
    {
      group: "Motion",
      label: "Moving camera",
      valA: metricsA?.movingShare,
      valB: metricsB?.movingShare,
    },
    {
      group: "Motion",
      label: "Kinetic movement flow",
      valA: metricsA?.avgKineticEnergy,
      valB: metricsB?.avgKineticEnergy,
    },
    {
      group: "Sound",
      label: "Detected speech coverage",
      valA: metricsA?.speechCoverage,
      valB: metricsB?.speechCoverage,
    },
    {
      group: "Atmosphere",
      label: "Perceived brightness",
      valA: metricsA?.avgLuminance,
      valB: metricsB?.avgLuminance,
    },
  ];

  return (
    <div className="compare-overview-view" data-testid="compare-overview-view">
      {/* 1. KEY MEASUREMENTS TABLE */}
      <div className="compare-view-block">
        <h5 className="compare-block-title">Key measurements</h5>
        <div className="compare-table-wrapper">
          <table className="compare-measurements-table">
            <thead>
              <tr>
                <th className="col-measure">Measure</th>
                <th className="col-val col-a">
                  <span className="col-prefix prefix-a">A · </span>
                  <span className="col-name">{passageA?.name ?? "Passage A"}</span>
                </th>
                <th className="col-val col-b">
                  <span className="col-prefix prefix-b">B · </span>
                  <span className="col-name">{passageB?.name ?? "Passage B"}</span>
                </th>
              </tr>
            </thead>
            <tbody>
              <tr>
                <td className="row-label">Average shot length</td>
                <td className="row-val val-a">{formatSeconds(metricsA?.asl)}</td>
                <td className="row-val val-b">{formatSeconds(metricsB?.asl)}</td>
              </tr>
              <tr>
                <td className="row-label">Median shot segment</td>
                <td className="row-val val-a">{formatSeconds(metricsA?.medianShotDuration)}</td>
                <td className="row-val val-b">{formatSeconds(metricsB?.medianShotDuration)}</td>
              </tr>
              <tr>
                <td className="row-label">Duration</td>
                <td className="row-val val-a">{formatDuration(metricsA?.duration)}</td>
                <td className="row-val val-b">{formatDuration(metricsB?.duration)}</td>
              </tr>
              <tr>
                <td className="row-label">Shots</td>
                <td className="row-val val-a">
                  {metricsA ? `${metricsA.shotCount} shots` : "—"}
                </td>
                <td className="row-val val-b">
                  {metricsB ? `${metricsB.shotCount} shots` : "—"}
                </td>
              </tr>
              <tr>
                <td className="row-label">Shot frequency (shots/min)</td>
                <td className="row-val val-a">{formatShotsPerMin(metricsA?.cutRateCPM)}</td>
                <td className="row-val val-b">{formatShotsPerMin(metricsB?.cutRateCPM)}</td>
              </tr>
              <tr>
                <td className="row-label">Pacing range (Shortest – Longest)</td>
                <td className="row-val val-a">
                  {formatRange(metricsA?.shortestShotDuration, metricsA?.longestShotDuration)}
                </td>
                <td className="row-val val-b">
                  {formatRange(metricsB?.shortestShotDuration, metricsB?.longestShotDuration)}
                </td>
              </tr>
              <tr>
                <td className="row-label">Rhythm variability</td>
                <td className="row-val val-a">
                  {formatPacingStyle(metricsA?.pacingStdDev, metricsA?.pacingStyle)}
                </td>
                <td className="row-val val-b">
                  {formatPacingStyle(metricsB?.pacingStdDev, metricsB?.pacingStyle)}
                </td>
              </tr>
            </tbody>
          </table>
        </div>
      </div>

      {/* 2. ADDITIONAL PERCENTAGE MEASURES (PAIRED BARS) */}
      <div className="compare-view-block">
        <h5 className="compare-block-title">Additional measures (0–100 scale)</h5>
        <div className="compare-paired-bars-container">
          {percentageMetrics.map((m) => {
            const hasA = m.valA !== null && m.valA !== undefined && Number.isFinite(m.valA);
            const hasB = m.valB !== null && m.valB !== undefined && Number.isFinite(m.valB);
            const clampA = hasA ? Math.max(0, Math.min(100, m.valA!)) : 0;
            const clampB = hasB ? Math.max(0, Math.min(100, m.valB!)) : 0;

            return (
              <div key={m.label} className="compare-bar-row">
                <div className="compare-bar-meta">
                  <span className="compare-bar-group">{m.group}</span>
                  <span className="compare-bar-name">{m.label}</span>
                </div>

                {/* Side A paired bar */}
                <div className="compare-bar-side side-a-bar">
                  <span className="compare-bar-val mono">
                    {hasA ? `${Math.round(clampA)}%` : "Unavailable"}
                  </span>
                  <div className="compare-bar-track" aria-hidden="true">
                    {hasA && (
                      <div
                        className="compare-bar-fill fill-a"
                        style={{ width: `${clampA}%` }}
                      />
                    )}
                  </div>
                </div>

                {/* Side B paired bar */}
                <div className="compare-bar-side side-b-bar">
                  <span className="compare-bar-val mono">
                    {hasB ? `${Math.round(clampB)}%` : "Unavailable"}
                  </span>
                  <div className="compare-bar-track" aria-hidden="true">
                    {hasB && (
                      <div
                        className="compare-bar-fill fill-b"
                        style={{ width: `${clampB}%` }}
                      />
                    )}
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      </div>

      {/* 3. CONTEXTUAL & AUDIO MEASURES */}
      <div className="compare-view-block">
        <h5 className="compare-block-title">Sound, atmosphere & cast context</h5>
        <div className="compare-table-wrapper">
          <table className="compare-measurements-table">
            <tbody>
              <tr>
                <td className="row-label">Dominant shot size</td>
                <td className="row-val val-a">{metricsA?.dominantShotSize ?? "—"}</td>
                <td className="row-val val-b">{metricsB?.dominantShotSize ?? "—"}</td>
              </tr>
              <tr>
                <td className="row-label">Dominant audio stem</td>
                <td className="row-val val-a">{metricsA?.dominantAudioStem ?? "—"}</td>
                <td className="row-val val-b">{metricsB?.dominantAudioStem ?? "—"}</td>
              </tr>
              <tr>
                <td className="row-label">Integrated loudness</td>
                <td className="row-val val-a">{formatLoudness(metricsA?.avgLoudnessLUFS)}</td>
                <td className="row-val val-b">{formatLoudness(metricsB?.avgLoudnessLUFS)}</td>
              </tr>
              <tr>
                <td className="row-label">Dynamic range (LRA)</td>
                <td className="row-val val-a">{formatDynamicRange(metricsA?.dynamicRangeLU)}</td>
                <td className="row-val val-b">{formatDynamicRange(metricsB?.dynamicRangeLU)}</td>
              </tr>
              <tr>
                <td className="row-label">Color tone & mood</td>
                <td className="row-val val-a">
                  {formatMood(metricsA?.dominantMood, metricsA?.colorTemperature)}
                </td>
                <td className="row-val val-b">
                  {formatMood(metricsB?.dominantMood, metricsB?.colorTemperature)}
                </td>
              </tr>
              <tr>
                <td className="row-label">Active cast count</td>
                <td className="row-val val-a">
                  {metricsA?.castCount !== null && metricsA?.castCount !== undefined
                    ? `${metricsA.castCount} character${metricsA.castCount === 1 ? "" : "s"}${
                        castReviewA ? ` (${castReviewA})` : ""
                      }`
                    : "—"}
                </td>
                <td className="row-val val-b">
                  {metricsB?.castCount !== null && metricsB?.castCount !== undefined
                    ? `${metricsB.castCount} character${metricsB.castCount === 1 ? "" : "s"}${
                        castReviewB ? ` (${castReviewB})` : ""
                      }`
                    : "—"}
                </td>
              </tr>
              <tr>
                <td className="row-label">Lead screen presence</td>
                <td className="row-val val-a">{formatLeadingChar(metricsA?.leadingCharacter)}</td>
                <td className="row-val val-b">{formatLeadingChar(metricsB?.leadingCharacter)}</td>
              </tr>
            </tbody>
          </table>
        </div>
      </div>

      <div className="compare-overview-footer-note">
        All headline measurements in one place. Real project data.
      </div>
    </div>
  );
}
