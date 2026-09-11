import { memo, useState } from "react";
import type { Project, Shot } from "../models/project";
import Rhythm from "./Rhythm";
import LocalPacing from "./LocalPacing";
import FramingSummary from "./FramingSummary";
import FramingArc from "./FramingArc";
import AudiovisualRhythm from "./AudiovisualRhythm";

const EditingRhythm = memo(function EditingRhythm({
  project,
  time,
  waveform,
  selected,
  onSelect,
  onSeek,
}: {
  project: Project;
  time: number;
  waveform: number[];
  selected?: string;
  onSelect: (shot: Shot) => void;
  onSeek: (time: number) => void;
}) {
  const [tab, setTab] = useState("duration");
  return (
    <section className="editing-rhythm panel">
      <div className="rhythm-tabs" aria-label="Editing rhythm views">
        <h2>Editing rhythm</h2>
        <button
          aria-pressed={tab === "duration"}
          onClick={() => setTab("duration")}
        >
          Shot duration
        </button>
        <button
          aria-pressed={tab === "pacing"}
          onClick={() => setTab("pacing")}
        >
          Local pacing
        </button>
        <button
          aria-pressed={tab === "audiovisual"}
          onClick={() => setTab("audiovisual")}
        >
          Audiovisual
        </button>
        <button
          aria-pressed={tab === "summary"}
          onClick={() => setTab("summary")}
        >
          Framing summary
        </button>
        <button aria-pressed={tab === "arc"} onClick={() => setTab("arc")}>
          Framing arc
        </button>
      </div>
      <div hidden={tab !== "duration"}>
        <Rhythm shots={project.shots} selected={selected} onSelect={onSelect} />
      </div>
      <div hidden={tab !== "pacing"}>
        <LocalPacing project={project} time={time} onSeek={onSeek} />
      </div>
      <div hidden={tab !== "audiovisual"}>
        <AudiovisualRhythm
          project={project}
          time={time}
          waveform={waveform}
          onSeek={onSeek}
        />
      </div>
      <div hidden={tab !== "summary"}>
        <FramingSummary shots={project.shots} />
      </div>
      <div hidden={tab !== "arc"}>
        <FramingArc
          project={project}
          time={time}
          selected={selected}
          onSelect={onSelect}
        />
      </div>
    </section>
  );
});


export default EditingRhythm;
