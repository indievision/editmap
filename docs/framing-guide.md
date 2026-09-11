# EDITMAP framing reference and disagreement audit

This is a sourced working guide plus an assistant visual audit of eight selected disagreements. It is not a new ground-truth dataset, an exhaustive audit, or a rescore. Original human labels and raw predictions remain unchanged. Interpretations below concern the exact reviewed frames, not whole moving shots.

## What the references establish

| Field | Working convention | Source |
|---|---|---|
| MS | Around waist-up | [Medium shot](https://www.studiobinder.com/camera-shots/shot-size/medium-shot/) |
| MCU | Around chest-up; distinct from MS | [Medium close-up](https://www.studiobinder.com/camera-shots/shot-size/medium-close-up-shot/) |
| CU | Face or selected subject detail dominates | [Close-up](https://www.studiobinder.com/camera-shots/shot-size/close-up-shot/) |
| MFS | Intermediate body framing, around knees upward | [Medium-full](https://www.studiobinder.com/camera-shots/shot-size/medium-full-shot/) |
| FS | Whole body; overlaps wide framing but emphasizes the subject | [Full shot](https://www.studiobinder.com/camera-shots/shot-size/full-shot/) |
| WS / LS | Broad subject-environment relationship | [Wide shot](https://www.studiobinder.com/camera-shots/shot-size/wide-shot/) |
| Composition | Arrangement of visual elements, not just person count | [Composition](https://www.studiobinder.com/blog/rules-of-shot-composition-in-film/) |

Terminology has overlapping boundaries. These are a chosen convention, not universal pixel thresholds. Single/two/group should be named **subject grouping** in EDITMAP; composition can additionally describe placement, balance, negative space, layers and relationships.

## Dataset labels are not the app vocabulary

[MovieShots](https://movienet.github.io/projects/eccv20shot.html) defines five scale categories and includes both knee-up and waist-up views in MS. It has no separate MCU or MFS. Its CS refers to a small subject such as a face or hand; ECS refers to smaller parts. The benchmark borrowed these labels, while our app and explanations used a more detailed convention. Do not mechanically map a dataset MS to one precise editorial size. Use CU/ECU in the interface; retain CS/ECS only as named dataset codes, since abbreviations can vary.

## Proposed annotation order

1. Identify the primary visual subject: person, group, object, environment, title card, or genuinely ambiguous.
2. Note what is actually cropped by the frame versus hidden by objects, darkness or reflections.
3. Assign size using the chosen vocabulary. Use Unknown when evidence is insufficient; use Not applicable only for an explicit exemption such as a standalone text card.
4. Assign subject grouping separately. For non-person subjects, distinguish Not applicable from Unknown in a future schema revision.
5. Record composition observations separately: foreground/background layers, off-center placement, negative space, reflection. They do not dictate size automatically.
6. For a moving shot, inspect multiple moments and record a change or range when framing changes. A midpoint-only test evaluates frames, not full shots.

## Audit limitations and next implementation decisions

The old numbers measure reference agreement under the old choices; they are not corrected by this document. Missing MCU/MFS can explain some mismatches, not all. Shot 73 remains a clear failure. Do not tune labels simply to improve scores. No new model run is warranted until vocabulary, subject-selection rules and frame-versus-shot scope are fixed. Existing reviewed samples are now development material; future generalization checks need another film and independently labeled examples.

## Eight-frame audit

### Shot 11 — Subject selection

![Shot 11](../benchmark/blind/shot-11.jpg)

Original reference: ECS. Qwen: MS. Audit interpretation: **Object close-up; exact size uncertain**.

The primary object is a burning photograph held in a hand. The person printed inside it is a nested image, not necessarily the subject whose body crop should determine this shot’s size. MS may describe the printed figure, but not the photographed object. ECS is also debatable because we see much of the photograph and its surroundings.

Working rule: Choose the primary subject before assigning distance. A face in a photograph is not automatically a person-composition label.

### Shot 73 — Likely model error

![Shot 73](../benchmark/blind/shot-73.jpg)

Original reference: LS. Qwen: CS. Audit interpretation: **WS / LS**.

A small full-body figure stands against a large building frontage. Architecture occupies most of the frame. Qwen’s CS is not supported by the visible subject scale; the original LS reference is well supported.

Working rule: Being able to see a person does not make the image close. Compare their scale with the whole frame.

### Shot 149 — Missing category

![Shot 149](../benchmark/blind/shot-149.jpg)

Original reference: MS. Qwen: CS. Audit interpretation: **MCU, near CU boundary**.

The frame includes the head, shoulders and upper chest, without the waist. MCU is a useful candidate absent from the benchmark’s five choices. Neither a strict waist-up MS nor a face-dominant CU is a perfect description.

Working rule: Keep MCU available; do not force every chest-up portrait into a five-class benchmark label.

### Shot 201 — Occlusion / environment

![Shot 201](../benchmark/blind/shot-201.jpg)

Original reference: FS. Qwen: MS. Audit interpretation: **Wide environmental framing; uncertain subject scale**.

A seated figure bends over a desk in a room. Darkness and furniture hide body landmarks. Missing legs through occlusion are not the same as a frame cutting a standing subject at the waist. Neither FS nor MS can be settled by visible-body rules alone here.

Working rule: Separate occlusion from cropping. Review the shot over time before giving a whole-shot label.

### Shot 209 — Subject selection

![Shot 209](../benchmark/blind/shot-209.jpg)

Original reference: CS. Qwen: LS. Audit interpretation: **Wide view of display cases; object content**.

Three display cases and pavement are shown. If the subject is the storefront display, this is a broad view; if an individual ornament is intended, no single one is clearly isolated. Object content does not itself imply close-up.

Working rule: Record the selected subject: entire display versus one object. Do not use an object category as a distance measurement.

### Shot 281 — Missing category / grouping

![Shot 281](../benchmark/blind/shot-281.jpg)

Original reference: FS. Qwen: MS. Audit interpretation: **Medium-full group framing**.

The prominent walkers are framed down toward thighs or knees; their feet are cropped. A group does not imply FS. MovieShots includes knee-up framing in MS, whereas a detailed scheme can call this MFS.

Working rule: This can be MS in the dataset taxonomy and MFS in an editorial vocabulary without either being a visual error.

### Shot 527 — Applicability policy

![Shot 527](../benchmark/blind/shot-527.jpg)

Original reference: Not applicable. Qwen: LS. Audit interpretation: **Architectural detail; size unresolved**.

Graffiti appears on a wall rather than on a standalone title card. Text within a photographed scene should not automatically receive the title-card exemption. LS is not clearly established either: the shot isolates a wall section without a clear distance reference.

Working rule: Distinguish text as scene content from a title card. Reserve Not applicable for a declared policy, not uncertainty.

### Shot 623 — Reflection / ambiguity

![Shot 623](../benchmark/blind/shot-623.jpg)

Original reference: FS. Qwen: CS. Audit interpretation: **Layered reflected figure; uncertain**.

Reflections, objects and a car overlap the visible person. The visible extent suggests a broader body view than an uncomplicated head-and-shoulders CS, but identifying the main subject and lower crop is difficult. A confident FS also overstates what this frame establishes.

Working rule: Flag reflection/occlusion and inspect neighboring frames. Do not count reflected or printed people mechanically.
