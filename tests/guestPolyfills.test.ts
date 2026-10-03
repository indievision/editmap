import assert from "node:assert/strict";
import test from "node:test";
import { uuidFromRandomBytes } from "../src/guest/polyfills";

test("the fallback makes well-formed version 4 UUIDs from random bytes", () => {
  const id = uuidFromRandomBytes(Uint8Array.from({ length: 16 }, (_, i) => i * 17));
  assert.match(id, /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
  assert.notEqual(uuidFromRandomBytes(new Uint8Array(16).fill(1)), uuidFromRandomBytes(new Uint8Array(16).fill(2)));
});
