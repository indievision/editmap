import json,statistics,html
from pathlib import Path
root=Path('benchmark/blind');review=json.loads(Path('/Users/indievision/Downloads/editmap-blind-review.json').read_text());manifest=json.loads((root/'manifest.json').read_text());data=json.loads((root/'predictions.json').read_text());refs=review['referenceLabels'];assert review['shots']==manifest['shots'];assert len(data['results'])==40;assert {r['index'] for r in data['results']}=={s['index'] for s in manifest['shots']};assert all(refs[str(r['index'])]['confirmed'] for r in data['results'])
fields={'size':'prediction','composition':'composition','content':'content'};summary={'count':40,'fields':{},'humanUncertain':sum(r['uncertain'] for r in refs.values()),'modelUncertain':sum(r['uncertain'] for r in data['results']),'medianSeconds':statistics.median(r['seconds'] for r in data['results'])}
for f,k in fields.items():
 matrix={}
 for r in data['results']:
  y=refs[str(r['index'])][f];matrix.setdefault(y,{});matrix[y][r[k]]=matrix[y].get(r[k],0)+1
 summary['fields'][f]={'correct':sum(r[k]==refs[str(r['index'])][f] for r in data['results']),'confusion':matrix}
summary['normalizedSizeCorrect']=sum(('Not applicable' if r['content']=='Text / title card' else r['prediction'])==refs[str(r['index'])]['size'] for r in data['results'])
summary['allFieldsCorrect']=sum(all(r[k]==refs[str(r['index'])][f] for f,k in fields.items()) for r in data['results'])
(root/'summary.json').write_text(json.dumps(summary,indent=2));print(json.dumps(summary,indent=2))
parts=['<!doctype html><html lang="en"><meta charset="utf-8"><title>EDITMAP blind validation results</title><style>body{background:#141618;color:#dce0e2;font:15px system-ui;margin:24px}p{max-width:1050px;line-height:1.6}table{border-collapse:collapse;width:100%}td,th{border-bottom:1px solid #394147;text-align:left;padding:12px}img{width:180px;height:auto}.no{color:#e6a99c}.yes{color:#a4c7aa}</style><h1>EDITMAP / Blind validation results</h1>']
parts.append('<p>'+ ' · '.join(f'{f}: {v["correct"]}/40 ({v["correct"]/40*100:.1f}%)' for f,v in summary['fields'].items())+'</p>')
parts.append('<p>40 previously unreviewed shots from the same film. All references confirmed before inference. Frozen prompt and exact image bytes; labels were not sent to the model. Unknown and uncertain cases are included. This measures agreement with one reviewer, not general accuracy across films. Raw predictions are shown below; text-card normalization is scored separately.</p>')
parts.append(f'<p>Text-rule-normalized size: {summary["normalizedSizeCorrect"]}/40. All three raw fields match: {summary["allFieldsCorrect"]}/40. Human uncertain: {summary["humanUncertain"]}; model uncertain: {summary["modelUncertain"]}. Median request: {summary["medianSeconds"]:.2f}s.</p><table><tr><th>Shot</th><th>Frame</th><th>Your size / composition / content</th><th>Qwen size / composition / content</th></tr>')
for r in data['results']:
 i=r['index'];y=refs[str(i)];user=' / '.join(html.escape(y[f]) for f in fields);pred=' / '.join(f'<span class="{"yes" if r[k]==y[f] else "no"}">{html.escape(str(r[k]))}</span>' for f,k in fields.items());parts.append(f'<tr><td>{i}</td><td><img src="shot-{i}.jpg" alt="Shot {i}"></td><td>{user}</td><td>{pred}</td></tr>')
parts.append('</table></html>');(root/'results.html').write_text(''.join(parts))
