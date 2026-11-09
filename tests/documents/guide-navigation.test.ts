import assert from "node:assert/strict";
import test from "node:test";
import { nextGuideDestination } from "../../lib/documents/guide-navigation.ts";

test("the last available field waits only after its remaining explanation pages", () => {
  assert.equal(nextGuideDestination(true, true, true), "page");
  assert.equal(nextGuideDestination(false, true, true), "waiting");
});

test("new fields or finished mapping release the waiting footer", () => {
  assert.equal(nextGuideDestination(false, false, true), "field");
  assert.equal(nextGuideDestination(false, true, false), "complete");
});

test("legacy completed documents still finish from the last field", () => {
  assert.equal(nextGuideDestination(false, true), "complete");
});
