export type StructureVocabularyId =
  | "freeform"
  | "shortform"
  | "short-form"
  | "syd-field"
  | "save-the-cat"
  | "vogler";

export interface StructureVocabulary {
  readonly id: StructureVocabularyId;
  readonly label: string;
  readonly name: string;
  readonly description?: string;
  readonly beats: readonly string[];
}

export const STRUCTURE_VOCABULARIES: readonly StructureVocabulary[] = [
  {
    id: "freeform",
    label: "Freeform / Custom",
    name: "Freeform / Custom",
    description: "Flexible user-defined labels and unlabelled beats.",
    beats: [],
  },
  {
    id: "short-form",
    label: "Short-form essentials · EditMap",
    name: "Short-form essentials · EditMap",
    description: "Optional EditMap vocabulary, not an established named theory or a mandatory short-film structure.",
    beats: [
      "Hook",
      "Situation",
      "Disruption",
      "Response",
      "Turn / Escalation",
      "Payoff / Button",
      "Aftermath",
    ],
  },
  {
    id: "syd-field",
    label: "Syd Field · Three-act paradigm",
    name: "Syd Field · Three-act paradigm",
    description: "Classic three-act paradigm for narrative feature films.",
    beats: [
      "Setup",
      "Inciting incident",
      "Plot point 1",
      "Confrontation",
      "Midpoint",
      "Plot point 2",
      "Climax",
      "Resolution",
    ],
  },
  {
    id: "save-the-cat",
    label: "Save the Cat! · 15 beats",
    name: "Save the Cat! · 15 beats",
    description: "Blake Snyder's 15-beat narrative beat sheet.",
    beats: [
      "Opening image",
      "Theme stated",
      "Setup",
      "Catalyst",
      "Debate",
      "Break into two",
      "B story",
      "Fun and games",
      "Midpoint",
      "Bad guys close in",
      "All is lost",
      "Dark night of the soul",
      "Break into three",
      "Finale",
      "Final image",
    ],
  },
  {
    id: "vogler",
    label: "Vogler · Hero’s Journey",
    name: "Vogler · Hero’s Journey",
    description: "Christopher Vogler's 12-stage mythical hero's journey.",
    beats: [
      "Ordinary world",
      "Call to adventure",
      "Refusal of the call",
      "Meeting the mentor",
      "Crossing the first threshold",
      "Tests, allies, enemies",
      "Approach to the inmost cave",
      "Ordeal",
      "Reward",
      "The road back",
      "Resurrection",
      "Return with the elixir",
    ],
  },
] as const;

export function isValidVocabularyId(id: unknown): id is StructureVocabularyId {
  return typeof id === "string" && (id === "shortform" || STRUCTURE_VOCABULARIES.some((v) => v.id === id));
}

export function getVocabulary(id?: string): StructureVocabulary {
  if (!id) return STRUCTURE_VOCABULARIES[0];
  const normalized = id === "shortform" ? "short-form" : id;
  const found = STRUCTURE_VOCABULARIES.find((v) => v.id === normalized);
  return found ?? STRUCTURE_VOCABULARIES[0];
}

/**
 * Builds the complete list of beat choices for the dropdown.
 * Always includes:
 * 1. "No label"
 * 2. Vocabulary's standard beats
 * 3. Project's custom reusable beats (if not already included)
 * 4. The entry's currently stored beat if outside the current vocabulary (ensures non-destructive display)
 * 5. "Custom label…"
 */
export function getSelectableBeats(
  vocabOrId: StructureVocabulary | StructureVocabularyId,
  customBeats: string[] = [],
  currentBeat?: string,
): string[] {
  const vocab = typeof vocabOrId === "string" ? getVocabulary(vocabOrId) : vocabOrId;
  const result: string[] = ["No label"];
  const seen = new Set<string>(["No label"]);

  // Standard beats from vocabulary
  for (const b of vocab.beats) {
    if (!seen.has(b)) {
      seen.add(b);
      result.push(b);
    }
  }

  // Project custom reusable beats
  for (const b of customBeats) {
    const trimmed = b.trim();
    if (trimmed && !seen.has(trimmed)) {
      seen.add(trimmed);
      result.push(trimmed);
    }
  }

  // Current beat if outside current vocabulary / custom list
  if (currentBeat) {
    const trimmed = currentBeat.trim();
    if (trimmed && !seen.has(trimmed)) {
      seen.add(trimmed);
      result.push(trimmed);
    }
  }

  result.push("Custom…");
  return result;
}
