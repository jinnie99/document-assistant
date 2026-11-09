import assert from "node:assert/strict";
import test from "node:test";
import { fetchOfficialEvidence, validateOfficialUrl } from "../../lib/legal/official-url.ts";

const publicDns = async () => ["8.8.8.8"];

test("official URL policy accepts HTTPS government hosts and explicitly verified public institutions", async () => {
  assert.equal((await validateOfficialUrl("https://www.mois.go.kr/frt/a01/frtMain.do", { resolveHost: publicDns })).hostname, "www.mois.go.kr");
  assert.equal((await validateOfficialUrl("https://www.gov.kr/portal/service", { resolveHost: publicDns })).hostname, "www.gov.kr");
  assert.equal((await validateOfficialUrl("https://www.keco.or.kr/apply", { resolveHost: publicDns, verifiedHosts: new Set(["www.keco.or.kr"]) })).hostname, "www.keco.or.kr");
});

test("official URL policy rejects unsafe schemes, credentials, ports, domains, and private addresses", async () => {
  const values = [
    "http://www.gov.kr/service",
    "https://user:pass@www.gov.kr/service",
    "https://www.gov.kr:8443/service",
    "https://example.com/service",
  ];
  for (const value of values) await assert.rejects(validateOfficialUrl(value, { resolveHost: publicDns }), /UNSAFE_OFFICIAL_URL/);
  for (const address of ["127.0.0.1", "10.0.0.1", "172.16.0.1", "192.168.0.1", "169.254.1.1", "::1", "fe80::1"]) {
    await assert.rejects(validateOfficialUrl("https://www.gov.kr/service", { resolveHost: async () => [address] }), /UNSAFE_OFFICIAL_URL/);
  }
});

test("DNS is checked twice and a public-to-private rebinding answer is rejected before fetch", async () => {
  let calls = 0;
  await assert.rejects(validateOfficialUrl("https://www.gov.kr/service", { resolveHost: async () => [++calls === 1 ? "8.8.8.8" : "127.0.0.1"] }), /UNSAFE_OFFICIAL_URL/);
  assert.equal(calls, 2);
});

test("official evidence follows only revalidated redirects and extracts bounded public HTML", async () => {
  const calls: string[] = [];
  const fetcher: typeof fetch = async (input) => {
    calls.push(String(input));
    if (calls.length === 1) return new Response(null, { status: 302, headers: { location: "https://apply.gov.kr/form" } });
    return new Response("<html><head><title>민원 신청 안내</title><script>secret()</script></head><body><h1>신청 방법</h1><p>방문 접수</p></body></html>", { headers: { "content-type": "text/html; charset=utf-8" } });
  };
  const evidence = await fetchOfficialEvidence("https://www.gov.kr/start", { fetch: fetcher, resolveHost: publicDns, now: () => Date.UTC(2026, 10, 9) });
  assert.deepEqual(calls, ["https://www.gov.kr/start", "https://apply.gov.kr/form"]);
  assert.equal(evidence.title, "민원 신청 안내");
  assert.match(evidence.text, /신청 방법.*방문 접수/);
  assert.equal(evidence.text.includes("secret"), false);
  assert.equal(evidence.linkOnly, false);
});

test("redirects to unsafe hosts, oversized HTML, and stalled requests fail safely", async () => {
  await assert.rejects(fetchOfficialEvidence("https://www.gov.kr/start", { fetch: async () => new Response(null, { status: 302, headers: { location: "https://127.0.0.1/private" } }), resolveHost: publicDns }), /UNSAFE_OFFICIAL_URL/);
  await assert.rejects(fetchOfficialEvidence("https://www.gov.kr/large", { fetch: async () => new Response("x", { headers: { "content-type": "text/html", "content-length": String(1024 * 1024 + 1) } }), resolveHost: publicDns }), /OFFICIAL_RESPONSE_TOO_LARGE/);
  const stalled: typeof fetch = async (_input, init) => new Promise((_resolve, reject) => init?.signal?.addEventListener("abort", () => reject(new DOMException("aborted", "AbortError")), { once: true }));
  await assert.rejects(fetchOfficialEvidence("https://www.gov.kr/slow", { fetch: stalled, resolveHost: publicDns, timeoutMs: 5 }), /OFFICIAL_TIMEOUT/);
});

test("non-HTML official resources remain link-only metadata", async () => {
  const evidence = await fetchOfficialEvidence("https://www.law.go.kr/file.pdf", { fetch: async () => new Response("%PDF private bytes", { headers: { "content-type": "application/pdf" } }), resolveHost: publicDns });
  assert.equal(evidence.linkOnly, true);
  assert.equal(evidence.text, "");
  assert.equal(evidence.contentType, "application/pdf");
});

