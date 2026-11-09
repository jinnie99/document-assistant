import assert from "node:assert/strict";
import test from "node:test";
import { AnalysisStore } from "../../lib/documents/store.ts";
import * as analysisStorage from "../../lib/documents/store.ts";
import type { DocumentReading, SearchResult } from "../../lib/documents/types.ts";
import type { LegalCandidate, LegalContext } from "../../lib/legal/types.ts";

const document: DocumentReading = { title: "가상 신청서", institution: "가상기관", formNumber: "", revision: "", readable: true, warnings: [], fields: [] };
const search: SearchResult = { status: "completed", case: "photo_only", summary: "사진 기준", sources: [] };
const legalCandidate: LegalCandidate = { id: "administrative_rule:10", serialNumber: "10", kind: "administrative_rule", name: "가상 처리지침", category: "고시", authority: "가상부", promulgationNumber: "제10호", promulgationDate: "2026-01-01", effectiveDate: "2026-02-01", status: "current", apiTarget: "admrul" };
const legalContext = (status: LegalContext["status"] = "ambiguous"): LegalContext => ({ status, detectedReferences: [{ name: legalCandidate.name, kind: legalCandidate.kind }], candidates: [legalCandidate], canonicalRule: status === "completed" ? legalCandidate : null, hierarchy: { act: null, decree: null, rule: null, administrativeRules: [] }, provisions: [], forms: [], authority: "", procedure: null, summary: "", sources: [], warnings: [], retrievedAt: "2026-11-09T00:00:00.000Z", stale: false });

test("temporary analysis expires without retaining stale records", () => {
  let now = 1000;
  const store = new AnalysisStore(100, 2, () => now);
  const saved = store.put(document, search);
  assert.equal(store.get(saved.id)?.analysis.document.title, document.title);
  now = 1100;
  assert.equal(store.get(saved.id), undefined);
});

test("bounded analysis store evicts the oldest result and issues distinct opaque IDs", () => {
  const store = new AnalysisStore(100, 2, () => 0);
  const first = store.put(document, search), second = store.put(document, search), third = store.put(document, search);
  assert.notEqual(first.id, second.id);
  assert.ok(third.id.length >= 32);
  assert.equal(store.get(first.id), undefined);
  assert.ok(store.get(second.id));
  store.delete(second.id);
  assert.equal(store.get(second.id), undefined);
});

test("search enrichment preserves current manual fields, questions, guides and field version", () => {
  const store = new AnalysisStore();
  const field = { id: "name", label: "성명", box: { x: .1, y: .2, width: .4, height: .05 }, confidence: .9, printedHint: "신청인" };
  const saved = store.put({ ...document, fields: [field] }, { ...search, status: "pending" });
  store.updateField(saved.id, field.id, { ...field.box, y: .3 });
  store.addField(saved.id, { label: "주소", printedHint: "신청인", confidence: .9 }, { ...field.box, y: .4 }, 1);
  const question = { id: "visit", text: "본인 일을 보러 오셨나요?", choices: [{ id: "self", label: "네" }, { id: "other", label: "다른 분 일이에요" }, { id: "unknown", label: "잘 모르겠어요" }] };
  const guide = { fieldId: "name", explanation: "이름을 적어요.", example: "", check: "", provenance: "photo_inference" as const, sourceIds: [], question };
  store.saveGuide(saved.id, 2, "pending:guide", guide);
  const enriched = store.updateSearch(saved.id, search);
  assert.equal(enriched.search.status, "completed");
  assert.equal(enriched.document.fields[0].box.y, .3);
  assert.equal(enriched.document.fields.length, 2);
  assert.equal(store.get(saved.id)?.version, 2);
  assert.equal(store.get(saved.id)?.questions.get("name")?.get("visit"), question);
  assert.equal(store.get(saved.id)?.guides.get("pending:guide"), guide);
  assert.equal(store.saveGuide(saved.id, 2, "pending:late-guide", guide), guide);
  store.delete(saved.id);
});

test("late search enrichment cannot recreate deleted or expired sessions", () => {
  let now = 0;
  const store = new AnalysisStore(100, 4, () => now);
  const removed = store.put(document, search);
  store.delete(removed.id);
  assert.throws(() => store.updateSearch(removed.id, search), error => error instanceof Error && "code" in error && error.code === "SESSION_EXPIRED");
  const expired = store.put(document, search);
  now = 100;
  assert.throws(() => store.updateSearch(expired.id, search), error => error instanceof Error && "code" in error && error.code === "SESSION_EXPIRED");
  assert.equal(store.get(removed.id), undefined);
  assert.equal(store.get(expired.id), undefined);
});

test("guide cache separates pending and completed evidence while normalizing answer order", () => {
  assert.equal(typeof analysisStorage.guideCacheKey, "function");
  const entries: [string, string][] = [["b", "other"], ["a", "self"]];
  const pending = analysisStorage.guideCacheKey("pending", "name", entries);
  const complete = analysisStorage.guideCacheKey("completed", "name", [...entries].reverse());
  assert.notEqual(pending, complete);
  assert.equal(analysisStorage.guideCacheKey("pending", "name", [...entries].reverse()), pending);
  assert.equal(complete.startsWith("completed:"), true);
});

test("progressive readings append new identities without changing published fields, manual edits or guides", () => {
  const store = new AnalysisStore(1000, 2, () => 0);
  const field = { id: "name", label: "성명", box: { x: .1, y: .2, width: .4, height: .05 }, confidence: .9, printedHint: "신청인" };
  const saved = store.put({ ...document, fields: [field] }, { ...search, status: "pending" });
  const edited = store.updateField(saved.id, field.id, { ...field.box, y: .3 }).field;
  const manual = store.addField(saved.id, { label: "주소", printedHint: "", confidence: .9 }, { ...field.box, y: .4 }, 1).field;
  const question = { id: "visit", text: "본인 일을 보러 오셨나요?", choices: [{ id: "self", label: "네" }] };
  const guide = { fieldId: field.id, explanation: "이름을 적어요.", example: "", check: "", provenance: "photo_inference" as const, sourceIds: [], question };
  store.saveGuide(saved.id, 2, "pending:guide", guide);
  const newField = { ...field, id: "phone", label: "전화번호" };
  const appended = store.appendReading(saved.id, { ...document, title: "확인한 신청서", warnings: ["인쇄가 흐려요."], fields: [{ ...field, label: "뒤늦은 이름", box: { ...field.box, y: .5 } }, newField, newField] }, "in_progress");
  assert.deepEqual(appended.document.fields.map(item => item.id), [field.id, manual.id, newField.id]);
  assert.equal(appended.document.fields[0], edited);
  assert.equal(appended.document.fields[1], manual);
  assert.equal(appended.document.fields[2], newField);
  assert.equal(appended.document.title, "확인한 신청서");
  assert.deepEqual(appended.document.warnings, ["인쇄가 흐려요."]);
  assert.equal(appended.mappingStatus, "in_progress");
  assert.equal(appended.expiresAt, saved.expiresAt);
  assert.equal(store.get(saved.id)?.version, 2);
  assert.equal(store.get(saved.id)?.guides.get("pending:guide"), guide);
  assert.equal(store.get(saved.id)?.questions.get(field.id)?.get(question.id), question);
  assert.equal(store.saveGuide(saved.id, 2, "pending:late-guide", guide), guide);
  const completed = store.appendReading(saved.id, { ...document, fields: [newField, field] }, "completed");
  assert.deepEqual(completed.document.fields, appended.document.fields);
  assert.equal(completed.mappingStatus, "completed");
  store.delete(saved.id);
});

test("progressive append retains TTL and capacity and cannot revive expired, deleted or evicted sessions", () => {
  let now = 0;
  const store = new AnalysisStore(100, 2, () => now);
  const oldest = store.put(document, search);
  const deleted = store.put(document, search);
  store.delete(deleted.id);
  assert.throws(() => store.appendReading(deleted.id, document, "in_progress"), error => error instanceof Error && "code" in error && error.code === "SESSION_EXPIRED");
  now = 50;
  store.appendReading(oldest.id, document, "in_progress");
  const next = store.put(document, search);
  store.put(document, search);
  assert.equal(store.get(oldest.id), undefined);
  assert.throws(() => store.appendReading(oldest.id, document, "completed"), error => error instanceof Error && "code" in error && error.code === "SESSION_EXPIRED");
  now = 100;
  store.appendReading(next.id, document, "in_progress");
  now = 150;
  assert.throws(() => store.appendReading(next.id, document, "completed"), error => error instanceof Error && "code" in error && error.code === "SESSION_EXPIRED");
  assert.equal(store.get(deleted.id), undefined);
  assert.equal(store.get(next.id), undefined);
});

test("automatic append keeps the field bound when manual additions already occupy the remaining slots", () => {
  const store = new AnalysisStore();
  const field = { id: "field_0", label: "성명", box: { x: .1, y: .2, width: .4, height: .05 }, confidence: .9, printedHint: "" };
  const saved = store.put({ ...document, fields: Array.from({ length: 79 }, (_, index) => ({ ...field, id: `field_${index}` })) }, search);
  const manual = store.addField(saved.id, { label: "주소", printedHint: "", confidence: .9 }, field.box, 0).field;
  const appended = store.appendReading(saved.id, { ...document, fields: [{ ...field, id: "late" }] }, "completed");
  assert.equal(appended.document.fields.length, 80);
  assert.equal(appended.document.fields.at(-1), manual);
  store.delete(saved.id);
});

test("legal enrichment preserves document edits and candidate selection invalidates derived state", () => {
  const store = new AnalysisStore();
  const field = { id: "name", label: "성명", box: { x: .1, y: .2, width: .4, height: .05 }, confidence: .9, printedHint: "신청인" };
  const saved = store.put({ ...document, fields: [field] }, search);
  store.updateField(saved.id, field.id, { ...field.box, y: .3 });
  const enriched = store.updateLegal(saved.id, legalContext());
  assert.equal(enriched.document.fields[0].box.y, .3);
  assert.equal(enriched.legal?.status, "ambiguous");

  const selected = store.selectLegalCandidate(saved.id, legalCandidate.id);
  assert.equal(selected.candidate.id, legalCandidate.id);
  assert.equal(selected.analysis.legal?.status, "pending");
  assert.equal(selected.analysis.legal?.canonicalRule?.id, legalCandidate.id);
  assert.equal(store.get(saved.id)?.version, 2);
  assert.equal(selected.legalVersion, 1);

  const completed = store.updateLegal(saved.id, legalContext("completed"), selected.legalVersion);
  assert.equal(completed.legal?.status, "completed");
  assert.throws(() => store.updateLegal(saved.id, legalContext("completed"), 0), error => error instanceof Error && "code" in error && error.code === "LEGAL_CONTEXT_CONFLICT");
  store.delete(saved.id);
});

test("legal candidate selection rejects unknown, deleted, and expired sessions", () => {
  let now = 0;
  const store = new AnalysisStore(100, 2, () => now);
  const saved = store.put(document, search);
  store.updateLegal(saved.id, legalContext());
  assert.throws(() => store.selectLegalCandidate(saved.id, "administrative_rule:unknown"), error => error instanceof Error && "code" in error && error.code === "UNKNOWN_LEGAL_CANDIDATE");
  now = 100;
  assert.throws(() => store.selectLegalCandidate(saved.id, legalCandidate.id), error => error instanceof Error && "code" in error && error.code === "SESSION_EXPIRED");
  assert.equal(store.get(saved.id), undefined);
});
