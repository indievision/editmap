import assert from "node:assert/strict";
import test from "node:test";
import { classifyStorageError, StorageError } from "../src/storage/projects.ts";

test("storage failures are classified for the UI", () => {
  const quota = classifyStorageError(new DOMException("full", "QuotaExceededError"));
  assert.ok(quota instanceof StorageError);
  assert.equal(quota.kind, "quota");
  assert.equal(classifyStorageError(new DOMException("blocked", "SecurityError")).kind, "unavailable");
  assert.equal(classifyStorageError(new Error("weird")).kind, "unknown");
  assert.equal(classifyStorageError(quota), quota);
});
