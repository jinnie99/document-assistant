import assert from "node:assert/strict";
import test from "node:test";
import { buildLegalViewModel, pendingLegalContext } from "../../lib/legal/view-model.ts";
import type { LegalCandidate, LegalContext } from "../../lib/legal/types.ts";

const act: LegalCandidate = { id: "law:1", serialNumber: "1", kind: "law", name: "가상민원법", category: "법률", authority: "가상부", promulgationNumber: "법률 제1호", promulgationDate: "2026-01-01", effectiveDate: "2026-02-01", status: "current", apiTarget: "law" };
const rule: LegalCandidate = { id: "administrative_rule:9", serialNumber: "9", kind: "administrative_rule", name: "가상 신청서 작성 지침", category: "훈령", authority: "가상부", promulgationNumber: "제2026-9호", promulgationDate: "2026-03-01", effectiveDate: "2026-03-10", status: "current", apiTarget: "admrul" };

function completed(overrides: Partial<LegalContext> = {}): LegalContext {
  return {
    status: "completed",
    detectedReferences: [{ name: rule.name, kind: "administrative_rule", authority: "가상부", formNumber: "별지 제1호" }],
    candidates: [rule],
    canonicalRule: rule,
    hierarchy: { act: act, decree: null, rule: null, administrativeRules: [rule] },
    provisions: [{ id: "p1", lawName: act.name, article: "제5조", title: "신청", text: "신청서를 제출한다.", sourceIds: ["legal-law-1"] }],
    forms: [],
    authority: "가상부",
    procedure: { reception: "가상부 민원실", submission: "온라인", requiredItems: ["신분증"], fee: "1,000원", processingTime: "", contact: "", sourceIds: ["procedure-1"] },
    summary: "가상 신청서 작성 지침에 따른 안내입니다.",
    summarySourceIds: ["legal-law-1"],
    sources: [
      { id: "legal-law-1", title: act.name, url: "https://www.law.go.kr/법령/가상민원법", kind: "law", retrievedAt: "2026-11-09T00:00:00.000Z" },
      { id: "procedure-1", title: "민원 안내", url: "https://apply.gov.kr/guide", kind: "procedure", retrievedAt: "2026-11-09T00:00:00.000Z" },
    ],
    warnings: [],
    retrievedAt: "2026-11-09T00:00:00.000Z",
    stale: false,
    ...overrides,
  };
}

test("no legal context hides the panel", () => {
  assert.equal(buildLegalViewModel(undefined).state, "hidden");
});

test("pending context shows a waiting message without rows", () => {
  const model = buildLegalViewModel(pendingLegalContext());
  assert.equal(model.state, "pending");
  assert.equal(model.hierarchy.length, 0);
  assert.equal(model.procedure, null);
  assert.match(model.headline, /찾고 있어요/);
});

test("ambiguous context lists selectable candidates", () => {
  const model = buildLegalViewModel({ ...pendingLegalContext(), status: "ambiguous", candidates: [act, rule] });
  assert.equal(model.state, "ambiguous");
  assert.deepEqual(model.candidates.map(item => item.id), ["law:1", "administrative_rule:9"]);
  assert.ok(model.candidates.every(item => item.selectable));
  assert.match(model.headline, /골라/);
});

test("not found and unavailable states use distinct copy", () => {
  const notFound = buildLegalViewModel({ ...pendingLegalContext(), status: "not_found" });
  const unavailable = buildLegalViewModel({ ...pendingLegalContext(), status: "unavailable" });
  assert.equal(notFound.state, "not_found");
  assert.equal(unavailable.state, "unavailable");
  assert.notEqual(notFound.headline, unavailable.headline);
});

test("completed context exposes canonical name, hierarchy, procedure and grounded sources", () => {
  const model = buildLegalViewModel(completed());
  assert.equal(model.state, "completed");
  assert.equal(model.canonicalName, rule.name);
  assert.deepEqual(model.hierarchy.map(row => row.label), ["법률"]);
  assert.equal(model.hierarchy[0].value, "가상민원법 · 시행 2026-02-01");
  assert.deepEqual(model.administrativeRules.map(row => row.value.split(" · ")[0]), [rule.name]);
  assert.ok(model.procedure?.some(row => row.label === "수수료" && row.value === "1,000원"));
  assert.ok(!model.procedure?.some(row => row.label === "처리기간"), "empty procedure fields are hidden");
  assert.equal(model.summary, "가상 신청서 작성 지침에 따른 안내입니다.");
  assert.deepEqual(model.summarySourceIds, ["legal-law-1"]);
  assert.match(model.queryTime, /^2026\.11\.09 09:00 기준$/);
  assert.match(model.disclaimer, /서류 작성을 대신하지/);
});

test("stale data adds a notice instead of hiding rows", () => {
  const model = buildLegalViewModel(completed({ stale: true }));
  assert.ok(model.notices.some(notice => /마지막으로 확인/.test(notice)));
  assert.ok(model.hierarchy.length > 0);
});

test("form numbers and dates that match neither the canonical rule nor its dates raise an old-form mismatch", () => {
  const model = buildLegalViewModel(completed({ detectedReferences: [{ name: rule.name, kind: "administrative_rule", number: "제2019-1호", date: "2019-05-01" }] }));
  assert.equal(model.oldFormMismatch, true);
  assert.ok(model.notices.some(notice => /예전 서식|개정/.test(notice)));
});

test("a matching printed number does not raise a mismatch", () => {
  const model = buildLegalViewModel(completed({ detectedReferences: [{ name: rule.name, kind: "administrative_rule", number: rule.promulgationNumber }] }));
  assert.equal(model.oldFormMismatch, false);
});

test("missing three-tier relations are reported and the canonical rule still shows", () => {
  const model = buildLegalViewModel(completed({ hierarchy: { act: null, decree: null, rule: null, administrativeRules: [rule] } }));
  assert.equal(model.noThreeTier, true);
  assert.equal(model.hierarchy.length, 0);
  assert.equal(model.canonicalName, rule.name);
  assert.ok(model.notices.some(notice => /법률·시행령·시행규칙/.test(notice)));
});

test("missing official procedure keeps law rows and asks the user to confirm with the office", () => {
  const model = buildLegalViewModel(completed({ procedure: null }));
  assert.equal(model.procedureMissing, true);
  assert.equal(model.procedure, null);
  assert.ok(model.hierarchy.length > 0);
  assert.ok(model.notices.some(notice => /절차 안내를 찾지 못했어요/.test(notice)));
});

test("procedure sources are resolved to labelled links only when the source exists", () => {
  const model = buildLegalViewModel(completed({ sources: [{ id: "legal-law-1", title: act.name, url: "https://www.law.go.kr/법령/가상민원법", kind: "law", retrievedAt: "2026-11-09T00:00:00.000Z" }] }));
  assert.deepEqual(model.sources.map(item => item.label), ["법령 정본"]);
});

test("responsible office shows the ministry and the department when the API provides both", () => {
  const model = buildLegalViewModel(completed({ department: "교육부(교육안전정책과)" }));
  assert.deepEqual(model.office, [
    { label: "소관 기관", value: rule.authority },
    { label: "담당 부서", value: "교육부(교육안전정책과)" },
  ]);
});

test("responsible office omits the department row when only the ministry is known", () => {
  const model = buildLegalViewModel(completed({ department: "" }));
  assert.deepEqual(model.office.map(row => row.label), ["소관 기관"]);
});

test("responsible office falls back to a confirmation notice when nothing is known", () => {
  const model = buildLegalViewModel(completed({ authority: "", canonicalRule: { ...rule, authority: "" }, department: undefined }));
  assert.equal(model.office.length, 0);
  assert.ok(model.notices.some(notice => /소관 기관을 확인하지 못했어요/.test(notice)));
});

test("printed receiving office from the form is shown first, labelled as printed on the form", () => {
  const model = buildLegalViewModel(completed({ department: "", printedReceivingOffice: "한국전기안전공사사장 귀하" }));
  assert.deepEqual(model.office[0], { label: "서류에 적힌 수신처", value: "한국전기안전공사사장 귀하" });
  assert.equal(model.office.length, 2);
  assert.equal(model.notices.some(notice => /소관 기관을 확인하지 못했어요/.test(notice)), false);
});

test("printed receiving office alone still shows an office block for not-found laws", () => {
  const model = buildLegalViewModel({ ...pendingLegalContext(), status: "not_found", printedReceivingOffice: "한국전기안전공사사장 귀하" });
  assert.deepEqual(model.office, [{ label: "서류에 적힌 수신처", value: "한국전기안전공사사장 귀하" }]);
});

const formNo30 = { id: "form-30", title: "가상 신청서", url: "https://www.law.go.kr/LSW/flDownload.do?flSeq=1", sourceIds: ["legal-law-1"], label: "별지 제30호서식", revision: "신설 2021. 7. 21." };

test("header-only photo: form guide shows the current form download and flags a revision mismatch", () => {
  const model = buildLegalViewModel(completed({
    detectedReferences: [{ name: act.name, kind: "law", formNumber: "별지 제30호서식", date: "2016. 7. 28." }],
    forms: [formNo30],
    printedReceivingOffice: "한국전기안전공사사장 귀하",
  }));
  assert.ok(model.formGuide);
  assert.equal(model.formGuide.formLabel, "별지 제30호서식");
  assert.equal(model.formGuide.printedRevision, "2016-07-28");
  assert.equal(model.formGuide.currentRevision, "신설 2021. 7. 21.");
  assert.equal(model.formGuide.download?.url, formNo30.url);
  assert.equal(model.formGuide.revisionMismatch, true);
  assert.ok(model.notices.some(notice => /현행 별지 제30호서식/.test(notice)));
});

test("form guide reports no mismatch when the printed revision matches the current form", () => {
  const model = buildLegalViewModel(completed({
    detectedReferences: [{ name: act.name, kind: "law", formNumber: "별지 제30호서식", date: "2021. 7. 21." }],
    forms: [formNo30],
  }));
  assert.equal(model.formGuide?.revisionMismatch, false);
});

test("form guide links related articles that cite the form number, using official article URLs", () => {
  const model = buildLegalViewModel(completed({
    detectedReferences: [{ name: act.name, kind: "law", formNumber: "별지 제30호서식" }],
    forms: [formNo30],
    provisions: [
      { id: "p1", lawName: "전기사업법 시행규칙", article: "32", title: "정기검사", text: "정기검사는 별지 제30호서식에 따라 신청한다.", sourceIds: ["legal-law-1"] },
      { id: "p2", lawName: "전기사업법 시행규칙", article: "5", title: "목적", text: "다른 내용", sourceIds: ["legal-law-1"] },
    ],
  }));
  assert.deepEqual(model.formGuide?.articles.map(item => item.heading), ["전기사업법 시행규칙 제32조 (정기검사)"]);
  assert.ok(model.formGuide?.articles[0].url.startsWith("https://www.law.go.kr/법령/"));
  assert.ok(decodeURIComponent(model.formGuide?.articles[0].url ?? "").endsWith("/제32조"));
});

test("no form guide without a printed form number", () => {
  assert.equal(buildLegalViewModel(completed({ detectedReferences: [{ name: act.name, kind: "law" }] })).formGuide, null);
});

test("form guide names the current form so a download is not mistaken for the printed form", () => {
  const model = buildLegalViewModel(completed({ detectedReferences: [{ name: act.name, kind: "law", formNumber: "별지 제30호서식", date: "2016. 7. 28." }], forms: [formNo30] }));
  assert.equal(model.formGuide?.currentTitle, "가상 신청서");
  assert.equal(model.notices.filter(notice => /달라요/.test(notice)).length, 1);
});

const photoRefs = [{ name: "가상민원법", kind: "law" as const, formNumber: "별지 제30호서식", date: "2016. 7. 28." }];
const printedLaw = (over: Partial<LegalContext>) => completed({ canonicalRule: act, candidates: [act, rule], detectedReferences: photoRefs, ...over });

test("a different current form under the same number is never offered as the download", () => {
  const model = buildLegalViewModel(printedLaw({ forms: [{ ...formNo30, title: "자체 검사 결과보고서" }] }), { documentTitle: "정기검사 신청서" });
  assert.equal(model.formGuide?.differentForm, true);
  assert.equal(model.formGuide?.download, null);
  assert.equal(model.formGuide?.revisionMismatch, false);
  assert.ok(model.notices.some(notice => /정기검사 신청서.*다른 서식|다른 서식.*접수 기관/.test(notice)));
});

test("a renumbered form with the same title becomes the download", () => {
  const moved = { ...formNo30, id: "form-6", title: "정기검사 신청서", label: "별지 제6호서식", revision: "개정 2025. 10. 1.", url: "https://www.law.go.kr/LSW/flDownload.do?flSeq=6" };
  const model = buildLegalViewModel(printedLaw({ forms: [{ ...formNo30, title: "자체 검사 결과보고서" }, moved] }), { documentTitle: "정기검사 신청서" });
  assert.equal(model.formGuide?.download?.url, moved.url);
  assert.equal(model.formGuide?.download?.label, "현행 별지 제6호서식 내려받기");
});

test("articles printed on the form link to the verified law and flag repealed ones", () => {
  const model = buildLegalViewModel(printedLaw({
    forms: [formNo30],
    printedArticles: [{ lawName: "가상민원법", article: "제32조제5항" }, { lawName: "지어낸법", article: "제1조" }],
    provisions: [{ id: "p", lawName: "가상민원법", article: "제32조", title: "", text: "제32조 삭제 <2021.4.1>", sourceIds: ["legal-law-1"] }],
  }));
  assert.deepEqual(model.formGuide?.articles.map(item => [item.heading, item.note]), [["가상민원법 제32조제5항", "현행 법령에서 삭제된 조문이에요"]]);
  assert.ok(decodeURIComponent(model.formGuide?.articles[0].url ?? "").endsWith("/가상민원법/제32조"));
  assert.deepEqual(model.provisions.map(item => item.id), ["p"]);
});

test("completed law can still be changed and long rule lists are shortened", () => {
  const model = buildLegalViewModel(completed({ candidates: [act, rule], hierarchy: { act, decree: null, rule: null, administrativeRules: Array.from({ length: 5 }, (_, i) => ({ ...rule, id: `administrative_rule:${i}`, name: `규칙 ${i}` })) } }));
  assert.equal(model.candidates.length, 2);
  assert.equal(model.administrativeRules.length, 3);
  assert.equal(model.moreAdministrativeRules, 2);
});
