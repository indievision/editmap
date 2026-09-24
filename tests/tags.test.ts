import { test } from "node:test";
import assert from "node:assert/strict";
import {
  analyzeFrames,
  analyzeFrame,
  TAG_SCHEMA,
  validateTags,
} from "../src/analysis/localModel";

test("accepts expanded subjects independently of featured people", () => {
  for (const content of [
    "Animals",
    "Landscape / nature",
    "Architecture / interiors",
  ]) {
    for (const composition of ["No people", "Two-shot"]) {
      const tags = { shotSize: "Wide", composition, content, uncertain: false };
      assert.deepEqual(validateTags(tags), tags);
    }
  }
});

test("normalizes the observed annotated person tag without accepting arbitrary categories", () => {
  const tags = {
    shotSize: "Close",
    composition: "Single person (one)",
    content: "People",
    uncertain: false,
  };
  assert.deepEqual(validateTags(tags), {
    ...tags,
    composition: "Single person",
  });
  assert.throws(() => validateTags({ ...tags, composition: "Crowd" }));
  assert.throws(() => validateTags({ ...tags, uncertain: "false" }));
  assert.throws(() => validateTags({ ...tags, shotSize: ["CU"] }));
  assert.deepEqual(validateTags({ ...tags, extra: "ignored" }), {
    ...tags,
    composition: "Single person",
  });
});

test("sends frame to analysis endpoint and handles responses", async (t) => {
  const tags = {
    shotSize: "Close",
    composition: "Single person",
    content: "People",
    uncertain: false,
  };
  t.mock.method(
    globalThis,
    "fetch",
    async (url: unknown, options: RequestInit) => {
      assert.match(String(url), /\/api\/analyze-shot/);
      const request = JSON.parse(options.body as string);
      assert.equal(request.image, "test-frame");
      assert.deepEqual(request.images, ["test-frame"]);
      return new Response(JSON.stringify(tags));
    },
  );
  assert.deepEqual(
    await analyzeFrame("test-frame", new AbortController().signal),
    tags,
  );
});

test("handles nested or thinking-field responses gracefully", async (t) => {
  const tags = {
    shotSize: "Close",
    composition: "Single person",
    content: "People",
    uncertain: false,
  };
  t.mock.method(
    globalThis,
    "fetch",
    async () => {
      return new Response(
        JSON.stringify({
          message: { content: "", thinking: JSON.stringify(tags) },
        }),
      );
    },
  );
  assert.deepEqual(
    await analyzeFrame("test-frame", new AbortController().signal),
    tags,
  );
});

test("preserves established tags and enforces text size", () => {
  const tags = {
    shotSize: "Close",
    composition: "Single person",
    content: "Object / detail",
    uncertain: false,
  };
  assert.deepEqual(validateTags(tags), tags);
  assert.equal(
    validateTags({ ...tags, content: "Text / title card" }).shotSize,
    "Not applicable",
  );
  assert.throws(() => validateTags({ ...tags, composition: "Crowd" }));
  assert.throws(() => validateTags({ ...tags, content: "Invalid" }));
});

test("retries a temporary runner failure once with the same frame", async (t) => {
  const tags = { shotSize: "Close", composition: "Single person", content: "People", uncertain: false };
  const requests: RequestInit[] = [];
  t.mock.method(globalThis, "fetch", async (_url: unknown, options: RequestInit) => {
    requests.push(options);
    return requests.length === 1
      ? new Response(JSON.stringify({ error: "runner failed" }), { status: 500 })
      : new Response(JSON.stringify({ message: { content: JSON.stringify(tags) } }));
  });
  assert.deepEqual(await analyzeFrame("frame", new AbortController().signal), tags);
  assert.equal(requests.length, 2);
  assert.equal(requests[0].body, requests[1].body);
});

test("stops after one retry and reports the actual server error", async (t) => {
  let calls = 0;
  t.mock.method(globalThis, "fetch", async () => {
    calls++;
    return new Response(JSON.stringify({ error: "runner out of memory" }), { status: 500 });
  });
  await assert.rejects(analyzeFrame("frame", new AbortController().signal), /HTTP 500.*runner out of memory/);
  assert.equal(calls, 2);
});

test("does not retry a missing model", async (t) => {
  let calls = 0;
  t.mock.method(globalThis, "fetch", async () => {
    calls++;
    return new Response(JSON.stringify({ error: "model not found" }), { status: 404 });
  });
  await assert.rejects(analyzeFrame("frame", new AbortController().signal), /model not found/);
  assert.equal(calls, 1);
});

test("selectableShotSizes exposes the active eight-rung framing taxonomy", async () => {
  const { selectableShotSizes } = await import("../src/models/project");
  assert.deepEqual(selectableShotSizes, [
    "Extreme wide",
    "Wide",
    "Full",
    "American",
    "Medium",
    "Medium close-up",
    "Close",
    "Extreme close",
    "Unknown",
  ]);
});

test("sends three interior shot samples in one framing request", async (t) => {
  const tags = { shotSize: "Medium", composition: "Single person", content: "People", uncertain: false };
  t.mock.method(globalThis, "fetch", async (_url: unknown, options: RequestInit) => {
    const request = JSON.parse(options.body as string);
    assert.deepEqual(request.images, ["a", "b", "c"]);
    assert.equal(request.image, "a");
    return new Response(JSON.stringify(tags));
  });
  assert.deepEqual(await analyzeFrames(["a", "b", "c"], new AbortController().signal), tags);
});
