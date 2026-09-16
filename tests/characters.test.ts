import { test } from "node:test";
import assert from "node:assert/strict";
import { analyzeCharacterFrame, characterReferenceSignature, characterSampleTimes, isEligibleForCharacterScan, scanCharactersInShot, shouldScanCharacters } from "../src/analysis/characters";
import type { CastMember, Shot } from "../src/models/project";

const shot: Shot = {
  id: "shot-1", index: 1, sourceReel: "AX", sourceIn: "00:00:00:00", sourceOut: "00:00:10:00",
  startTimecode: "00:00:00:00", endTimecode: "00:00:10:00", startSeconds: 0, endSeconds: 10,
  duration: 10, transition: "C", shotSize: "MS", notes: "",
};
const cast: CastMember[] = [{ id: "anna", name: "Anna", references: [{ id: "ref", image: "reference", shotId: "shot-1", time: 1 }] }];

test("character sampling spans a shot instead of using its midpoint", () => {
  assert.deepEqual(characterSampleTimes(shot), [1, 3, 5, 7, 9]);
});

test("a character reading estimates only the sampled interval, not the whole shot", async (t) => {
  let request = 0;
  t.mock.method(globalThis, "fetch", async () => {
    const appearance = request++ === 2 ? ["anna"] : [];
    return new Response(JSON.stringify({ message: { content: JSON.stringify({ appearances: appearance, unresolved: false }) } }));
  });
  const analysis = await scanCharactersInShot(shot, { sample: async (time) => `frame-${time}`, dispose() {} }, cast, new AbortController().signal, undefined, { mode: "detailed" });
  assert.equal(request, 5);
  assert.deepEqual(analysis.intervals, [{ memberId: "anna", startSeconds: 4, endSeconds: 6, reviewStatus: "Needs review" }]);
  assert.deepEqual(analysis.unresolvedTimes, []);
});

test("keeps scanning when a character sample returns malformed JSON", async (t) => {
  let request = 0;
  t.mock.method(globalThis, "fetch", async () => {
    request++;
    return new Response(JSON.stringify({ message: { content: request === 1 ? '{"appearances":["anna"]' : '{"appearances":["anna"],"unresolved":false}' } }));
  });
  const analysis = await scanCharactersInShot(shot, { sample: async () => "frame", dispose() {} }, cast, new AbortController().signal, undefined, { mode: "detailed" });
  assert.equal(request, 5);
  assert.deepEqual(analysis.intervals, [{ memberId: "anna", startSeconds: 2, endSeconds: 9.5, reviewStatus: "Needs review" }]);
  assert.deepEqual(analysis.unresolvedTimes, [1]);
});

test("character scanning skips only explicit title graphics", () => {
  assert.equal(shouldScanCharacters({ shotSize: "MS", composition: "Single person", content: "People", uncertain: false }), true);
  assert.equal(shouldScanCharacters({ shotSize: "Not applicable", composition: "No people", content: "Text / title card", uncertain: false }), false);
  assert.equal(shouldScanCharacters({ shotSize: "CU", composition: "Unknown", content: "People", uncertain: true }), true);
  assert.equal(shouldScanCharacters({ shotSize: "WS", composition: "Two-shot", content: "Landscape / nature", uncertain: true }), true);
});

test("isEligibleForCharacterScan requires people tags from Step 1 and skips title cards or no people", () => {
  assert.equal(isEligibleForCharacterScan({ composition: "Single person", content: "People" }), true);
  assert.equal(isEligibleForCharacterScan({ composition: "Two-shot", content: "People" }), true);
  assert.equal(isEligibleForCharacterScan({ composition: "Group", content: "People" }), true);
  assert.equal(isEligibleForCharacterScan({ composition: "Unknown", content: "People" }), true);
  assert.equal(isEligibleForCharacterScan({ composition: "No people", content: "Landscape / nature" }), false);
  assert.equal(isEligibleForCharacterScan({ composition: "Single person", content: "Text / title card" }), false);
  assert.equal(isEligibleForCharacterScan({ composition: undefined, content: undefined }), false);
});

test("fast scanning reuses the editorial midpoint and publishes a marker immediately", async (t) => {
  t.mock.method(globalThis, "fetch", async () => new Response(JSON.stringify({ message: { content: '{"appearances":["anna"],"unresolved":false}' } })));
  let sampled = 0;
  const progress: boolean[] = [];
  const analysis = await scanCharactersInShot(shot, { sample: async () => { sampled++; return "unexpected"; }, dispose() {} }, cast, new AbortController().signal, undefined, { mode: "fast", midpoint: { time: 5, image: "editorial-midpoint" }, onProgress: (item) => progress.push(!!item.partial) });
  assert.equal(sampled, 0);
  assert.deepEqual(analysis.sampleTimes, [5]);
  assert.deepEqual(analysis.intervals, [{ memberId: "anna", startSeconds: 5, endSeconds: 5, reviewStatus: "Needs review" }]);
  assert.deepEqual(progress, [false]);
  assert.equal(characterReferenceSignature(cast), "slots-v3|anna:ref");
});

test("detailed scanning emits partial retained evidence after each sample", async (t) => {
  t.mock.method(globalThis, "fetch", async () => new Response(JSON.stringify({ message: { content: '{"appearances":["anna"],"unresolved":false}' } })));
  const partial: number[] = [];
  await scanCharactersInShot(shot, { sample: async () => "frame", dispose() {} }, cast, new AbortController().signal, undefined, { mode: "detailed", onProgress: (item) => { if (item.partial) partial.push(item.sampleTimes.length); } });
  assert.deepEqual(partial, [1, 2, 3, 4]);
});

test("character output sends cast references and maps appearances", async (t) => {
  const unequal: CastMember[] = [
    { id: "anna", name: "Anna", references: [{ id: "a1", image: "a1", shotId: "shot-1", time: 1 }, { id: "a2", image: "a2", shotId: "shot-1", time: 2 }] },
    { id: "bob", name: "Bob", references: [{ id: "b1", image: "b1", shotId: "shot-1", time: 3 }] },
  ];
  let body: { image?: string; cast?: CastMember[] } = {};
  t.mock.method(globalThis, "fetch", async (url, options) => {
    assert.match(String(url), /\/api\/analyze-characters/);
    body = JSON.parse(String(options?.body));
    return new Response(JSON.stringify({ appearances: ["anna"], unresolved: false }));
  });
  const reading = await analyzeCharacterFrame("film", unequal, new AbortController().signal);
  assert.deepEqual(reading.appearances, ["anna"]);
  assert.equal(body.image, "film");
  assert.equal(body.cast?.length, 2);
  assert.equal(body.cast?.[0].references.length, 2);
  assert.equal(body.cast?.[1].references.length, 1);
});

test("failed samples remain retryable while successful samples are retained", async (t) => {
  let requests = 0;
  t.mock.method(globalThis, "fetch", async () => {
    requests++;
    return new Response(JSON.stringify({ message: { content: requests === 1 ? '{"appearances":["anna"],"unresolved":false}' : '{"appearances":[],"unresolved":false}' } }));
  });
  const first = await scanCharactersInShot(shot, { sample: async () => "frame", dispose() {} }, cast, new AbortController().signal, undefined, { mode: "fast" });
  // Simulate retained failed evidence from a transport failure; resume only retries it.
  const failed = { ...first, failedTimes: [5], lastError: "timeout" };
  await scanCharactersInShot(shot, { sample: async () => "frame", dispose() {} }, cast, new AbortController().signal, undefined, { mode: "fast", existing: failed });
  assert.equal(requests, 2);
});

test("discoverCharactersAcrossShots discovers faces and clusters them into Character 1, 2...", async (t) => {
  const testShots: Shot[] = [
    {
      id: "shot-1", index: 1, sourceReel: "AX", sourceIn: "00:00:00:00", sourceOut: "00:00:05:00",
      startTimecode: "00:00:00:00", endTimecode: "00:00:05:00", startSeconds: 0, endSeconds: 5,
      duration: 5, transition: "C", shotSize: "MCU", notes: "", composition: "Single person", content: "People",
    },
    {
      id: "shot-2", index: 2, sourceReel: "AX", sourceIn: "00:00:05:00", sourceOut: "00:00:10:00",
      startTimecode: "00:00:05:00", endTimecode: "00:00:10:00", startSeconds: 5, endSeconds: 10,
      duration: 5, transition: "C", shotSize: "WS", notes: "", composition: "No people", content: "Landscape / nature",
    },
    {
      id: "shot-3", index: 3, sourceReel: "AX", sourceIn: "00:00:10:00", sourceOut: "00:00:15:00",
      startTimecode: "00:00:10:00", endTimecode: "00:00:15:00", startSeconds: 10, endSeconds: 15,
      duration: 5, transition: "C", shotSize: "CU", notes: "", composition: "Single person", content: "People",
    },
  ];

  t.mock.method(globalThis, "fetch", async (url) => {
    const urlStr = String(url);
    if (urlStr.includes("/api/detect-shot-faces")) {
      return new Response(JSON.stringify({
        faces: [{ embedding: [0.1, 0.2], bbox: [10, 10, 50, 50], score: 0.95, crop: "avatar-b64", area: 1600 }],
      }));
    }
    if (urlStr.includes("/api/cluster-faces")) {
      return new Response(JSON.stringify({
        characters: [
          {
            id: "char-1",
            name: "Character 1",
            avatar: "avatar-b64",
            shotId: "shot-1",
            time: 2.5,
            appearances: [
              { shotId: "shot-1", time: 2.5 },
              { shotId: "shot-3", time: 12.5 },
            ],
          },
        ],
        totalFaces: 2,
        unassignedFaces: 0,
      }));
    }
    throw new Error(`Unexpected url: ${urlStr}`);
  });

  const { discoverCharactersAcrossShots } = await import("../src/analysis/characters");
  const result = await discoverCharactersAcrossShots(
    testShots,
    { sample: async () => "dummy-frame", dispose() {} },
    new AbortController().signal,
  );

  assert.equal(result.cast.length, 1);
  assert.equal(result.cast[0].id, "char-1");
  assert.equal(result.cast[0].name, "Character 1");
  assert.equal(result.cast[0].references[0].image, "avatar-b64");
  assert.equal(result.shotAnalyses.size, 2); // shot-1 and shot-3 (shot-2 skipped: No people)
  assert.deepEqual(result.shotAnalyses.get("shot-1")?.intervals, [
    { memberId: "char-1", startSeconds: 2.5, endSeconds: 2.5, reviewStatus: "Needs review" },
  ]);
});

test("rediscovery preserves named cast and retries failed samples from its checkpoint", async (t) => {
  const { discoverCharactersAcrossShots, mergeDiscoveredCast } = await import("../src/analysis/characters");
  const existing = [{ id: "anna", name: "Anna", references: [{ id: "manual", image: "aGVsbG8=", shotId: "s1", time: .5 }] }];
  assert.deepEqual(mergeDiscoveredCast(existing, [{ ...existing[0], name: "Character 1", references: [] }]), existing);
  const shots = [0, 1].map(i => ({ id: `s${i+1}`, index: i+1, startSeconds: i, endSeconds: i+1, composition: "Single person", content: "People" } as Shot));
  const checkpoint = new Map();
  let fail = true, samples = 0;
  t.mock.method(globalThis, "fetch", async (url: string, init: RequestInit) => {
    const body = JSON.parse(init.body as string);
    if (String(url).includes("detect-shot")) {
      if (body.shotId === "s2" && fail) return new Response("{}", { status: 503 });
      return Response.json({ faces: [] });
    }
    throw new Error("Empty detections must not invoke clustering");
  });
  const sampler = { sample: async () => { samples++; return "image"; }, dispose() {} };
  const first = await discoverCharactersAcrossShots(shots, sampler, new AbortController().signal, { existingCast: existing, checkpoint });
  assert.deepEqual(first.cast, existing);
  assert.deepEqual(first.shotAnalyses.get("s2")?.failedTimes, [1.5]);
  assert.deepEqual(first.shotAnalyses.get("s2")?.sampleTimes, []);
  fail = false;
  const resumed = await discoverCharactersAcrossShots(shots, sampler, new AbortController().signal, { existingCast: existing, checkpoint });
  assert.equal(samples, 3);
  assert.deepEqual(resumed.shotAnalyses.get("s2")?.failedTimes, []);
});
