import assert from "node:assert/strict";
import test from "node:test";
import { AnalysisStore } from "../../lib/documents/store.ts";
import { createLegalRouteHandlers } from "../../app/api/documents/legal/route.ts";
import type { LegalCandidate, LegalContext } from "../../lib/legal/types.ts";

const document = { title: "가상 신청서", institution: "가상부", formNumber: "", revision: "", readable: true, warnings: [], fields: [] };
const search = { status: "completed" as const, case: "photo_only" as const, summary: "", sources: [] };
const candidate: LegalCandidate = { id: "administrative_rule:10", serialNumber: "10", kind: "administrative_rule", name: "가상 처리지침", category: "고시", authority: "가상부", promulgationNumber: "제10호", promulgationDate: "2026-01-01", effectiveDate: "2026-02-01", status: "current", apiTarget: "admrul" };
const context = (status: LegalContext["status"]): LegalContext => ({ status, detectedReferences: [{ name: candidate.name, kind: candidate.kind }], candidates: [candidate], canonicalRule: status === "completed" || status === "pending" ? candidate : null, hierarchy: { act: null, decree: null, rule: null, administrativeRules: status === "completed" ? [candidate] : [] }, provisions: [], forms: [], authority: candidate.authority, procedure: null, summary: "", sources: [], warnings: [], retrievedAt: "2026-11-09T00:00:00.000Z", stale: false });

function setup() {
  const store = new AnalysisStore();
  const saved = store.put(document, search);
  store.updateLegal(saved.id, context("ambiguous"));
  const handlers = createLegalRouteHandlers({ store, resolveSelected: async (_hints, selected) => ({ ...context("completed"), canonicalRule: selected, candidates: [selected] }) });
  return { store, saved, handlers };
}

test("GET returns only the current session legal context", async () => {
  const { store, saved, handlers } = setup();
  const response = await handlers.GET(new Request(`http://localhost/api/documents/legal?analysisId=${saved.id}`));
  assert.equal(response.status, 200);
  const body = await response.json();
  assert.equal(body.status, "ambiguous");
  assert.equal(body.candidates[0].id, candidate.id);
  assert.equal(body.document, undefined);
  store.delete(saved.id);
});

test("PATCH accepts only a stored candidate ID and refreshes its server-derived details", async () => {
  const { store, saved, handlers } = setup();
  const response = await handlers.PATCH(new Request("http://localhost/api/documents/legal", { method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify({ analysisId: saved.id, candidateId: candidate.id }) }));
  assert.equal(response.status, 200);
  const body = await response.json();
  assert.equal(body.status, "completed");
  assert.equal(body.canonicalRule.id, candidate.id);
  assert.equal(store.get(saved.id)?.analysis.legal?.status, "completed");
  store.delete(saved.id);
});

test("PATCH rejects client URLs, unknown candidates, and expired sessions", async () => {
  const { store, saved, handlers } = setup();
  const request = (body: unknown) => new Request("http://localhost/api/documents/legal", { method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
  assert.equal((await handlers.PATCH(request({ analysisId: saved.id, candidateId: candidate.id, url: "https://evil.example" }))).status, 400);
  assert.equal((await handlers.PATCH(request({ analysisId: saved.id, candidateId: "administrative_rule:999" }))).status, 404);
  store.delete(saved.id);
  assert.equal((await handlers.PATCH(request({ analysisId: saved.id, candidateId: candidate.id }))).status, 410);
});
