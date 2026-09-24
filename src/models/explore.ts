import type { ShotSize, peopleLabels } from "./project";

export type ArrangeMeasure =
  | "original"
  | "duration"
  | "brightness"
  | "loudness"
  | "motion";

export type ArrangeDirection = "asc" | "desc";

export interface ExploreFilters {
  characterId?: string;
  onlyThisCharacter?: boolean;
  composition?: keyof typeof peopleLabels;
  shotSize?: ShotSize;
  minDuration?: number;
  maxDuration?: number;
}

export interface ExploreArrangeConfig {
  measure: ArrangeMeasure;
  direction: ArrangeDirection;
}

export interface ExploreShotMetric {
  label: string;
  value: number | null;
  formatted: string;
}

export interface ExploreSequenceEntry {
  sequenceIndex: number; // 0-based index in the Explore sequence
  shotId: string;
  originalIndex: number; // 1-based index in the original film
  sourceStart: number;
  sourceEnd: number;
  duration: number;
  sequenceStart: number; // cumulative start time in sequence
  sequenceEnd: number;   // cumulative end time in sequence
  metric?: ExploreShotMetric;
}

export interface ExploreSequence {
  id: string;
  name: string;
  filters: ExploreFilters;
  arrange: ExploreArrangeConfig;
  entries: ExploreSequenceEntry[];
  totalDuration: number;
  excludedCount: number; // shots excluded specifically due to missing measurement
  missingMeasureReason?: string; // explanation if whole measure has no valid analysis
  createdAt: string;
}

export interface SavedExploreSequence {
  id: string;
  name: string;
  filters: ExploreFilters;
  arrange: ExploreArrangeConfig;
  shotIds: string[];
  createdAt: string;
  updatedAt: string;
}

export interface SavedExploreComparison {
  id: string;
  name: string;
  passageAId: string;
  passageBId: string;
  note?: string;
  createdAt: string;
  updatedAt: string;
}

export const DEFAULT_EXPLORE_FILTERS: ExploreFilters = {
  characterId: undefined,
  onlyThisCharacter: false,
  composition: undefined,
  shotSize: undefined,
  minDuration: undefined,
  maxDuration: undefined,
};

export const DEFAULT_EXPLORE_ARRANGE: ExploreArrangeConfig = {
  measure: "original",
  direction: "asc",
};
