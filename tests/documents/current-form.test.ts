import assert from "node:assert/strict";
import test from "node:test";
import { citedArticlesIn, fieldOverlap, formBodyText, locateCurrentForm } from "../../lib/legal/current-form.ts";
import { enrichLegalContext } from "../../lib/legal/procedure.ts";
import { keepSupportedProcedure } from "../../lib/legal/summary.ts";
import { isPotentialOfficialUrl } from "../../lib/legal/official-url.ts";
import { buildLegalViewModel } from "../../lib/legal/view-model.ts";
import type { LegalApiClient } from "../../lib/legal/client.ts";
import type { LegalCandidate, LegalContext, LegalFormListing } from "../../lib/legal/types.ts";
import type { OfficialEvidence } from "../../lib/legal/official-url.ts";

const body6 = [["■ 전기안전관리법 시행규칙 [별지 제6호서식] <개정 2025. 10. 1.> 정기검사 신청서 ─┬─ 처리기간 7일 │대표자 성명 │전화번호 │회사명 또는 상호 │사업자등록번호 │주소 전기설비 설치장소 전기설비 개요 검사희망 연월일 「전기안전관리법」 제11조 및 같은 법 시행규칙 제8조제5항에 위와 같이 따라 정기검사를 신청합니다. 한국전기안전공사 귀하 첨부서류 1. 전기안전관리자 선임신고증명서 사본"]];
const bodyOther = "■ 원자력안전법 시행규칙 [별지 제12호서식] <개정 2026. 9. 8.> 정기검사신청서 신청인 성명 생년월일 시설명 원자로 형식";
const listing = (lawName: string, lawSerial: string, number: string, title = "정기검사 신청서"): LegalFormListing => ({ title, lawName, lawSerial, number, authority: "가상부", date: "2026-08-31" });
const detail = (number: string, text: unknown) => ({ 법령: { 기본정보: { 시행일자: "20260918" }, 별표: { 별표단위: [{ 별표구분: "서식", 별표번호: number.slice(0, 4), 별표가지번호: number.slice(4), 별표제목: "정기검사 신청서", 별표내용: text, 별표서식파일링크: "/LSW/flDownload.do?flSeq=1", 별표서식PDF파일링크: "/LSW/flDownload.do?flSeq=2" }] } } });

function client(entries: LegalFormListing[], bodies: Record<string, unknown>): LegalApiClient {
  const unused = async () => { throw new Error("unused"); };
  return {
    search: unused, fetchHierarchy: unused, fetchThreeTier: unused,
    fetchBody: async (candidate: LegalCandidate) => ({ value: { target: "law", payload: bodies[candidate.serialNumber] }, retrievedAt: "2026-11-10T00:00:00.000Z", stale: false }),
    searchForms: async () => ({ value: entries, retrievedAt: "2026-11-10T00:00:00.000Z", stale: false }),
  };
}
const photoLabels = ["대표자 성명", "전화번호", "회사명 또는 상호", "사업자등록번호", "주소", "전기설비설치장소", "전기설비 개요", "검사희망 연월일"];

test("form text drops box-drawing lines and reads printed articles", () => {
  const text = formBodyText(body6);
  assert.ok(!/[─┬│]/.test(text));
  assert.deepEqual(citedArticlesIn(text), [{ lawName: "전기안전관리법", article: "제11조" }, { lawName: "전기안전관리법 시행규칙", article: "제8조제5항" }]);
  assert.ok(fieldOverlap(photoLabels, text) >= 0.8);
});

test("the current form is chosen only when the photo's fields match one same-titled form clearly", async () => {
  const entries = [listing("전기안전관리법 시행규칙", "289265", "000600"), listing("원자력안전법 시행규칙", "289525", "001200", "정기검사신청서")];
  const found = await locateCurrentForm({ title: "정기검사 신청서", fieldLabels: photoLabels }, client(entries, { 289265: detail("000600", body6), 289525: detail("001200", bodyOther) }));
  assert.equal(found?.form.lawName, "전기안전관리법 시행규칙");
  assert.equal(found?.form.label, "별지 제6호서식");
  assert.equal(found?.form.revision, "개정 2025. 10. 1.");
  assert.equal(found?.form.hwpUrl, "https://www.law.go.kr/LSW/flDownload.do?flSeq=1");
  assert.equal(found?.candidate.effectiveDate, "2026-09-18");
  const unsure = await locateCurrentForm({ title: "정기검사 신청서", fieldLabels: ["성명", "주소"] }, client(entries, { 289265: detail("000600", body6), 289525: detail("001200", bodyOther + " 주소 성명") }));
  assert.equal(unsure, null, "two equally plausible forms are not guessed");
  assert.equal(await locateCurrentForm({ title: "동네 생활 상담 신청서", fieldLabels: photoLabels }, client(entries, {})), null);
});

const oldLaw: LegalCandidate = { id: "law:291405", serialNumber: "291405", kind: "law", name: "전기사업법 시행규칙", category: "", authority: "기후에너지환경부", promulgationNumber: "", promulgationDate: "", effectiveDate: "", status: "current", apiTarget: "law" };
const oldContext: LegalContext = {
  status: "completed", detectedReferences: [{ name: "전기사업법 시행규칙", kind: "law", formNumber: "별지 제30호서식", date: "2016. 7. 28." }], candidates: [oldLaw], canonicalRule: oldLaw,
  hierarchy: { act: null, decree: null, rule: oldLaw, administrativeRules: [] }, provisions: [{ id: "p", lawName: "전기사업법 시행규칙", article: "제32조", title: "", text: "제32조 삭제 <2021.4.1>", sourceIds: ["legal-law-291405"] }],
  forms: [], authority: "기후에너지환경부", procedure: null, summary: "", sources: [{ id: "legal-law-291405", title: "전기사업법 시행규칙", url: "https://www.law.go.kr/법령/x", kind: "law", retrievedAt: "" }], warnings: [], retrievedAt: "", stale: false,
  printedReceivingOffice: "한국전기안전공사사장 귀하", printedArticles: [{ lawName: "전기사업법 시행규칙", article: "제32조제5항" }],
};

test("procedure comes from the law first and only missing items come from the web", async () => {
  const entries = [listing("전기안전관리법 시행규칙", "289265", "000600")];
  const newLaw: LegalCandidate = { ...oldLaw, id: "law:289265", serialNumber: "289265", name: "전기안전관리법 시행규칙" };
  const calls: { evidence: string[]; query?: unknown }[] = [];
  const web: OfficialEvidence = { id: "procedure-web", title: "정기검사 안내", url: "https://www.kesco.or.kr/guide", text: "문의 1588-7500", contentType: "text/html", linkOnly: false, retrievedAt: "" };
  const result = await enrichLegalContext(oldContext, undefined, {
    document: { title: "정기검사 신청서", fieldLabels: photoLabels }, client: client(entries, { 289265: detail("000600", body6) }),
    resolveSelected: async (_hints, candidate) => ({ ...oldContext, candidates: [candidate], canonicalRule: candidate, provisions: [], printedArticles: undefined, printedReceivingOffice: undefined, sources: [{ id: "legal-law-289265", title: candidate.name, url: "https://www.law.go.kr/법령/y", kind: "law", retrievedAt: "" }] }),
    discover: async query => { calls.push({ evidence: [], query }); return ["https://www.kesco.or.kr/guide"]; },
    fetchEvidence: async () => web,
    summarize: async (_context, evidence) => {
      calls.push({ evidence: evidence.map(item => item.id) });
      return evidence.some(item => item.kind === "form")
        ? { overview: "", overviewSourceIds: [], procedure: { reception: "한국전기안전공사", submission: "", requiredItems: ["전기안전관리자 선임신고증명서 사본"], fee: "", processingTime: "7일", contact: "", sourceIds: [evidence[0].id] } }
        : { overview: "", overviewSourceIds: [], procedure: { reception: "다른 곳", submission: "", requiredItems: [], fee: "", processingTime: "", contact: "1588-7500", sourceIds: ["procedure-web"] } };
    },
  });
  assert.equal(result.canonicalRule?.serialNumber, newLaw.serialNumber, "the law behind the current form becomes the basis");
  assert.equal(result.currentForm?.label, "별지 제6호서식");
  assert.equal(result.printedArticles?.[0].removed, true, "old printed article is flagged before switching laws");
  assert.equal(result.printedReceivingOffice, "한국전기안전공사사장 귀하");
  assert.equal(result.procedure?.reception, "한국전기안전공사", "law value wins over the web");
  assert.equal(result.procedure?.contact, "1588-7500");
  assert.deepEqual(result.procedure?.fieldOrigins, { reception: "law", requiredItems: "law", processingTime: "law", contact: "web" });
  const query = calls.find(call => call.query)?.query as Record<string, string>;
  assert.equal(query.documentTitle, "정기검사 신청서");
  assert.equal(query.institution, "한국전기안전공사사장");
  assert.ok(result.sources.some(item => item.kind === "form") && result.sources.some(item => item.id === "procedure-web"));
});

test("a law the user picked is kept even when a current form is found elsewhere", async () => {
  const result = await enrichLegalContext(oldContext, undefined, {
    document: { title: "정기검사 신청서", fieldLabels: photoLabels }, client: client([listing("전기안전관리법 시행규칙", "289265", "000600")], { 289265: detail("000600", body6) }), keepCanonical: true,
    resolveSelected: async () => { throw new Error("must not switch"); }, discover: async () => [], summarize: async () => ({ overview: "", overviewSourceIds: [], procedure: null }),
  });
  assert.equal(result.canonicalRule?.serialNumber, "291405");
  assert.equal(result.currentForm?.lawName, "전기안전관리법 시행규칙");
});

test("unsupported procedure phrases are dropped and sources follow the text actually quoted", () => {
  const evidence: OfficialEvidence[] = [{ id: "form", title: "", url: "https://www.law.go.kr/x", text: "처리기간 7일 한국전기안전공사 귀하", contentType: "text/plain", linkOnly: false, retrievedAt: "" }];
  const kept = keepSupportedProcedure({ overview: "", overviewSourceIds: [], procedure: { reception: "한국전기안전공사", submission: "온라인 접수", requiredItems: ["없는 서류"], fee: "", processingTime: "7일", contact: "", sourceIds: ["invented"] } }, evidence) as { procedure: Record<string, unknown> };
  assert.deepEqual(kept.procedure, { reception: "한국전기안전공사", submission: "", fee: "", processingTime: "7일", contact: "", requiredItems: [], sourceIds: ["form"] });
});

test("public-institution sites are allowed only for the web step", () => {
  assert.equal(isPotentialOfficialUrl("https://www.kesco.or.kr/guide"), false);
  assert.equal(isPotentialOfficialUrl("https://www.kesco.or.kr/guide", new Set(), true), true);
  assert.equal(isPotentialOfficialUrl("http://www.kesco.or.kr/guide", new Set(), true), false);
});

test("the panel offers the original current form and explains the photo is an old form", () => {
  const context: LegalContext = { ...oldContext, currentForm: { title: "정기검사 신청서", lawName: "전기안전관리법 시행규칙", lawSerial: "289265", label: "별지 제6호서식", revision: "개정 2025. 10. 1.", hwpUrl: "https://www.law.go.kr/a", pdfUrl: "https://www.law.go.kr/b", articles: [{ lawName: "전기안전관리법 시행규칙", article: "제8조제5항" }] },
    procedure: { reception: "한국전기안전공사", submission: "", requiredItems: [], fee: "", processingTime: "7일", contact: "1588-7500", sourceIds: ["x"], fieldOrigins: { reception: "law", processingTime: "law", contact: "web" } } };
  const model = buildLegalViewModel(context, { documentTitle: "정기검사 신청서" });
  assert.equal(model.formGuide?.superseded, true);
  assert.deepEqual(model.formGuide?.downloads.map(item => item.label), ["서식 원본 받기 (한글)", "서식 원본 받기 (PDF)"]);
  assert.equal(model.formGuide?.lawName, "전기안전관리법 시행규칙");
  assert.equal(model.formGuide?.articles[0].note, "현행 근거 조문이에요");
  assert.ok(model.notices.some(item => /예전 서식/.test(item)));
  assert.deepEqual(model.procedure?.map(row => row.origin), ["법령", "법령", "웹 자료"]);
  assert.equal(model.procedureHasWeb, true);
});
