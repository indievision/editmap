import ast,hashlib,json,random,subprocess
from pathlib import Path
root=Path('benchmark/blind');root.mkdir(exist_ok=True)
shots=json.loads(Path('benchmark/shots.json').read_text())['shots'];old={r['index'] for r in json.loads(Path('benchmark/results.json').read_text())['results']}
candidates=[s for s in shots if s['index'] not in old]
rng=random.Random(20260909);chosen=sorted(rng.sample(candidates,40),key=lambda s:s['startSeconds'])
manifest={'id':'ghost-blind-20260909','seed':20260909,'method':'40 random previously unreviewed shots; frame at 8.5/16 of each shot; original aspect ratio; same image for human and future model','shots':[]}
for s in chosen:
 t=s['startSeconds']+s['duration']*8.5/16;file=root/f'shot-{s["index"]}.jpg'
 subprocess.run(['ffmpeg','-v','error','-y','-ss',str(t),'-i','FILME/how to shoot a ghost.mp4','-frames:v','1','-vf','scale=448:336',str(file)],check=True)
 manifest['shots'].append({'index':s['index'],'time':t,'start':s['startTimecode'],'duration':s['duration'],'image':file.name,'sha256':hashlib.sha256(file.read_bytes()).hexdigest()})
for node in ast.parse(Path('scripts/compare_qwen_v2.py').read_text()).body:
 if isinstance(node,ast.Assign) and any(isinstance(t,ast.Name) and t.id=='prompt' for t in node.targets):manifest['frozenPrompt']=ast.literal_eval(node.value)
manifest['model']='qwen3-vl:4b';manifest['options']={'temperature':0,'seed':42,'num_predict':512,'num_ctx':4096};(root/'manifest.json').write_text(json.dumps(manifest,indent=2))
print('Prepared 40 shots; overlap:',len({s['index'] for s in chosen}&old))
