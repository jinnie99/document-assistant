import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { parseGuidance, parseIdentity, parseReading, parseSearchReport, validateImage } from "../../lib/documents/validation.ts";
import { GUIDE_SCHEMA, IDENTITY_SCHEMA, SEARCH_SCHEMA, TABLE_VISION_SCHEMA, VISION_SCHEMA } from "../../lib/documents/schemas.ts";

const reading = () => ({
  title: "상담 신청서", institution: "한칸시", formNumber: "제1호", revision: "2026.01",
  readable: true, warnings: [],
  fields: [{ id: "name", label: "신청인 이름", box: { x: 0.1, y: 0.2, width: 0.6, height: 0.1 }, confidence: 0.9, printedHint: "" }],
});
const guidance = () => ({ fieldId: "name", explanation: "신청하는 분의 이름을 적어요.", example: "홍길동 (가상)", check: "서류의 안내도 확인해요.", provenance: "photo_inference", sourceIds: [], question: null });
const source = () => ({ id: "source-1", title: "상담 신청서 안내", url: "https://example.go.kr/forms/1", kind: "guide", official: true, sameForm: true, titleMatches: true, institutionMatches: true, revisionMatches: true, fieldIds: ["name"], evidence: "한칸시 상담 신청서 제1호 2026.01", guidance: [{ fieldId: "name", text: "신청인의 성명을 기재합니다." }] });

test("빠른 서류 확인은 짧고 정확한 구조만 허용하고 읽지 못한 목적은 비운다", () => {
  const identity = { title: "상담 신청서", institution: "한칸시", formNumber: "", revision: "", description: "상담을 신청하는 서류예요.", readable: true };
  assert.deepEqual(parseIdentity(identity), identity);
  assert.equal(parseIdentity({ ...identity, readable: false }).description, "");
  for (const patch of [{ description: null }, { description: "가".repeat(201) }, { title: 3 }, { fields: [] }, { readable: "true" }]) {
    assert.throws(() => parseIdentity({ ...identity, ...patch }));
  }
  assert.throws(() => parseIdentity({ ...identity, readable: false, description: null }));
});

test("부분 재확인의 추가 항목 0개는 명시한 옵션에서만 허용한다", () => {
  const empty = { ...reading(), fields: [] };
  assert.throws(() => parseReading(empty));
  assert.deepEqual(parseReading(empty, { allowEmptyFields: true }), empty);
});

test("문서 판독 결과의 좌표와 필드 구조를 검증한다", () => {
  assert.deepEqual(parseReading(reading()), reading());
  const bad = reading(); bad.fields[0].box.width = 0.95;
  assert.throws(() => parseReading(bad));
  bad.fields[0].box.width = 0; assert.throws(() => parseReading(bad));
  bad.fields[0].box.width = 0.6; bad.fields[0].confidence = Number.NaN;
  assert.throws(() => parseReading(bad));
});

test("중복 필드·과도한 필드·판독 가능한데 항목이 없는 응답을 거부한다", () => {
  const duplicate = reading(); duplicate.fields.push({ ...duplicate.fields[0] });
  assert.throws(() => parseReading(duplicate));
  const excessive = reading(); excessive.fields = Array.from({ length: 81 }, (_, i) => ({ ...excessive.fields[0], id: `field-${i}` }));
  assert.throws(() => parseReading(excessive));
  assert.throws(() => parseReading({ ...reading(), fields: [] }));
  assert.deepEqual(parseReading({ ...reading(), readable: false, fields: [] }).fields, []);
});

test("복잡한 서류의 25번째부터 80번째 빈칸까지 보존한다", () => {
  const document = reading();
  document.fields = Array.from({ length: 80 }, (_, i) => ({ ...document.fields[0], id: `field-${i}` }));
  assert.equal(parseReading(document).fields.length, 80);
});

test("검색 결과의 출처 ID·URL·필드 구조를 검증한다", () => {
  assert.equal(parseSearchReport({ summary: "검색 결과", sources: [source()] }).sources[0].kind, "guide");
  assert.throws(() => parseSearchReport({ summary: "검색 결과", sources: [source(), source()] }));
  assert.throws(() => parseSearchReport({ summary: "검색 결과", sources: [{ ...source(), url: "javascript:alert(1)" }] }));
  assert.throws(() => parseSearchReport({ summary: "검색 결과", sources: [{ ...source(), url: "https://user:secret@example.go.kr/" }] }));
});

test("공통 서식 대조 값은 검증하며 구형 검색 응답의 누락 값은 빈값으로 보존한다", () => {
  const legacy = parseSearchReport({ summary: "검색 결과", sources: [source()] }).sources[0];
  assert.equal(legacy.matchedFormNumber, "");
  assert.deepEqual(legacy.matchedFieldLabels, []);
  const extended = { ...source(), matchedFormNumber: " 제11호 서식 ", matchedFieldLabels: [" 성명 ", "등록기준지"] };
  const parsed = parseSearchReport({ summary: "검색 결과", sources: [extended] }).sources[0];
  assert.equal(parsed.matchedFormNumber, "제11호 서식");
  assert.deepEqual(parsed.matchedFieldLabels, ["성명", "등록기준지"]);
  for (const patch of [{ matchedFormNumber: null }, { matchedFormNumber: "가".repeat(101) }, { matchedFieldLabels: null }, { matchedFieldLabels: [""] }, { matchedFieldLabels: ["가".repeat(81)] }, { matchedFieldLabels: Array.from({ length: 81 }, (_, i) => `항목${i}`) }, { unexpected: "임의 속성" }]) {
    assert.throws(() => parseSearchReport({ summary: "검색 결과", sources: [{ ...extended, ...patch }] }));
  }
});

test("칸별 공식 작성 지침은 필드 ID와 비어 있지 않은 500자 이내 내용으로 검증한다", () => {
  assert.deepEqual(parseSearchReport({ summary: "작성 안내", sources: [source()] }).sources[0].guidance, source().guidance);
  for (const guidance of [[{ fieldId: "name", text: " " }], [{ fieldId: "name", text: "가".repeat(501) }], [{ fieldId: "", text: "이름을 적으세요." }], [source().guidance[0], source().guidance[0]]]) {
    assert.throws(() => parseSearchReport({ summary: "작성 안내", sources: [{ ...source(), guidance }] }));
  }
  assert.throws(() => parseSearchReport({ summary: "작성 안내", sources: [{ ...source(), guidance: Array.from({ length: 81 }, (_, i) => ({ fieldId: `field-${i}`, text: "작성 지침" })) }] }));
});

test("칸 안내는 요청한 필드에 한정하고 질문에는 모름 선택지를 둔다", () => {
  assert.deepEqual(parseGuidance(guidance(), "name"), guidance());
  assert.throws(() => parseGuidance(guidance(), "phone"));
  const question = { id: "visit", text: "오늘 어떤 일을 보러 오셨나요?", choices: [{ id: "self", label: "제 일로 왔어요" }, { id: "other", label: "다른 분 일을 도와드리러 왔어요" }, { id: "unknown", label: "잘 모르겠어요" }] };
  assert.equal(parseGuidance({ ...guidance(), question }, "name").question?.choices.length, 3);
  assert.throws(() => parseGuidance({ ...guidance(), question: { ...question, choices: question.choices.slice(0, 2) } }, "name"));
  assert.throws(() => parseGuidance({ ...guidance(), question: { ...question, choices: [{ id: "self", label: "본인" }, { id: "other", label: "다른 분" }, { id: "third", label: "직원" }] } }, "name"));
  assert.throws(() => parseGuidance({ ...guidance(), question: { ...question, choices: [question.choices[0], question.choices[0], question.choices[2]] } }, "name"));
});

test("이미지의 base64·실제 형식·6MB 상한을 확인한다", () => {
  const png = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jRZkAAAAASUVORK5CYII=";
  assert.equal(validateImage(png), png);
  assert.throws(() => validateImage(png.replace("image/png", "image/jpeg")));
  assert.throws(() => validateImage("data:image/png;base64," + Buffer.from("not an image").toString("base64")));
  assert.throws(() => validateImage(png + "!"));
  const oversized = Buffer.alloc(6 * 1024 * 1024 + 1); oversized.set([137, 80, 78, 71, 13, 10, 26, 10]);
  assert.throws(() => validateImage("data:image/png;base64," + oversized.toString("base64")));
});

test("잘린 이미지 헤더와 과도한 픽셀 크기를 공급자 호출 전에 거부한다", () => {
  assert.throws(() => validateImage("data:image/png;base64," + Buffer.from([137,80,78,71,13,10,26,10]).toString("base64")));
  assert.throws(() => validateImage("data:image/jpeg;base64," + Buffer.from([255,216,255]).toString("base64")));
  const png = readFileSync(new URL("../fixtures/fictional-form.png", import.meta.url));
  const jpeg = readFileSync(new URL("../fixtures/fictional-form.jpg", import.meta.url));
  assert.equal(validateImage("data:image/jpeg;base64," + jpeg.toString("base64")).slice(0, 23), "data:image/jpeg;base64,");
  assert.throws(() => validateImage("data:image/png;base64," + png.subarray(0, png.length - 12).toString("base64")));
  const huge = Buffer.from(png); huge.writeUInt32BE(100000, 16); huge.writeUInt32BE(100000, 20);
  assert.throws(() => validateImage("data:image/png;base64," + huge.toString("base64")));
});

test("Responses strict JSON schema는 모든 객체 속성을 필수로 선언한다", () => {
  function inspect(value: unknown): void {
    if (!value || typeof value !== "object") return;
    const schema = value as Record<string, unknown>;
    if (schema.type === "object") {
      assert.equal(schema.additionalProperties, false);
      assert.deepEqual([...(schema.required as string[])].sort(), Object.keys(schema.properties as object).sort());
    }
    for (const child of Object.values(schema)) {
      if (Array.isArray(child)) child.forEach(inspect); else inspect(child);
    }
  }
  [IDENTITY_SCHEMA, VISION_SCHEMA, TABLE_VISION_SCHEMA, SEARCH_SCHEMA, GUIDE_SCHEMA].forEach(inspect);
});
