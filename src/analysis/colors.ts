import type { Shot, ShotSize } from "../models/project";
export const sizeColors: Record<ShotSize, string> = {
  EWS: "#4a7cc2",
  WS: "#4fabc5",
  FS: "#5aaf96",
  AS: "#8caf78",
  MS: "#b9b65f",
  MCU: "#d7a05b",
  CU: "#cd7652",
  ECU: "#ba5458",
  MWS: "#5aaf96",
  Insert: "#9182ad",
  OTS: "#869b9d",
  POV: "#ac9b88",
  "Not applicable": "#777b85",
  Unknown: "#626970",
};
interface ColorMapping {
  label: string;
  color: (shot: Shot) => string;
}
export const colorMappings: Record<string, ColorMapping> = {
  shotSize: { label: "Shot size", color: (s) => sizeColors[s.shotSize] },
  palette: {
    label: "Footage Palette",
    color: (s) => s.colorProfile?.palette?.[0] || sizeColors[s.shotSize] || "#626970",
  },
};
