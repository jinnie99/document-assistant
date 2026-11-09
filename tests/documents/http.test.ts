import assert from "node:assert/strict";
import test from "node:test";
import { errorResponse, InputError, requestJson } from "../../lib/documents/http.ts";
import * as http from "../../lib/documents/http.ts";

test("request boundary rejects malformed JSON and non-object payloads", async () => {
  for (const body of ["{", "null", "[]", "true"]) {
    const request = new Request("http://localhost:3000/api/documents/analyze", { method: "POST", headers: { "Content-Type": "application/json" }, body });
    await assert.rejects(() => requestJson(request), (error) => error instanceof InputError && error.code === "INVALID_JSON" && error.status === 400);
  }
});

test("cross-origin analysis calls cannot spend the configured server key", async () => {
  const request = new Request("http://localhost:3000/api/documents/analyze", { method: "POST", headers: { "Content-Type": "application/json", Origin: "https://unrelated.example" }, body: "{}" });
  await assert.rejects(() => requestJson(request), (error) => error instanceof InputError && error.status === 403);
});

test("local Next development hostname aliases accept the real browser origin", async () => {
  const request = new Request("http://localhost:3000/api/documents/analyze", { method: "POST", headers: { "Content-Type": "application/json", Origin: "http://127.0.0.1:3000", Host: "127.0.0.1:3000" }, body: "{}" });
  assert.deepEqual(await requestJson(request), {});
});

test("oversized request is rejected before decoding", async () => {
  const request = new Request("http://localhost:3000/api/documents/analyze", { method: "POST", headers: { "Content-Type": "application/json", "Content-Length": String(10 * 1024 * 1024) }, body: "{}" });
  await assert.rejects(() => requestJson(request), (error) => error instanceof InputError && error.status === 413);
});

test("public errors never echo provider messages or request data", async () => {
  const response = errorResponse(new Error("provider secret or customer document text"));
  assert.equal(response.status, 502);
  const body = await response.json();
  assert.equal(body.code, "AI_INVALID_RESPONSE");
  assert.ok(!JSON.stringify(body).includes("provider secret"));
  assert.equal(response.headers.get("Cache-Control"), "no-store");
});

test("stream capacity remains reserved until release and release is idempotent", () => {
  assert.equal(typeof http.acquireBudget, "function");
  const request = new Request("http://localhost/api/documents/analyze", { headers: { "x-forwarded-for": "budget-test" } });
  const first = http.acquireBudget(request);
  const second = http.acquireBudget(request);
  try {
    assert.throws(() => http.acquireBudget(request), error => error instanceof InputError && error.code === "AI_RATE_LIMIT");
    first(); first();
    const third = http.acquireBudget(request);
    try {
      assert.throws(() => http.acquireBudget(request), error => error instanceof InputError && error.code === "AI_RATE_LIMIT");
    } finally { third(); }
  } finally { first(); second(); }
});
