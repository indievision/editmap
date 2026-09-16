"""One bounded local DME worker; completed jobs retain only waveform bins."""
import os
import shutil
import tempfile
import uuid
from concurrent.futures import ThreadPoolExecutor
from threading import Event, Lock
from fastapi import HTTPException

class DmeJobs:
    def __init__(self, separator):
        self.separator = separator
        self.executor = ThreadPoolExecutor(max_workers=1, thread_name_prefix="editmap-dme")
        self.lock = Lock()
        self.jobs = {}

    def start(self, source, bin_count, job_id=None):
        job_id = job_id or str(uuid.uuid4())
        with self.lock:
            if job_id in self.jobs:
                # Idempotent submission, including cancellation before upload completes.
                return {"jobId": job_id}
            if any(j["status"] in ("uploading", "running", "cancelling") for j in self.jobs.values()):
                raise HTTPException(409, "DME engine is busy; cancel or wait for the current job.")
            # Bound retained job metadata/results.
            while len(self.jobs) >= 8:
                del self.jobs[next(iter(self.jobs))]
            self.jobs[job_id] = {"status": "uploading", "progress": 0, "cancel": Event()}
        directory = tempfile.mkdtemp(prefix="editmap_dme_")
        path = os.path.join(directory, "media")
        try:
            size = 0
            with open(path, "wb") as output:
                while block := source.read(1024 * 1024):
                    size += len(block)
                    if size > 8 * 1024**3:
                        raise HTTPException(413, "Media exceeds the 8 GB local upload limit.")
                    output.write(block)
            with self.lock:
                self.jobs[job_id]["status"] = "running"
            self.executor.submit(self._run, job_id, path, directory, bin_count)
        except Exception:
            shutil.rmtree(directory, ignore_errors=True)
            with self.lock:
                self.jobs[job_id]["status"] = "failed"
            raise
        return {"jobId": job_id}

    def _run(self, job_id, path, directory, bin_count):
        job = self.jobs[job_id]
        def progress(value):
            with self.lock:
                job["progress"] = value
        try:
            result = self.separator.separate(path, bin_count=bin_count, cancel_event=job["cancel"], on_progress=progress)
            with self.lock:
                if job["cancel"].is_set():
                    job["status"] = "cancelled"
                else:
                    job.update(status="complete", result=result, progress=1)
        except Exception as error:
            with self.lock:
                job.update(status="cancelled" if job["cancel"].is_set() else "failed", error=str(error))
        finally:
            shutil.rmtree(directory, ignore_errors=True)

    def status(self, job_id):
        with self.lock:
            job = self.jobs.get(job_id)
            if job is None:
                raise HTTPException(404, "DME job not found.")
            return {k: v for k, v in job.items() if k != "cancel"}

    def cancel(self, job_id):
        with self.lock:
            job = self.jobs.get(job_id)
            if job is None:
                # Keep a bounded tombstone when cancellation races with upload parsing.
                if len(self.jobs) >= 8:
                    removable = next((key for key, value in self.jobs.items() if value["status"] not in ("uploading", "running", "cancelling")), None)
                    if removable: del self.jobs[removable]
                    else: raise HTTPException(409, "DME engine is busy.")
                self.jobs[job_id] = {"status": "cancelled", "progress": 0, "cancel": Event()}
                return {"status": "cancelled"}
            if job["status"] in ("uploading", "running", "cancelling"):
                job["cancel"].set()
                job["status"] = "cancelling"
            return {"status": job["status"]}
