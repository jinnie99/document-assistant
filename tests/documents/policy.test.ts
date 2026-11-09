import test from "node:test";
import assert from "node:assert/strict";
import { resolveProvenance, resolveSearch, sanitizeSearchMetadata } from "../../lib/documents/policy.ts";
import type { AnalysisResult, DocumentReading, DocumentSource } from "../../lib/documents/types.ts";

const reading: DocumentReading = { title: "상담 신청서", institution: "한칸시", formNumber: "제1호", revision: "2026.01", readable: true, warnings: [], fields: [{ id: "name", label: "신청인 이름", box: { x: 0, y: 0, width: 1, height: 0.1 }, confidence: 0.9, printedHint: "홍길동 010-1234-5678" }] };
const source = (patch: Partial<DocumentSource> = {}): DocumentSource => ({ id: "form-1", title: "상담 신청서", url: "https://example.go.kr/form", kind: "form", official: true, sameForm: true, titleMatches: true, institutionMatches: true, revisionMatches: true, fieldIds: [], evidence: "한칸시 상담 신청서 제1호 2026.01", guidance: [], ...patch });
const resolve = (sources: DocumentSource[], urls = sources.map((s) => s.url), doc = reading) => resolveSearch(doc, { summary: "모델의 검색 요약", sources }, urls);

test("확인된 양식·작성 안내·사진만의 세 분기를 계산한다", () => {
  assert.equal(resolve([]).case, "photo_only");
  assert.equal(resolve([source()]).case, "form_only");
  const guide = source({ id: "guide-1", kind: "guide", fieldIds: ["name"], guidance: [{ fieldId: "name", text: "신청인의 성명을 기재합니다." }] });
  assert.equal(resolve([source(), guide]).case, "form_and_guide");
  assert.equal(resolve([guide]).case, "form_and_guide");
});

test("제목만 같은 서류·다른 판본·비공식·미조회 URL은 근거로 승격하지 않는다", () => {
  for (const patch of [{ sameForm: false }, { institutionMatches: false }, { titleMatches: false }, { revisionMatches: false }, { official: false }]) {
    assert.equal(resolve([source(patch)]).case, "photo_only");
  }
  assert.equal(resolve([source()], []).case, "photo_only");
  assert.equal(resolve([source()], undefined, { ...reading, institution: "" }).case, "photo_only");
  assert.equal(resolve([source({ revisionMatches: false })], undefined, { ...reading, revision: "" }).case, "form_only");
});

const commonReading: DocumentReading = { ...reading, title: "가족관계 등록사항별 증명서 교부 등 신청서", institution: "", formNumber: "[별지 제11호 서식]", fields: [...reading.fields, { ...reading.fields[0], id: "address", label: "등록기준지" }] };
const commonSource = () => ({ ...source(), title: commonReading.title, institutionMatches: false, matchedFormNumber: "서식 제11호", matchedFieldLabels: ["신청인 이름", "등록기준지"], evidence: "정부 원문에서 전국 공통 제11호 양식과 성명·등록기준지 항목을 확인했습니다." });

test("기관명이 없는 공통 서식은 정부 원문의 서식번호와 두 항목 확인으로 제한해 허용한다", () => {
  for (const matchedFormNumber of ["서식 제11호", "제 11 호 서식", "별지 제11호서식", "[별지 제１１호 서식]"]) {
    const verified = { ...commonSource(), matchedFormNumber, matchedFieldLabels: ["신청인  이름", "등록 기준지"] };
    assert.equal(resolve([verified], undefined, commonReading).case, "form_only");
  }
  const guide = { ...commonSource(), kind: "guide" as const, fieldIds: ["name"], guidance: [{ fieldId: "name", text: "발급대상자의 성명을 적습니다." }] };
  assert.equal(resolve([guide], undefined, commonReading).case, "form_and_guide");
});

test("기관 없는 서식 예외도 번호·항목·HTTPS 정부 원문·판본 근거가 부족하면 거부한다", () => {
  const valid = commonSource();
  const rejected = [
    { ...valid, matchedFormNumber: "제1호" }, { ...valid, matchedFormNumber: "제11-1호" },
    { ...valid, matchedFormNumber: "" }, { ...valid, matchedFieldLabels: ["신청인 이름"] },
    { ...valid, matchedFieldLabels: ["신청인 이름", "신청인  이름"] },
    { ...valid, matchedFieldLabels: ["없는 칸", "등록기준지"] },
    { ...valid, url: "http://example.go.kr/form" }, { ...valid, url: "https://example.go.kr.attacker.example/form" },
    { ...valid, url: "https://example.com/form" }, { ...valid, official: false },
    { ...valid, sameForm: false }, { ...valid, titleMatches: false }, { ...valid, revisionMatches: false },
    { ...valid, evidence: "" },
  ];
  for (const item of rejected) assert.equal(resolve([item], undefined, commonReading).case, "photo_only", JSON.stringify(item));
  assert.equal(resolve([valid], [], commonReading).case, "photo_only");
  for (const patch of [{ title: "" }, { formNumber: "" }, { fields: [commonReading.fields[0]] }]) {
    assert.equal(resolve([valid], undefined, { ...commonReading, ...patch }).case, "photo_only");
  }
  assert.equal(resolve([valid], undefined, { ...commonReading, institution: "기관이 인쇄됨" }).case, "photo_only");
});

test("실제 조회한 같은 페이지의 fragment는 허용하고 경로·쿼리는 정확히 확인한다", () => {
  assert.equal(resolve([source({ url: "https://example.go.kr/form#name" })], ["https://example.go.kr/form"]).case, "form_only");
  assert.equal(resolve([source()], ["https://example.go.kr/different"]).case, "photo_only");
  assert.equal(resolve([source()], ["https://example.go.kr/form?revision=old"]).case, "photo_only");
});

test("검색 장애는 검색 완료 뒤 미발견과 다른 상태로 반환한다", () => {
  const result = resolveSearch(reading, { summary: "찾았어요", sources: [source()] }, [source().url], "unavailable");
  assert.equal(result.status, "unavailable"); assert.equal(result.case, "photo_only");
  assert.deepEqual(result.sources, []); assert.notEqual(result.summary, "찾았어요");
  assert.equal(resolve([]).status, "completed");
});

test("공식 안내는 해당 칸을 뒷받침할 때만 붙이고 가짜 출처는 제거한다", () => {
  const form = source();
  const guide = source({ id: "guide-1", kind: "guide", url: "https://example.go.kr/guide", fieldIds: ["name"], guidance: [{ fieldId: "name", text: "신청인의 성명을 기재합니다." }] });
  const analysis: AnalysisResult = { id: "test", document: reading, search: resolve([form, guide]), expiresAt: "2099-01-01T00:00:00Z" };
  assert.deepEqual(resolveProvenance(analysis, "name", [guide.id, "invented"]), { provenance: "official_guide", sourceIds: [guide.id] });
  assert.deepEqual(resolveProvenance(analysis, "name", [form.id]), { provenance: "form_context", sourceIds: [form.id] });
  assert.deepEqual(resolveProvenance(analysis, "name", ["invented"]), { provenance: "photo_inference", sourceIds: [] });
  assert.deepEqual(resolveProvenance(analysis, "phone", [guide.id]), { provenance: "photo_inference", sourceIds: [] });
  const withPhone: AnalysisResult = { ...analysis, document: { ...reading, fields: [...reading.fields, { ...reading.fields[0], id: "phone", label: "연락처" }] } };
  assert.deepEqual(resolveProvenance(withPhone, "phone", [guide.id]), { provenance: "form_context", sourceIds: [guide.id] });
});

test("서류 동일성 요약과 fieldIds만 있고 작성 지침 본문이 없으면 양식 근거로 낮춘다", () => {
  const withoutText = source({ id: "guide-1", kind: "guide", fieldIds: ["name"], guidance: [] });
  const result = resolve([withoutText]);
  assert.equal(result.case, "form_only");
  assert.equal(result.sources[0].kind, "form");
  const analysis: AnalysisResult = { id: "test", document: reading, search: result, expiresAt: "2099-01-01T00:00:00Z" };
  assert.deepEqual(resolveProvenance(analysis, "name", [withoutText.id]), { provenance: "form_context", sourceIds: [withoutText.id] });
  const forgedGuide = { ...analysis, search: { ...result, sources: [withoutText] } };
  assert.equal(resolveProvenance(forgedGuide, "name", [withoutText.id]).provenance, "form_context");
});

test("서식 안에 포함된 실제 작성 요령도 해당 칸의 공식 지침으로 사용한다", () => {
  const embedded = source({ fieldIds: ["name"], guidance: [{ fieldId: "name", text: "성명은 가족관계등록부의 한글 성명으로 기재합니다." }] });
  const result = resolve([embedded]);
  assert.equal(result.case, "form_and_guide");
  const analysis: AnalysisResult = { id: "test", document: reading, search: result, expiresAt: "2099-01-01T00:00:00Z" };
  assert.deepEqual(resolveProvenance(analysis, "name", [embedded.id]), { provenance: "official_guide", sourceIds: [embedded.id] });
});

test("사진에 없는 칸이나 근거 항목과 불일치한 작성 지침을 버린다", () => {
  const guide = source({ kind: "guide", fieldIds: ["name", "missing"], guidance: [{ fieldId: "name", text: "이름을 적으세요." }, { fieldId: "missing", text: "없는 항목 안내" }] });
  const result = resolve([guide]);
  assert.equal(result.case, "form_and_guide");
  assert.deepEqual(result.sources[0].guidance, [{ fieldId: "name", text: "이름을 적으세요." }]);
  assert.deepEqual(result.sources[0].fieldIds, ["name"]);
  assert.equal(resolve([source({ kind: "guide", fieldIds: [], guidance: [{ fieldId: "name", text: "이름을 적으세요." }] })]).case, "form_only");
  assert.equal(resolve([source({ kind: "guide", fieldIds: ["name"], guidance: [{ fieldId: "name", text: " " }] })]).case, "form_only");
});

test("검색 메타데이터에 입력값·인쇄 힌트·연락처를 보내지 않는다", () => {
  const clean = sanitizeSearchMetadata({ ...reading, title: "상담 신청서 010-1234-5678 계좌 123-456789-12345", institution: "한칸시 name@example.com", formNumber: "제1호 900101-1234567" });
  assert.deepEqual(Object.keys(clean).sort(), ["title", "institution", "formNumber", "revision", "fieldLabels"].sort());
  assert.ok(!JSON.stringify(clean).includes("010-1234"));
  assert.ok(!JSON.stringify(clean).includes("name@example.com"));
  assert.ok(!JSON.stringify(clean).includes("900101"));
  assert.ok(!JSON.stringify(clean).includes("456789"));
  assert.ok(!JSON.stringify(clean).includes("홍길동"));
  assert.deepEqual(clean.fieldLabels, ["신청인 이름"]);
});
