import assert from "node:assert/strict";
import test from "node:test";
import { createLegalApiClient, LegalApiError } from "../../lib/legal/client.ts";
import { configurationStatus } from "../../lib/legal/config.ts";

const searchPayload = {
  LawSearch: {
    totalCnt: "1",
    law: [{
      "법령일련번호": "12345",
      "법령명한글": "가상 민원법",
      "법령구분명": "법률",
      "소관부처명": "가상부",
      "공포번호": "제42호",
      "공포일자": "20260102",
      "시행일자": "20260304",
      "현행연혁코드": "현행",
    }],
  },
};

test("search sends encoded JSON queries without exposing credentials in the normalized result", async () => {
  const calls: { url: URL; init?: RequestInit }[] = [];
  const fakeFetch: typeof fetch = async (input, init) => {
    calls.push({ url: new URL(String(input)), init });
    return Response.json(searchPayload);
  };
  const client = createLegalApiClient({ oc: "server-secret", fetch: fakeFetch, now: () => Date.UTC(2026, 0, 1) });

  const result = await client.search({ name: "가상 민원법 시행 규칙", kind: "law" });

  assert.equal(calls.length, 1);
  assert.equal(calls[0].url.searchParams.get("type"), "JSON");
  assert.equal(calls[0].url.searchParams.get("query"), "가상 민원법 시행 규칙");
  assert.equal(calls[0].url.searchParams.get("OC"), "server-secret");
  assert.equal(calls[0].init?.cache, "no-store");
  assert.equal(result.stale, false);
  assert.equal(result.value.length, 1);
  assert.deepEqual(result.value[0], {
    id: "law:12345",
    serialNumber: "12345",
    kind: "law",
    name: "가상 민원법",
    category: "법률",
    authority: "가상부",
    promulgationNumber: "제42호",
    promulgationDate: "2026-01-02",
    effectiveDate: "2026-03-04",
    status: "current",
    apiTarget: "law",
  });
  assert.equal(JSON.stringify(result).includes("server-secret"), false);
});

test("search uses a six-hour fresh cache and a seven-day stale value only after an upstream failure", async () => {
  let now = 0;
  let calls = 0;
  const fakeFetch: typeof fetch = async () => {
    calls++;
    if (calls > 1) throw new TypeError("offline");
    return Response.json(searchPayload);
  };
  const client = createLegalApiClient({ oc: "secret", fetch: fakeFetch, now: () => now });

  assert.equal((await client.search({ name: "가상 민원법", kind: "law" })).stale, false);
  now = 6 * 60 * 60_000 - 1;
  assert.equal((await client.search({ name: "가상 민원법", kind: "law" })).stale, false);
  assert.equal(calls, 1);
  now = 6 * 60 * 60_000;
  const stale = await client.search({ name: "가상 민원법", kind: "law" });
  assert.equal(calls, 2);
  assert.equal(stale.stale, true);
  assert.equal(stale.value[0].id, "law:12345");
});

test("administrative-rule searches use the administrative target", async () => {
  let url: URL | undefined;
  const fakeFetch: typeof fetch = async (input) => {
    url = new URL(String(input));
    return Response.json({ AdmRulSearch: { totalCnt: "0", admrul: [] } });
  };
  const client = createLegalApiClient({ oc: "secret", fetch: fakeFetch });
  await client.search({ name: "가상 처리지침", kind: "administrative_rule" });
  assert.equal(url?.searchParams.get("target"), "admrul");
});

test("oversized and failed responses expose only stable safe error codes", async () => {
  const oversized = createLegalApiClient({ oc: "top-secret", fetch: async () => new Response("", { headers: { "content-length": String(2 * 1024 * 1024 + 1) } }) });
  await assert.rejects(oversized.search({ name: "법", kind: "law" }), (error: unknown) => {
    assert.ok(error instanceof LegalApiError);
    assert.equal(error.code, "LEGAL_API_RESPONSE_TOO_LARGE");
    assert.equal(String(error).includes("top-secret"), false);
    return true;
  });

  const failed = createLegalApiClient({ oc: "top-secret", fetch: async () => new Response("provider says top-secret and database details", { status: 500 }) });
  await assert.rejects(failed.search({ name: "법", kind: "law" }), (error: unknown) => {
    assert.ok(error instanceof LegalApiError);
    assert.equal(error.code, "LEGAL_API_UPSTREAM_ERROR");
    assert.equal(String(error).includes("provider says"), false);
    assert.equal(JSON.stringify(error).includes("top-secret"), false);
    return true;
  });
});

test("timeouts and caller cancellation have distinct safe codes", async () => {
  const waitsForAbort: typeof fetch = async (_input, init) => new Promise((_resolve, reject) => {
    init?.signal?.addEventListener("abort", () => reject(new DOMException("aborted", "AbortError")), { once: true });
  });
  const timed = createLegalApiClient({ oc: "secret", fetch: waitsForAbort, timeoutMs: 5 });
  await assert.rejects(timed.search({ name: "법", kind: "law" }), (error: unknown) => error instanceof LegalApiError && error.code === "LEGAL_API_TIMEOUT");

  const controller = new AbortController();
  const cancelled = createLegalApiClient({ oc: "secret", fetch: waitsForAbort, timeoutMs: 1_000 });
  const pending = cancelled.search({ name: "법", kind: "law" }, controller.signal);
  controller.abort();
  await assert.rejects(pending, (error: unknown) => error instanceof LegalApiError && error.code === "LEGAL_API_CANCELLED");
});

test("configuration status exposes availability flags but never secret values", () => {
  const status = configurationStatus({ OPENAI_API_KEY: "openai-secret", LAW_OPEN_API_OC: "law-secret" });
  assert.deepEqual(status, { configured: true, aiConfigured: true, lawConfigured: true });
  assert.equal(JSON.stringify(status).includes("secret"), false);
  assert.deepEqual(configurationStatus({ OPENAI_API_KEY: " ", LAW_OPEN_API_OC: "" }), { configured: false, aiConfigured: false, lawConfigured: false });
});
