import assert from "node:assert/strict";
import test from "node:test";
import { addManualField } from "../../lib/documents/field-regions.ts";
import { AnalysisStore } from "../../lib/documents/store.ts";
import type { DocumentField, DocumentReading, SearchResult } from "../../lib/documents/types.ts";

const image = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/nhsAAAAASUVORK5CYII=";
const box = { x: .1, y: .2, width: .4, height: .05 };
const recognized = { label: "신청인 성명", printedHint: "신청인", confidence: .9 };
const document = (fields: DocumentField[] = []): DocumentReading => ({ title: "가상 신청서", institution: "", formNumber: "", revision: "", readable: fields.length > 0, warnings: [], fields });
const search: SearchResult = { status: "completed", case: "photo_only", summary: "사진 기준", sources: [] };
const code = (expected: string) => (error: unknown) => error instanceof Error && "code" in error && error.code === expected;

test("selected crop recognition only receives the crop and printed document title", async () => {
  const store = new AnalysisStore();
  const saved = store.put(document(), search);
  const result = await addManualField(store, async (crop, title) => { assert.equal(crop, image); assert.equal(title, "가상 신청서"); return recognized; }, { analysisId: saved.id, box, image });
  assert.deepEqual(result.field.box, box);
  assert.equal(result.field.label, recognized.label);
  assert.equal(result.analysis.document.readable, true);
  store.delete(saved.id);
});

test("an expired crop request cannot recreate the analysis after recognition", async () => {
  const store = new AnalysisStore();
  const saved = store.put(document(), search);
  await assert.rejects(() => addManualField(store, async () => { store.delete(saved.id); return recognized; }, { analysisId: saved.id, box, image }), code("SESSION_EXPIRED"));
  assert.equal(store.get(saved.id), undefined);
});

test("a competing region change rejects a late crop result", async () => {
  const store = new AnalysisStore();
  const field = { ...recognized, id: "name", box };
  const saved = store.put(document([field]), search);
  await assert.rejects(() => addManualField(store, async () => { store.updateField(saved.id, "name", { ...box, y: .3 }); return recognized; }, { analysisId: saved.id, box, image }), code("REGION_CONFLICT"));
  assert.equal(store.get(saved.id)?.analysis.document.fields.length, 1);
  store.delete(saved.id);
});

test("cancelled crop requests never start recognition or store a late result", async () => {
  const store = new AnalysisStore();
  const saved = store.put(document(), search);
  const before = new AbortController(); before.abort();
  let calls = 0;
  await assert.rejects(() => addManualField(store, async () => { calls++; return recognized; }, { analysisId: saved.id, box, image }, before.signal), code("CANCELLED"));
  assert.equal(calls, 0);
  const during = new AbortController();
  await assert.rejects(() => addManualField(store, async () => { during.abort(); return recognized; }, { analysisId: saved.id, box, image }, during.signal), code("CANCELLED"));
  assert.equal(store.get(saved.id)?.analysis.document.fields.length, 0);
  store.delete(saved.id);
});

test("invalid crop images and full analyses fail before spending a model request", async () => {
  const store = new AnalysisStore();
  const saved = store.put(document(), search);
  let calls = 0;
  const recognize = async () => { calls++; return recognized; };
  await assert.rejects(() => addManualField(store, recognize, { analysisId: saved.id, box, image: "https://untrusted.example/image.png" }), code("INVALID_IMAGE"));
  store.delete(saved.id);
  const full = store.put(document(Array.from({ length: 80 }, (_, i) => ({ ...recognized, id: `field_${i}`, box }))), search);
  await assert.rejects(() => addManualField(store, recognize, { analysisId: full.id, box, image }), code("FIELD_LIMIT"));
  assert.equal(calls, 0);
  store.delete(full.id);
});
