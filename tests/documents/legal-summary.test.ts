import assert from "node:assert/strict";
import test, { type TestContext } from "node:test";
import { discoverOfficialProcedureSources, enrichLegalContext } from "../../lib/legal/procedure.ts";
import { summarizeLegalContext, validateLegalSummary } from "../../lib/legal/summary.ts";
import type { OfficialEvidence } from "../../lib/legal/official-url.ts";
import type { LegalCandidate, LegalContext } from "../../lib/legal/types.ts";

function fakeKey(t: TestContext) {
  const original = process.env.OPENAI_API_KEY;
  process.env.OPENAI_API_KEY = "test-only-placeholder";
  t.after(() => { if (original === undefined) delete process.env.OPENAI_API_KEY; else process.env.OPENAI_API_KEY = original; });
}

const candidate: LegalCandidate = { id: "law:1", serialNumber: "1", kind: "law", name: "가상민원법", category: "법률", authority: "가상부", promulgationNumber: "법률 제1호", promulgationDate: "2026-01-01", effectiveDate: "2026-02-01", status: "current", apiTarget: "law" };
const context: LegalContext = { status: "completed", detectedReferences: [{ name: candidate.name, kind: "law", authority: "가상부", formNumber: "별지 제1호" }], candidates: [candidate], canonicalRule: candidate, hierarchy: { act: candidate, decree: null, rule: null, administrativeRules: [] }, provisions: [{ id: "provision-1", lawName: candidate.name, article: "제5조", title: "신청", text: "신청서를 제출한다.", sourceIds: ["legal-law-1"] }], forms: [], authority: "가상부", procedure: null, summary: "", sources: [{ id: "legal-law-1", title: candidate.name, url: "https://www.law.go.kr/law", kind: "law", retrievedAt: "2026-11-09T00:00:00.000Z" }], warnings: [], retrievedAt: "2026-11-09T00:00:00.000Z", stale: false };
const evidence: OfficialEvidence = { id: "procedure-1", title: "민원 신청 안내", url: "https://apply.gov.kr/form", text: "가상민원법 제5조에 따라 가상부 민원실에서 접수합니다. 시행일은 2026-02-01이며 수수료는 1,000원입니다. 온라인 신청은 https://apply.gov.kr/form 에서 합니다.", contentType: "text/html", linkOnly: false, retrievedAt: "2026-11-09T00:00:00.000Z" };
const valid = { overview: "가상민원법 제5조에 따른 신청 안내입니다. 시행일은 2026-02-01입니다.", overviewSourceIds: ["legal-law-1"], procedure: { reception: "가상부 민원실", submission: "https://apply.gov.kr/form", requiredItems: [], fee: "1,000원", processingTime: "", contact: "", sourceIds: ["procedure-1"] } };

test("procedure discovery sends only canonical metadata and keeps official result URLs", async (t) => {
  fakeKey(t);
  let sent: Record<string, unknown> | undefined;
  t.mock.method(globalThis, "fetch", async (_input: Parameters<typeof fetch>[0], init?: RequestInit) => {
    sent = JSON.parse(String(init?.body));
    return Response.json({ status: "completed", output: [
      { type: "web_search_call", status: "completed", action: { sources: [{ url: "https://apply.gov.kr/form" }, { url: "https://evil.example/guess" }] } },
      { type: "message", content: [{ type: "output_text", text: "공식 신청 안내를 확인했습니다.", annotations: [{ type: "url_citation", url: "https://www.mois.go.kr/guide" }] }] },
    ] });
  });
  const urls = await discoverOfficialProcedureSources({ lawName: "가상민원법", authority: "가상부", formNumber: "별지 제1호" });
  assert.deepEqual(urls, ["https://apply.gov.kr/form", "https://www.mois.go.kr/guide"]);
  const payload = JSON.stringify(sent);
  assert.match(payload, /가상민원법/);
  assert.match(payload, /가상부/);
  assert.match(payload, /별지 제1호/);
  assert.equal(payload.includes("private-personal-value"), false);
  assert.equal(payload.includes("input_image"), false);
});

test("grounded summary accepts only existing source IDs and exact legal invariants", () => {
  const parsed = validateLegalSummary(context, [evidence], valid);
  assert.equal(parsed.overview, valid.overview);
  assert.equal(parsed.procedure?.fee, "1,000원");

  assert.throws(() => validateLegalSummary(context, [evidence], { ...valid, overviewSourceIds: ["invented"] }), /INVALID_LEGAL_SUMMARY/);
  assert.throws(() => validateLegalSummary(context, [evidence], { ...valid, overview: valid.overview.replace("제5조", "제6조") }), /INVALID_LEGAL_SUMMARY/);
  assert.throws(() => validateLegalSummary(context, [evidence], { ...valid, overview: valid.overview.replace("2026-02-01", "2026-02-02") }), /INVALID_LEGAL_SUMMARY/);
  assert.throws(() => validateLegalSummary(context, [evidence], { ...valid, procedure: { ...valid.procedure, fee: "2,000원" } }), /INVALID_LEGAL_SUMMARY/);
  assert.throws(() => validateLegalSummary(context, [evidence], { ...valid, procedure: { ...valid.procedure, submission: "https://evil.example/form" } }), /INVALID_LEGAL_SUMMARY/);
});

test("unsupported procedure fields stay empty instead of being generated without evidence", () => {
  const parsed = validateLegalSummary(context, [evidence], { overview: "", overviewSourceIds: [], procedure: { reception: "", submission: "", requiredItems: [], fee: "", processingTime: "", contact: "", sourceIds: [] } });
  assert.equal(parsed.procedure, null);
  assert.equal(parsed.overview, "");
});

test("OpenAI summary receives only canonical evidence and returns a validated structure", async (t) => {
  fakeKey(t);
  let sent: Record<string, unknown> | undefined;
  t.mock.method(globalThis, "fetch", async (_input: Parameters<typeof fetch>[0], init?: RequestInit) => {
    sent = JSON.parse(String(init?.body));
    return Response.json({ status: "completed", output: [{ type: "message", content: [{ type: "output_text", text: JSON.stringify(valid) }] }] });
  });
  const summary = await summarizeLegalContext(context, [evidence]);
  assert.equal(summary.procedure?.reception, "가상부 민원실");
  assert.equal((sent?.text as { format: { name: string } }).format.name, "grounded_legal_summary");
  assert.equal(JSON.stringify(sent).includes("input_image"), false);
  assert.equal(JSON.stringify(sent).includes("private-personal-value"), false);
});

test("procedure enrichment adds only fetched official evidence and grounded summary", async () => {
  const enriched = await enrichLegalContext(context, undefined, {
    discover: async () => [evidence.url],
    fetchEvidence: async () => evidence,
    summarize: async () => validateLegalSummary(context, [evidence], valid),
  });
  assert.equal(enriched.summary, valid.overview);
  assert.deepEqual(enriched.summarySourceIds, valid.overviewSourceIds);
  assert.equal(enriched.procedure?.fee, "1,000원");
  assert.equal(enriched.sources.some(source => source.id === evidence.id && source.kind === "procedure"), true);
});

test("summary accepts real article numbers and rejects unsupported dotted dates", () => {
  const real = { ...context, provisions: [{ ...context.provisions[0], article: "제32조" }] };
  assert.equal(validateLegalSummary(real, [evidence], { ...valid, overview: "가상민원법 제32조에 따른 안내입니다." }).overview, "가상민원법 제32조에 따른 안내입니다.");
  assert.throws(() => validateLegalSummary(real, [evidence], { ...valid, overview: "가상민원법 시행일은 2025. 10. 1.입니다." }), /INVALID_LEGAL_SUMMARY/);
});

test("download-only files and law history pages are not used or listed as procedure evidence", async () => {
  const pdf: OfficialEvidence = { ...evidence, id: "procedure-pdf", title: "flDownload.do", text: "", contentType: "application/pdf", linkOnly: true };
  const history: OfficialEvidence = { ...evidence, id: "procedure-old", text: "법령(연혁) - 가상민원법 시행일 2020-01-01" };
  const seen: string[] = [];
  const enriched = await enrichLegalContext(context, undefined, { discover: async () => ["a", "b", "c"], fetchEvidence: async url => url === "a" ? pdf : url === "b" ? history : evidence, summarize: async (_c, ev) => { seen.push(...ev.map(item => item.id)); return { overview: "", overviewSourceIds: [], procedure: null }; } });
  assert.deepEqual(seen, [evidence.id]);
  assert.equal(enriched.sources.some(source => source.id === "procedure-pdf"), false);
});
