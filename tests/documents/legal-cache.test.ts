import assert from "node:assert/strict";
import test from "node:test";
import { StaleCache } from "../../lib/legal/cache.ts";

test("fresh entries expire into stale storage and disappear after the stale window", () => {
  let now = 1_000;
  const cache = new StaleCache<string, { name: string }>({ freshTtlMs: 100, staleTtlMs: 700, capacity: 2, now: () => now });
  cache.set("rule", { name: "가상 규칙" });

  assert.deepEqual(cache.getFresh("rule"), { name: "가상 규칙" });
  assert.equal(cache.getStale("rule"), undefined);

  now = 1_100;
  assert.equal(cache.getFresh("rule"), undefined);
  assert.deepEqual(cache.getStale("rule"), { name: "가상 규칙" });

  now = 1_800;
  assert.equal(cache.getFresh("rule"), undefined);
  assert.equal(cache.getStale("rule"), undefined);
});

test("capacity eviction removes the least recently used entry from fresh and stale access", () => {
  let now = 0;
  const cache = new StaleCache<string, number>({ freshTtlMs: 10, staleTtlMs: 100, capacity: 2, now: () => now });
  cache.set("first", 1);
  cache.set("second", 2);
  assert.equal(cache.getFresh("first"), 1);
  cache.set("third", 3);

  assert.equal(cache.getFresh("second"), undefined);
  now = 10;
  assert.equal(cache.getStale("second"), undefined);
  assert.equal(cache.getStale("first"), 1);
  assert.equal(cache.getStale("third"), 3);
});

test("the seven-day stale boundary is inclusive before and unavailable at the boundary", () => {
  let now = 0;
  const sevenDays = 604_800_000;
  const cache = new StaleCache<string, string>({ freshTtlMs: 1, staleTtlMs: sevenDays, capacity: 1, now: () => now });
  cache.set("law", "body");
  now = sevenDays;
  assert.equal(cache.getStale("law"), "body");
  now = sevenDays + 1;
  assert.equal(cache.getStale("law"), undefined);
});

