"""One bounded worker for local speech scans; media is streamed to FFmpeg, not held in RAM."""
import os, shutil, tempfile, uuid, time
from concurrent.futures import ThreadPoolExecutor
from threading import Event, Lock
from fastapi import HTTPException

class SpeechJobs:
    def __init__(self, engine):
        self.engine = engine; self.executor = ThreadPoolExecutor(max_workers=1, thread_name_prefix="editmap-speech"); self.lock = Lock(); self.jobs = {}
    def start(self, source, job_id=None):
        job_id = job_id or str(uuid.uuid4())
        with self.lock:
            if job_id in self.jobs: return {"jobId": job_id}
            if any(job["status"] in ("uploading", "running", "cancelling") for job in self.jobs.values()): raise HTTPException(409, "Speech analysis is busy; cancel or wait for the current job.")
            while len(self.jobs) >= 8: del self.jobs[next(iter(self.jobs))]
            self.jobs[job_id] = {"status": "uploading", "progress": 0, "phase": "uploading", "cancel": Event(), "started": time.monotonic()}
        directory = tempfile.mkdtemp(prefix="editmap_speech_"); path = os.path.join(directory, "media")
        try:
            size = 0
            with open(path, "wb") as output:
                while block := source.read(1024 * 1024):
                    size += len(block)
                    if size > 8 * 1024**3: raise HTTPException(413, "Media exceeds the 8 GB local upload limit.")
                    output.write(block)
            with self.lock:
                if self.jobs[job_id]["cancel"].is_set(): self.jobs[job_id]["status"] = "cancelled"; shutil.rmtree(directory, ignore_errors=True); return {"jobId": job_id}
                self.jobs[job_id].update(status="running", phase="provisioning")
            self.executor.submit(self._run, job_id, path, directory)
        except Exception:
            shutil.rmtree(directory, ignore_errors=True)
            with self.lock: self.jobs[job_id].update(status="failed")
            raise
        return {"jobId": job_id}
    def _run(self, job_id, path, directory):
        job = self.jobs[job_id]
        def progress(phase, value, _text, elapsed=None, eta=None):
            with self.lock: job.update(phase=phase, progress=value, elapsedSeconds=elapsed or time.monotonic()-job["started"], etaSeconds=eta)
        try:
            result = self.engine.scan(path, job["cancel"], progress)
            # Report the user-visible end-to-end time: bounded local copy, decode, inference, and result creation.
            result["processingSeconds"] = time.monotonic() - job["started"]
            with self.lock: job.update(status="cancelled" if job["cancel"].is_set() else "complete", progress=1, phase="complete", result=result, elapsedSeconds=time.monotonic()-job["started"])
        except Exception as error:
            with self.lock: job.update(status="cancelled" if job["cancel"].is_set() else "failed", error=str(error), elapsedSeconds=time.monotonic()-job["started"])
        finally: shutil.rmtree(directory, ignore_errors=True)
    def status(self, job_id):
        with self.lock:
            job = self.jobs.get(job_id)
            if not job: raise HTTPException(404, "Speech job not found.")
            return {key:value for key,value in job.items() if key not in ("cancel", "started")}
    def cancel(self, job_id):
        with self.lock:
            job = self.jobs.get(job_id)
            if not job: raise HTTPException(404, "Speech job not found.")
            if job["status"] in ("uploading", "running", "cancelling"): job["cancel"].set(); job["status"]="cancelling"
            return {"status": job["status"]}
