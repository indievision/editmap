"""Measure current local CV inference without modifying reference labels or older results."""
import argparse
import base64
import json
from pathlib import Path
import statistics
import time
import urllib.request

parser = argparse.ArgumentParser()
parser.add_argument('--url', default='http://127.0.0.1:5179')
parser.add_argument('--manifest', default='benchmark/blind/manifest.json')
parser.add_argument('--output', default='benchmark/cv-audit-2026-09-12.json')
args = parser.parse_args()
manifest = Path(args.manifest)
token = json.load(urllib.request.urlopen(args.url + '/api/session'))['token']
results = []
for shot in json.loads(manifest.read_text())['shots']:
    image = base64.b64encode((manifest.parent / shot['image']).read_bytes()).decode()
    request = urllib.request.Request(args.url + '/api/analyze-shot', data=json.dumps({'image': image}).encode(), headers={'Content-Type': 'application/json', 'X-Editmap-Token': token})
    started = time.perf_counter()
    try:
        prediction = json.load(urllib.request.urlopen(request, timeout=120))
        results.append({'index': shot['index'], 'prediction': prediction, 'seconds': time.perf_counter() - started})
    except Exception as error:
        results.append({'index': shot['index'], 'error': str(error), 'seconds': time.perf_counter() - started})
summary = {'manifest': str(manifest), 'count': len(results), 'failures': sum('error' in r for r in results), 'medianSeconds': statistics.median(r['seconds'] for r in results), 'totalSeconds': sum(r['seconds'] for r in results), 'accuracy': 'Not scored: per-frame human labels were not provided to this run.', 'results': results}
Path(args.output).write_text(json.dumps(summary, indent=2))
print(json.dumps({k:v for k,v in summary.items() if k != 'results'}))
