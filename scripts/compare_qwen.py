import base64,json,time,urllib.request,io
from pathlib import Path
from PIL import Image
root=Path('benchmark'); reviewed=json.loads(Path('/Users/indievision/Downloads/editmap-model-review.json').read_text())
# Predictions are generated independently: human labels are only used for scoring afterwards.
prompt='''Classify the cinematic framing in this image. Return JSON with scale and content. Scale must be ECS (extreme close-up: only part of face or tiny detail), CS (close-up: head/shoulders), MS (medium: waist or chest upward), FS (full: entire body fills much of frame), LS (long: subject small in environment), or Unknown (cannot judge). Content must be Text (primarily title/credits/intertitle), Object (primarily an object/detail), People, or Other. For text cards set scale Unknown. Judge visible framing only, not story. Do not identify people. Return only the two fields.'''
results=[]
for row in reviewed['results']:
 start=time.perf_counter()
 image=Image.open(root/f'shot-{row["index"]}.jpg').resize((448,336))
 buffer=io.BytesIO();image.save(buffer,format='JPEG')
 payload={'model':'qwen3-vl:4b','stream':False,'think':False,'format':{'type':'object','properties':{'scale':{'type':'string','enum':['ECS','CS','MS','FS','LS','Unknown']},'content':{'type':'string','enum':['Text','Object','People','Other']}},'required':['scale','content']},'options':{'temperature':0,'seed':42,'num_predict':512,'num_ctx':4096},'messages':[{'role':'user','content':prompt,'images':[base64.b64encode(buffer.getvalue()).decode()]}]}
 req=urllib.request.Request('http://127.0.0.1:11434/api/chat',data=json.dumps(payload).encode(),headers={'Content-Type':'application/json'})
 with urllib.request.urlopen(req,timeout=300) as response: out=json.load(response)
 (root/'qwen-last-response.json').write_text(json.dumps(out,indent=2))
 answer=out['message']['content'] or out['message'].get('thinking','')
 parsed=json.loads(answer);assert parsed.get('scale') in ['ECS','CS','MS','FS','LS','Unknown'],parsed
 results.append({'index':row['index'],'prediction':parsed['scale'],'content':parsed.get('content'),'seconds':time.perf_counter()-start,'loadSeconds':out.get('load_duration',0)/1e9,'raw':answer,'responseField':'content' if out['message']['content'] else 'thinking'})
 (root/'qwen-results.json').write_text(json.dumps({'model':'qwen3-vl:4b','prompt':prompt,'method':'same review midpoint thumbnail, restored 4:3 aspect ratio; VideoMAE used 16 frames','results':results},indent=2))
 print(f'{len(results)}/40 shot {row["index"]}: {parsed} {results[-1]["seconds"]:.1f}s',flush=True)
