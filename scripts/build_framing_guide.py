import json,html
from pathlib import Path
root=Path('benchmark/blind');refs=json.loads(Path('/Users/indievision/Downloads/editmap-blind-review.json').read_text())['referenceLabels'];preds={r['index']:r for r in json.loads((root/'predictions.json').read_text())['results']}
base='https://www.studiobinder.com/camera-shots/shot-size/'
sources={'MS':base+'medium-shot/','MCU':base+'medium-close-up-shot/','CU':base+'close-up-shot/','MFS':base+'medium-full-shot/','FS':base+'full-shot/','WS':base+'wide-shot/','composition':'https://www.studiobinder.com/blog/rules-of-shot-composition-in-film/','MovieShots':'https://movienet.github.io/projects/eccv20shot.html'}
cases=[
(11,'Subject selection','Object close-up; exact size uncertain','The primary object is a burning photograph held in a hand. The person printed inside it is a nested image, not necessarily the subject whose body crop should determine this shot’s size. MS may describe the printed figure, but not the photographed object. ECS is also debatable because we see much of the photograph and its surroundings.','Choose the primary subject before assigning distance. A face in a photograph is not automatically a person-composition label.'),
(73,'Likely model error','WS / LS','A small full-body figure stands against a large building frontage. Architecture occupies most of the frame. Qwen’s CS is not supported by the visible subject scale; the original LS reference is well supported.','Being able to see a person does not make the image close. Compare their scale with the whole frame.'),
(149,'Missing category','MCU, near CU boundary','The frame includes the head, shoulders and upper chest, without the waist. MCU is a useful candidate absent from the benchmark’s five choices. Neither a strict waist-up MS nor a face-dominant CU is a perfect description.','Keep MCU available; do not force every chest-up portrait into a five-class benchmark label.'),
(201,'Occlusion / environment','Wide environmental framing; uncertain subject scale','A seated figure bends over a desk in a room. Darkness and furniture hide body landmarks. Missing legs through occlusion are not the same as a frame cutting a standing subject at the waist. Neither FS nor MS can be settled by visible-body rules alone here.','Separate occlusion from cropping. Review the shot over time before giving a whole-shot label.'),
(209,'Subject selection','Wide view of display cases; object content','Three display cases and pavement are shown. If the subject is the storefront display, this is a broad view; if an individual ornament is intended, no single one is clearly isolated. Object content does not itself imply close-up.','Record the selected subject: entire display versus one object. Do not use an object category as a distance measurement.'),
(281,'Missing category / grouping','Medium-full group framing','The prominent walkers are framed down toward thighs or knees; their feet are cropped. A group does not imply FS. MovieShots includes knee-up framing in MS, whereas a detailed scheme can call this MFS.','This can be MS in the dataset taxonomy and MFS in an editorial vocabulary without either being a visual error.'),
(527,'Applicability policy','Architectural detail; size unresolved','Graffiti appears on a wall rather than on a standalone title card. Text within a photographed scene should not automatically receive the title-card exemption. LS is not clearly established either: the shot isolates a wall section without a clear distance reference.','Distinguish text as scene content from a title card. Reserve Not applicable for a declared policy, not uncertainty.'),
(623,'Reflection / ambiguity','Layered reflected figure; uncertain','Reflections, objects and a car overlap the visible person. The visible extent suggests a broader body view than an uncomplicated head-and-shoulders CS, but identifying the main subject and lower crop is difficult. A confident FS also overstates what this frame establishes.','Flag reflection/occlusion and inspect neighboring frames. Do not count reflected or printed people mechanically.')]
intro='''# EDITMAP framing reference and disagreement audit

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
'''
md=intro+'\n## Eight-frame audit\n'
parts=['<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width"><title>EDITMAP / Framing guide and audit</title><style>body{background:#141618;color:#dce0e2;font:16px system-ui;margin:28px;line-height:1.6}main{max-width:1200px;margin:auto}h1{font-size:28px}h2{font-size:22px}a{color:#b8cfdb}p{max-width:1000px}.grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(330px,1fr));gap:22px}article{background:#202528;border:1px solid #3b454d;padding:18px}img{width:100%;height:auto}small{color:#c8b27e}summary{cursor:pointer;color:#c8b27e}.definitions{display:flex;flex-wrap:wrap;gap:12px}.definitions a{padding:8px 12px;border:1px solid #45525b}nav{display:flex;gap:16px;flex-wrap:wrap}</style><main><h1>EDITMAP / Framing reference & audit</h1><p>Eight existing disagreements, examined against cinematography references. These are assistant interpretations, not replacement labels. No scores or saved tags have been changed.</p><nav><a href="#reference">Reference vocabulary</a><a href="#audit">Visual audit</a><a href="../../docs/framing-guide.md">Full written guide</a></nav><h2 id="reference">Separate size, grouping and composition</h2><p>MS: waist-up. MCU: chest-up. MFS: roughly knees-up. FS: whole body. WS/LS: broad environmental framing. Use these as a declared convention, allowing borderline cases. Single/two/group describe subject grouping; composition also concerns placement, balance, depth and negative space.</p><div class="definitions">']
for label,url in sources.items():parts.append(f'<a href="{url}" target="_blank" rel="noreferrer">{label} · illustrated reference ↗</a>')
parts.append('</div><p><b>Why our benchmark was underspecified:</b> MovieShots merges knee-up and waist-up into MS, with no MCU or MFS. Our app vocabulary differs. Unknown also mixed uncertainty with cases where person grouping does not apply. These are evaluation-design issues, not proof the model is accurate.</p><h2 id="audit">Eight inspected frames</h2><div class="grid">')
for i,kind,proposed,observation,rule in cases:
 y=refs[str(i)]['size'];p=preds[i]['prediction'];md+=f'\n### Shot {i} — {kind}\n\n![Shot {i}](../benchmark/blind/shot-{i}.jpg)\n\nOriginal reference: {y}. Qwen: {p}. Audit interpretation: **{proposed}**.\n\n{observation}\n\nWorking rule: {rule}\n';parts.append(f'<article><img src="blind/shot-{i}.jpg" alt="Shot {i}" loading="lazy"><small>{html.escape(kind)}</small><h2>Shot {i}</h2><p>Original reference: <b>{y}</b> · Qwen: <b>{p}</b></p><p><b>Audit: {html.escape(proposed)}</b></p><p>{html.escape(observation)}</p><details><summary>Working annotation rule</summary><p>{html.escape(rule)}</p></details></article>')
parts.append('</div><h2>What should change next</h2><p>Adopt one explicit size vocabulary including MCU and MFS; rename person-count composition to subject grouping; separate non-applicable from unknown; record the chosen subject and occlusion before inferring size. A moving shot may need multiple frame labels. These are proposed changes, not yet applied to the app.</p><p>This audit is selected and qualitative. It does not establish revised accuracy or justify altering your references. The exact source images remain local.</p></main></html>')
Path('docs/framing-guide.md').write_text(md);Path('benchmark/framing-guide.html').write_text(''.join(parts))
