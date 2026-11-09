import assert from "node:assert/strict";
import test from "node:test";
import { resolveLegalContext, resolveSelectedLegalContext, scoreLegalCandidate } from "../../lib/legal/resolver.ts";
import type { LegalApiClient } from "../../lib/legal/client.ts";
import type { LegalApiDocument, LegalApiResult, LegalCandidate, LegalSearchReference } from "../../lib/legal/types.ts";

const reference: LegalSearchReference = { name: "가상 민원 처리지침", kind: "administrative_rule", authority: "가상부", number: "가상부고시 제10호", date: "2026-03-01", formNumber: "별지 제1호서식" };
const current: LegalCandidate = { id: "administrative_rule:10", serialNumber: "10", kind: "administrative_rule", name: reference.name, category: "고시", authority: "가상부", promulgationNumber: "가상부고시 제10호", promulgationDate: "2026-03-01", effectiveDate: "2026-04-01", status: "current", apiTarget: "admrul" };
const repealed: LegalCandidate = { ...current, id: "administrative_rule:9", serialNumber: "9", promulgationNumber: "가상부고시 제9호", status: "repealed" };
const result = <T>(value: T, stale = false): LegalApiResult<T> => ({ value, retrievedAt: "2026-11-09T00:00:00.000Z", stale });
const document = (target: string, payload: unknown): LegalApiResult<LegalApiDocument> => result({ target, payload });

function client(searchValue: LegalCandidate[], payloads: Partial<Record<"body" | "hierarchy" | "tier", unknown>> = {}): LegalApiClient {
  return {
    search: async () => result(searchValue),
    fetchBody: async () => document("admrul", payloads.body ?? {}),
    fetchHierarchy: async () => document("lsStmd", payloads.hierarchy ?? {}),
    fetchThreeTier: async () => document("thdCmp", payloads.tier ?? {}),
  };
}

test("candidate scoring prefers exact authority, number, date, and current status", () => {
  assert.ok(scoreLegalCandidate(reference, current) > scoreLegalCandidate(reference, repealed));
  assert.ok(scoreLegalCandidate(reference, current) > scoreLegalCandidate({ ...reference, name: "다른 법령" }, current));
});

test("a unique exact candidate is selected while indistinguishable current candidates stay ambiguous", async () => {
  const selected = await resolveLegalContext({ references: [reference] }, client([current]));
  assert.equal(selected.status, "completed");
  assert.equal(selected.canonicalRule?.id, current.id);

  const sameScore = { ...current, id: "administrative_rule:11", serialNumber: "11" };
  const ambiguous = await resolveLegalContext({ references: [{ name: reference.name, kind: reference.kind }] }, client([current, sameScore]));
  assert.equal(ambiguous.status, "ambiguous");
  assert.deepEqual(ambiguous.candidates.map(item => item.id), [current.id, sameScore.id]);
  assert.equal(ambiguous.canonicalRule, null);
});

test("a current exact rule wins over its repealed predecessor and no candidates remain not found", async () => {
  const selected = await resolveLegalContext({ references: [{ name: reference.name, kind: reference.kind }] }, client([repealed, current]));
  assert.equal(selected.canonicalRule?.id, current.id);
  assert.equal((await resolveLegalContext({ references: [reference] }, client([]))).status, "not_found");
});

test("search failures are unavailable without leaking provider details", async () => {
  const failing: LegalApiClient = {
    ...client([]),
    search: async () => { throw new Error("provider database secret"); },
  };
  const resolved = await resolveLegalContext({ references: [reference] }, failing);
  assert.equal(resolved.status, "unavailable");
  assert.equal(JSON.stringify(resolved).includes("provider database secret"), false);
});

test("administrative rule detail exposes the responsible department for the office block", async () => {
  const body = { AdmRulService: { 행정규칙기본정보: { 소관부처명: "가상부", 담당부서기관명: "가상부(가상과)" } } };
  const resolved = await resolveLegalContext({ references: [reference] }, client([current], { body, hierarchy: { 법령체계도: { 관계: [] } }, tier: { 삼단비교: { 관계: [] } } }));
  assert.equal(resolved.status, "completed");
  assert.equal(resolved.department, "가상부(가상과)");
  assert.equal(resolved.authority, "가상부");
});

test("confirmed API hierarchy keeps administrative rules separate and retains sourced body details", async () => {
  const act: LegalCandidate = { ...current, id: "law:100", serialNumber: "100", kind: "law", name: "가상 민원법", category: "법률", apiTarget: "law" };
  const decree: LegalCandidate = { ...act, id: "law:101", serialNumber: "101", name: "가상 민원법 시행령", category: "대통령령" };
  const rule: LegalCandidate = { ...act, id: "law:102", serialNumber: "102", name: "가상 민원법 시행규칙", category: "총리령" };
  const body = { 법령: { 기본정보: { 소관부처명: "가상부" }, 조문: { 조문단위: [{ 조문번호: "제5조", 조문제목: "신청", 조문내용: "신청서를 제출한다." }] }, 별표: { 별표단위: [{ 별표번호: "별지 제1호", 별표제목: "민원 신청서", 별표서식파일링크: "https://www.law.go.kr/form.pdf" }] } } };
  const hierarchy = { 법령체계도: { 관계: [act, decree, rule, current] } };
  const resolved = await resolveLegalContext({ references: [reference] }, client([current], { body, hierarchy, tier: { 삼단비교: { 관계: [act, decree, rule] } } }));

  assert.equal(resolved.hierarchy.act?.id, act.id);
  assert.equal(resolved.hierarchy.decree?.id, decree.id);
  assert.equal(resolved.hierarchy.rule?.id, rule.id);
  assert.deepEqual(resolved.hierarchy.administrativeRules.map(item => item.id), [current.id]);
  assert.equal(resolved.provisions[0].article, "제5조");
  assert.equal(resolved.provisions[0].sourceIds.length, 1);
  assert.equal(resolved.forms[0].title, "민원 신청서");
  assert.equal(resolved.forms[0].sourceIds.length, 1);
  assert.equal(resolved.authority, "가상부");
  assert.equal(resolved.sources.length > 0, true);
});

test("an explicitly selected session candidate refreshes details without another name search", async () => {
  const selectedClient = client([]);
  selectedClient.search = async () => { throw new Error("search must not run"); };
  const resolved = await resolveSelectedLegalContext({ references: [reference] }, current, selectedClient);
  assert.equal(resolved.status, "completed");
  assert.equal(resolved.canonicalRule?.id, current.id);
});

test("law detail maps the ministry object, contact departments and relative form links with revisions", async () => {
  const body = { 법령: {
    기본정보: { 법령명_한글: "가상 시행규칙", 소관부처: { content: "가상부", 소관부처코드: "1" }, 연락부서: { 부서단위: [{ 부서명: "가상과", 부서연락처: "044-000-0000" }] } },
    별표: { 별표단위: [{ 별표구분: "서식", 별표번호: "0030", 별표제목: "가상 신청서", 별표서식파일링크: "/LSW/flDownload.do?flSeq=42", 별표내용: "■ 가상 시행규칙 [별지 제30호서식] <신설 2021. 7. 21.>" }] },
  } };
  const resolved = await resolveLegalContext({ references: [reference] }, client([current], { body, hierarchy: { 법령체계도: { 관계: [] } }, tier: { 삼단비교: { 관계: [] } } }));
  assert.equal(resolved.authority, "가상부");
  assert.deepEqual(resolved.contacts, [{ department: "가상과", phone: "044-000-0000" }]);
  assert.equal(resolved.forms[0].url, "https://www.law.go.kr/LSW/flDownload.do?flSeq=42");
  assert.equal(resolved.forms[0].label, "별지 제30호서식");
  assert.equal(resolved.forms[0].revision, "신설 2021. 7. 21.");
});

test("form revision is read even when 별표내용 arrives as nested arrays", async () => {
  const body = { 법령: { 별표: { 별표단위: [{ 별표구분: "서식", 별표번호: "0030", 별표제목: "가상 결과보고서", 별표서식파일링크: "/LSW/flDownload.do?flSeq=7", 별표내용: [["■ 가상 시행규칙 [별지 제30호서식] ", "<신설 2021. 7. 21.>"]] }] } } };
  const resolved = await resolveLegalContext({ references: [reference] }, client([current], { body, hierarchy: { 법령체계도: { 관계: [] } }, tier: { 삼단비교: { 관계: [] } } }));
  assert.equal(resolved.forms[0].revision, "신설 2021. 7. 21.");
});

test("the printed reference carrying a form number decides ties and real article shapes are kept", async () => {
  const ruleLaw: LegalCandidate = { ...current, id: "law:9", serialNumber: "9", kind: "law", name: "가상법 시행규칙", authority: "", promulgationNumber: "", promulgationDate: "", effectiveDate: "", status: "current", apiTarget: "law" };
  const actLaw: LegalCandidate = { ...ruleLaw, id: "law:8", serialNumber: "8", name: "가상법" };
  const hints = { references: [{ name: "가상법 시행규칙", kind: "law" as const, formNumber: "별지 제30호서식" }, { name: "가상법", kind: "law" as const }], citedArticles: [{ lawName: "가상법 시행규칙", article: "제3조의2" }] };
  const body = { 법령: { 조문: { 조문단위: [{ 조문번호: "3", 조문가지번호: "2", 조문여부: "조문", 조문제목: "범위", 조문내용: "제3조의2(범위)", 항: [{ 항내용: "① 본문", 호: [{ 호내용: "1. 호 본문" }] }] }, { 조문번호: "1", 조문여부: "전문", 조문내용: "제1장 총칙" }] } } };
  const resolved = await resolveLegalContext(hints, client([ruleLaw, actLaw], { body, hierarchy: { 법령체계도: { 관계: [] } }, tier: { 삼단비교: { 관계: [] } } }));
  assert.equal(resolved.status, "completed");
  assert.equal(resolved.canonicalRule?.id, "law:9");
  assert.deepEqual(resolved.printedArticles, hints.citedArticles);
  assert.equal(resolved.provisions.length, 1);
  assert.equal(resolved.provisions[0].article, "제3조의2");
  assert.equal(resolved.provisions[0].text, "제3조의2(범위) ① 본문 1. 호 본문");
});
