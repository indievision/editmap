"""Local VideoMAE benchmark. No film or frames leave this machine."""
import os
os.environ['HF_HOME'] = os.path.abspath('benchmark/model-cache')
import json, time, subprocess, resource
from pathlib import Path
import numpy as np
import torch
from PIL import Image
from transformers import VideoMAEForVideoClassification, VideoMAEImageProcessor

ROOT=Path('benchmark'); ROOT.mkdir(exist_ok=True)
VIDEO=Path('FILME/how to shoot a ghost.mp4')
MODEL='gullalc/videomae-base-finetuned-kinetics-movieshots-scale'
shots=json.loads((ROOT/'shots.json').read_text())['shots']
selected=[shots[int(i)] for i in np.linspace(0,len(shots)-1,40).round().astype(int)]
print('Loading model',flush=True)
processor=VideoMAEImageProcessor.from_pretrained(MODEL, local_files_only=True)
model, loading = VideoMAEForVideoClassification.from_pretrained(MODEL, local_files_only=True, output_loading_info=True)
if loading['missing_keys'] or loading['unexpected_keys'] or loading.get('mismatched_keys'):
    raise RuntimeError(f'Checkpoint mismatch: {loading}')
model=model.eval()
device='mps' if torch.backends.mps.is_available() else 'cpu'
model=model.to(device)
print('Device:',device,'Labels:',model.config.id2label,flush=True)
results=[]
for n,shot in enumerate(selected):
    begin=time.perf_counter()
    # Decode only this shot, sampling sixteen uniformly spaced frames.
    duration=shot['duration']; rate=16/duration
    command=['ffmpeg','-v','error','-ss',str(shot['startSeconds']),'-i',str(VIDEO),'-t',str(duration),'-vf',f'fps={rate},scale=224:224','-frames:v','16','-f','rawvideo','-pix_fmt','rgb24','pipe:1']
    raw=subprocess.check_output(command)
    frames=np.frombuffer(raw,dtype=np.uint8).reshape(-1,224,224,3)
    if not len(frames): raise RuntimeError(f'No frames for shot {shot["index"]}')
    if len(frames)<16: frames=np.concatenate([frames,np.repeat(frames[-1:],16-len(frames),axis=0)])
    Image.fromarray(frames[len(frames)//2]).save(ROOT/f'shot-{shot["index"]}.jpg')
    inputs=processor(list(frames),return_tensors='pt',do_resize=False,do_center_crop=False)
    inputs={k:v.to(device) for k,v in inputs.items()}
    if device=='mps': torch.mps.synchronize()
    infer_start=time.perf_counter()
    with torch.inference_mode(): probs=model(**inputs).logits.softmax(-1)[0].cpu().numpy()
    inference=time.perf_counter()-infer_start
    row={'index':shot['index'],'start':shot['startTimecode'],'duration':duration,'prediction':model.config.id2label[int(probs.argmax())],'scores':{model.config.id2label[i]:float(p) for i,p in enumerate(probs)},'inferenceSeconds':inference,'totalSeconds':time.perf_counter()-begin}
    results.append(row)
    (ROOT/'results.json').write_text(json.dumps({'model':MODEL,'device':device,'results':results,'peakProcessMB':resource.getrusage(resource.RUSAGE_SELF).ru_maxrss/1024**2,'mpsAllocatedMB':torch.mps.current_allocated_memory()/1024**2 if device=='mps' else None},indent=2))
    print(f'{n+1}/40 shot {shot["index"]}: {row["prediction"]} ({inference:.2f}s inference, {row["totalSeconds"]:.2f}s total)',flush=True)
print('Benchmark complete',flush=True)
