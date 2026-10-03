import assert from "node:assert/strict";
import test from "node:test";
import { fetchJobStatus } from "../src/analysis/jobPolling.ts";

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });

test("a transient 500 does not abandon a running job", async () => {
  const original = globalThis.fetch;
  let calls = 0;
  globalThis.fetch = (async () => (++calls === 1 ? json({ detail: "boom" }, 500) : json({ status: "running" }))) as typeof fetch;
  try {
    const job = await fetchJobStatus<{ status: string }>("/api/dme-jobs/x", "DME", new AbortController().signal);
    assert.equal(job.status, "running");
    assert.ok(calls >= 2);
  } finally {
    globalThis.fetch = original;
  }
});

test("a lost job (404) fails immediately without retrying", async () => {
  const original = globalThis.fetch;
  let calls = 0;
  globalThis.fetch = (async () => (calls++, json({ detail: "nope" }, 404))) as typeof fetch;
  try {
    await assert.rejects(fetchJobStatus("/api/dme-jobs/x", "DME", new AbortController().signal), /job was lost/);
    assert.equal(calls, 1);
  } finally {
    globalThis.fetch = original;
  }
});
