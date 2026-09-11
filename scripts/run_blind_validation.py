import base64,json,time,urllib.request,io
from pathlib import Path
from PIL import Image
root=Path('benchmark/blind'); manifest=json.loads((root/'manifest.json').read_text())
prompt=manifest['frozenPrompt']
results=[]
for row in manifest['shots']:
 start=time.perf_counter()
 image_bytes=(root/row['image']).read_bytes()
 import hashlib
 assert hashlib.sha256(image_bytes).hexdigest()==row['sha256']
 payload={'model':manifest['model'],'stream':False,'think':False,'format':{'type':'object','properties':{'scale':{'type':'string','enum':['ECS','CS','MS','FS','LS','Unknown','Not applicable']},'uncertain':{'type':'boolean'},'composition':{'type':'string','enum':['Single person','Two-shot','Group','Unknown']},'content':{'type':'string','enum':['People','Object / detail','Text / title card','Other','Unknown']}},'required':['scale','content','composition','uncertain']},'options':manifest['options'],'messages':[{'role':'user','content':prompt,'images':[base64.b64encode(image_bytes).decode()]}]}
 req=urllib.request.Request('http://127.0.0.1:11434/api/chat',data=json.dumps(payload).encode(),headers={'Content-Type':'application/json'})
 with urllib.request.urlopen(req,timeout=300) as response: out=json.load(response)
 (root/'last-response.json').write_text(json.dumps(out,indent=2))
 answer=out['message']['content'] or out['message'].get('thinking','')
 parsed=json.loads(answer);assert parsed.get('scale') in ['ECS','CS','MS','FS','LS','Unknown','Not applicable'],parsed
 results.append({'index':row['index'],'prediction':parsed['scale'],'content':parsed.get('content'),'composition':parsed.get('composition'),'uncertain':parsed.get('uncertain'),'seconds':time.perf_counter()-start,'loadSeconds':out.get('load_duration',0)/1e9,'raw':answer,'responseField':'content' if out['message']['content'] else 'thinking'})
 (root/'predictions.json').write_text(json.dumps({'model':manifest['model'],'prompt':prompt,'method':'frozen blind validation; original image bytes; no human labels in inference','results':results},indent=2))
 print(f'{len(results)}/40 shot {row["index"]}: {parsed} {results[-1]["seconds"]:.1f}s',flush=True)
