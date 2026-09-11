# Implementation Prompt: Sensory Shock Index & Color Harmony Detection in EDITMAP

Copy and paste the entire prompt below into a new chat session to implement these features.

```markdown
# Objective: Implement "Sensory Shock Index" & "Color Harmony Detection" in EDITMAP

Implement two advanced cinematography and editorial analysis features in EDITMAP using zero-cost, client-side pixel extraction:
1. **Sensory Shock Index (Visual Dynamic vs. Cutting Pacing)**: Quantifies the psychological/perceptual jolt across cuts by combining cut frequency with cut-to-cut visual contrast (luminance jumps + chromatic distance).
2. **Cinematic Color Harmony Detection (e.g., Teal & Orange, Complementary, Analogous, Monochromatic)**: Classifies the color scheme of each shot based on color wheel geometry.

Both features must run locally in pure TypeScript/Canvas without requiring Ollama or external dependencies, computing pixel metrics in <1ms per frame during the existing thumbnail pass in `src/video/useThumbnails.ts`.

---

## 1. Feature Specifications & Math

### A. Color Harmony Detection
For each shot's midpoint frame:
1. Sample pixels in HSV/HSL space, filtering out near-black ($V < 0.15$) and neutral/grey pixels ($S < 0.15$) to isolate meaningful hues ($0^\circ - 360^\circ$).
2. Quantize hues into a 24-bin radial histogram ($15^\circ$ bins) and find the dominant hue peaks:
   - **Complementary / Teal & Orange**: Two prominent peaks separated by $150^\circ - 210^\circ$ (especially when one peak is cyan/teal $\approx 180^\circ - 210^\circ$ and the other is amber/orange $\approx 20^\circ - 45^\circ$).
   - **Analogous**: Dominant hues clustered within a narrow $45^\circ$ arc (harmonious, naturalistic).
   - **Monochromatic / Desaturated**: Low overall saturation ($S_{\text{avg}} < 0.2$) or all colored pixels fall within $\pm 15^\circ$.
   - **Triadic / Multi-Hue**: 3 distinct distributed hue peaks (high chromatic complexity / pop aesthetic).
   - **Neutral**: Balanced, non-stylized natural palette.

### B. Sensory Shock Index
Editorial pacing (cuts per minute) only measures *temporal* speed. A rapid montage of identical-looking shots feels smooth, whereas cutting back and forth between pitch-black and blinding white, or saturated red and cyan, produces intense sensory disruption.

1. **Cut Visual Delta ($\Delta V$)**:
   Between outgoing Shot $A$ and incoming Shot $B$:
   $$\Delta \text{Luma} = |Y_B - Y_A| \quad (0 \le \Delta \text{Luma} \le 1)$$
   $$\Delta \text{Chroma} = \text{ColorDistance}(\text{Palette}_A, \text{Palette}_B) \quad (0 \le \Delta \text{Chroma} \le 1)$$
   $$\Delta V = 0.6 \cdot \Delta \text{Luma} + 0.4 \cdot \Delta \text{Chroma}$$

2. **Sensory Shock Score**:
   Scale the visual jump inversely with shot duration (shorter shots amplify shock):
   $$\text{Shock} = \Delta V \times \min\left(2.5, \frac{2.0}{\max(0.2, \text{duration}_B)}\right)$$
   Normalized to a $0 - 100$ scale.
3. **Pacing Overlay Curve**:
   Provide a moving average curve of Sensory Shock across the film timeline, plotted alongside the cuts/min pacing curve.

---

## 2. File-by-File Implementation Plan

### 1. `src/models/project.ts`
- Define `ColorHarmony`:
  ```ts
  export type HarmonyType = "teal-orange" | "complementary" | "analogous" | "monochromatic" | "triadic" | "neutral";

  export interface ColorProfile {
    palette: string[];       // Top 3-5 hex colors
    luminance: number;     // 0.0 - 1.0 (Rec. 709)
    temperature: number;   // -1.0 (cool) to +1.0 (warm)
    saturation: number;    // 0.0 - 1.0
    harmony: {
      type: HarmonyType;
      label: string;       // e.g. "Teal & Orange", "Analogous Warm", "Monochromatic Low-Key"
      confidence: number;  // 0.0 - 1.0
      dominantHue: number; // 0 - 360 degrees
    };
  }
  ```
- Add optional `colorProfile?: ColorProfile` to `Shot`.
- Add optional `sensoryShock?: number` (0 - 100) to cut records/pairings.

### 2. `src/analysis/colorExtraction.ts` (NEW)
- Implement `extractColorProfile(ctx: CanvasRenderingContext2D, width: number, height: number): ColorProfile`:
  - Fast stride sampling (stride of 2-4 pixels for sub-millisecond execution).
  - Rec. 709 Luma calculation: $Y = 0.2126R + 0.7152G + 0.0722B$.
  - RGB to HSV conversion per sampled pixel.
  - Dominant color extraction via median-cut or fast k-means.
  - Radial hue histogram and harmony classification logic.
- Implement `calculateVisualDelta(profileA: ColorProfile, profileB: ColorProfile): number`.

### 3. `src/video/useThumbnails.ts` & `src/app/App.tsx`
- In `useThumbnails.ts`, right after drawing the midpoint frame onto the 160x90 canvas, call `extractColorProfile(context, 160, 90)`.
- Pass extracted profiles out to `App.tsx` as batch updates.
- In `App.tsx`, save profiles onto each shot in the project state and persist via IndexedDB.

### 4. `src/components/CutReading.tsx` (Cut Reading Enhancement)
- In the cut boundary inspector:
  - Display a **"Sensory Shock"** gauge ($0 - 100$, color-coded from green = smooth transition, to amber = dynamic contrast, to red = extreme visual shock).
  - Show side-by-side luminance change ($\Delta \text{Brightness}$) and color harmony continuity.

### 5. `src/components/LocalPacing.tsx` & `src/components/EditingRhythm.tsx`
- In **03 / LOCAL PACING**:
  - Add a toggle button: `[Show Sensory Shock]`.
  - When enabled, plot a purple/magenta curve representing the rolling Sensory Shock score across the timeline, overlaying the blue Cuts/Minute line and gold CU/ECU line.
  - Hovering points on the graph displays both Cuts/Min and Sensory Shock value at that second.

### 6. `src/app/App.tsx` (Shot Inspector)
- In the **Shot Inspector** panel:
  - Render the extracted palette swatches with hex copy on click.
  - Render the **Harmony Badge** (e.g. `Teal & Orange` with dual color dots, `Analogous Warm`, or `Monochromatic`).
  - Render luminance % (e.g. `Luma: 34% • Low-Key`).

---

## 3. Verification & Acceptance Criteria
1. **Performance**: Zero noticeable UI lag or video playback stutter. Extraction takes $<1$ ms per frame in the thumbnail generator.
2. **Correctness**:
   - Clean detection of classic Teal & Orange shots (e.g., cyan/teal shadows with warm skin tones).
   - High Sensory Shock correctly triggers on hard cuts between extreme dark and extreme light shots.
3. **Tests & Build**:
   - Add unit tests in `tests/colorExtraction.test.ts` validating:
     - Luma calculation on known color swatches.
     - Harmony detection on synthetic color arrays (complementary, analogous, mono).
     - Visual delta & sensory shock math.
   - Run `npm test` and `npm run build` to ensure 100% clean TypeScript build without errors.
```
