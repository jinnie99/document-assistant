import assert from "node:assert/strict";
import test from "node:test";
import { AnalysisStore } from "../../lib/documents/store.ts";
import type { Box, DocumentField, DocumentReading, FieldGuidance, SearchResult } from "../../lib/documents/types.ts";

const box: Box = { x: .2, y: .3, width: .4, height: .05 };
const field = (id = "name"): DocumentField => ({ id, label: "신청인 성명", printedHint: "신청인", confidence: .9, box: { x: .1, y: .2, width: .3, height: .04 } });
const document = (fields = [field()]): DocumentReading => ({ title: "가상 신청서", institution: "", formNumber: "", revision: "", readable: fields.length > 0, fields, warnings: [] });
const search: SearchResult = { status: "completed", case: "photo_only", summary: "사진 기준", sources: [] };
const guidance: FieldGuidance = { fieldId: "name", explanation: "신청인 이름을 적으세요.", example: "예: 김가람", check: "신청인 구역을 확인하세요.", provenance: "photo_inference", sourceIds: [], question: null };
const code = (expected: string) => (error: unknown) => error instanceof Error && "code" in error && error.code === expected;

test("manual region edit keeps the field identity and TTL while invalidating old guidance", () => {
  const store = new AnalysisStore(1000, 2, () => 0);
  const saved = store.put(document(), search);
  const before = store.get(saved.id)!;
  before.guides.set("old", guidance);
  before.questions.set("name", new Map());
  const result = store.updateField(saved.id, "name", box);
  assert.equal(result.field.id, "name");
  assert.deepEqual(result.field.box, box);
  assert.equal(result.analysis.id, saved.id);
  assert.equal(result.analysis.expiresAt, saved.expiresAt);
  assert.equal(store.get(saved.id)?.guides.size, 0);
  assert.equal(store.get(saved.id)?.questions.size, 0);
  assert.equal(store.get(saved.id)?.version, 1);
});

test("unknown and expired corrections do not create or revive a session", () => {
  let now = 0;
  const store = new AnalysisStore(100, 2, () => now);
  const saved = store.put(document(), search);
  assert.throws(() => store.updateField(saved.id, "missing", box), code("UNKNOWN_FIELD"));
  now = 100;
  assert.throws(() => store.updateField(saved.id, "name", box), code("SESSION_EXPIRED"));
  assert.equal(store.get(saved.id), undefined);
});

test("manual additions preserve the user region and can recover an empty reading", () => {
  const store = new AnalysisStore(1000, 2, () => 0);
  const saved = store.put(document([]), search);
  const result = store.addField(saved.id, { label: "신청인 성명", printedHint: "신청인", confidence: .85 }, box, 0);
  assert.match(result.field.id, /^manual_[a-zA-Z0-9_-]+$/);
  assert.ok(result.field.id.length <= 64);
  assert.deepEqual(result.field.box, box);
  assert.equal(result.analysis.document.readable, true);
  assert.equal(result.analysis.document.fields.length, 1);
  assert.equal(result.analysis.search.case, "photo_only");
  assert.deepEqual(result.analysis.search.sources, []);
});

test("pending additions cannot overwrite a changed or deleted analysis", () => {
  const store = new AnalysisStore(1000, 2, () => 0);
  const saved = store.put(document(), search);
  store.updateField(saved.id, "name", box);
  assert.throws(() => store.addField(saved.id, { label: "주소", printedHint: "", confidence: .9 }, box, 0), code("REGION_CONFLICT"));
  store.delete(saved.id);
  assert.throws(() => store.addField(saved.id, { label: "주소", printedHint: "", confidence: .9 }, box, 1), code("SESSION_EXPIRED"));
  assert.equal(store.get(saved.id), undefined);
});

test("a corrected field rejects guidance completed against an older document version", () => {
  const store = new AnalysisStore(1000, 2, () => 0);
  const saved = store.put(document(), search);
  store.updateField(saved.id, "name", box);
  assert.throws(() => store.saveGuide(saved.id, 0, "old", guidance), code("REGION_CONFLICT"));
  assert.equal(store.get(saved.id)?.guides.size, 0);
  assert.deepEqual(store.saveGuide(saved.id, 1, "new", guidance), guidance);
  store.delete(saved.id);
  assert.throws(() => store.saveGuide(saved.id, 1, "late", guidance), code("SESSION_EXPIRED"));
});

test("manual additions reject the field limit without modifying existing data", () => {
  const store = new AnalysisStore(1000, 2, () => 0);
  const saved = store.put(document(Array.from({ length: 80 }, (_, index) => field(`field_${index}`))), search);
  assert.throws(() => store.addField(saved.id, { label: "주소", printedHint: "", confidence: .9 }, box, 0), code("FIELD_LIMIT"));
  assert.equal(store.get(saved.id)?.analysis.document.fields.length, 80);
});
