import base64,json,time,urllib.request,io
from pathlib import Path
from PIL import Image
root=Path('benchmark'); reviewed=json.loads(Path('/Users/indievision/Downloads/editmap-model-review.json').read_text())
# Predictions are generated independently: human labels are only used for scoring afterwards.
prompt='''Classify this cinematic frame using independent fields. Size measures the main subject framing, not number of people. ECS: a small face part or tiny subject detail fills the frame. CS: head and shoulders framing. MS: substantial torso visible, body cropped; includes seated groups with cropped bodies. FS: main subject essentially head to toe and prominent, including bent legs when seated. LS: environment dominates and people are relatively small. Several people do NOT automatically mean FS. Empty space alone does NOT make a close subject LS. If no dominant subject can be determined, use Unknown and uncertain=true. Separate composition: Single person, Two-shot, Group, Unknown. Separate content: People, Object / detail, Text / title card, Other, Unknown. Text cards must have scale Not applicable and composition Unknown. Object detail can still have a scale; composition Unknown. Set uncertain=true for ambiguous framing, blur, competing subjects or borderline size. Judge only this frame; do not infer motion or identify people. Return JSON scale, composition, content, uncertain.''' 
results=[]
for row in reviewed['results']:
 start=time.perf_counter()
 image=Image.open(root/f'shot-{row["index"]}.jpg').resize((448,336))
 buffer=io.BytesIO();image.save(buffer,format='JPEG')
 payload={'model':'qwen3-vl:4b','stream':False,'think':False,'format':{'type':'object','properties':{'scale':{'type':'string','enum':['ECS','CS','MS','FS','LS','Unknown','Not applicable']},'uncertain':{'type':'boolean'},'composition':{'type':'string','enum':['Single person','Two-shot','Group','Unknown']},'content':{'type':'string','enum':['People','Object / detail','Text / title card','Other','Unknown']}},'required':['scale','content','composition','uncertain']},'options':{'temperature':0,'seed':42,'num_predict':512,'num_ctx':4096},'messages':[{'role':'user','content':prompt,'images':[base64.b64encode(buffer.getvalue()).decode()]}]}
 req=urllib.request.Request('http://127.0.0.1:11434/api/chat',data=json.dumps(payload).encode(),headers={'Content-Type':'application/json'})
 with urllib.request.urlopen(req,timeout=300) as response: out=json.load(response)
 (root/'qwen-v2-last-response.json').write_text(json.dumps(out,indent=2))
 answer=out['message']['content'] or out['message'].get('thinking','')
 parsed=json.loads(answer);assert parsed.get('scale') in ['ECS','CS','MS','FS','LS','Unknown','Not applicable'],parsed
 results.append({'index':row['index'],'prediction':parsed['scale'],'content':parsed.get('content'),'composition':parsed.get('composition'),'uncertain':parsed.get('uncertain'),'seconds':time.perf_counter()-start,'loadSeconds':out.get('load_duration',0)/1e9,'raw':answer,'responseField':'content' if out['message']['content'] else 'thinking'})
 (root/'qwen-v2-results.json').write_text(json.dumps({'model':'qwen3-vl:4b','prompt':prompt,'method':'same review midpoint thumbnail, restored 4:3 aspect ratio; VideoMAE used 16 frames','results':results},indent=2))
 print(f'{len(results)}/40 shot {row["index"]}: {parsed} {results[-1]["seconds"]:.1f}s',flush=True)
