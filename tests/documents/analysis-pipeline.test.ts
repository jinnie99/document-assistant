import assert from "node:assert/strict";
import test from "node:test";
import { AnalysisStore } from "../../lib/documents/store.ts";
import { InputError } from "../../lib/documents/http.ts";
import type { AnalysisEvent, DocumentIdentity, DocumentReading, SearchResult } from "../../lib/documents/types.ts";
import type { LegalContext, LegalReferenceHints } from "../../lib/legal/types.ts";

const identity: DocumentIdentity = { title: "상담 신청서", institution: "가상기관", formNumber: "", revision: "", description: "상담을 신청하는 서류예요.", readable: true };
const document: DocumentReading = { title: identity.title, institution: identity.institution, formNumber: "", revision: "", readable: true, warnings: [], fields: [{ id: "name", label: "성명", box: { x: .1, y: .2, width: .4, height: .05 }, confidence: .9, printedHint: "신청인" }] };
const search: SearchResult = { status: "completed", case: "photo_only", summary: "사진 기준", sources: [] };
const hints: LegalReferenceHints = { references: [{ name: "가상 처리지침", kind: "administrative_rule" }] };
const legal: LegalContext = { status: "completed", detectedReferences: hints.references, candidates: [], canonicalRule: null, hierarchy: { act: null, decree: null, rule: null, administrativeRules: [] }, provisions: [], forms: [], authority: "", procedure: null, summary: "", sources: [], warnings: [], retrievedAt: "2026-11-09T00:00:00.000Z", stale: false };
const request = (signal?: AbortSignal) => new Request("http://localhost/api/documents/analyze", { signal });
function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}
function events(response: Response) {
  const reader = response.body!.getReader();
  return { reader, async next(): Promise<AnalysisEvent | undefined> {
    const part = await reader.read();
    return part.done ? undefined : JSON.parse(new TextDecoder().decode(part.value));
  } };
}
async function collect(next: () => Promise<AnalysisEvent | undefined>) {
  const result: AnalysisEvent[] = [];
  while (true) { const event = await next(); if (!event) return result; result.push(event); }
}
async function create(options: Record<string, unknown> = {}, req = request()) {
  const { createAnalysisStream } = await import("../../lib/documents/analysis-pipeline.ts");
  const store = new AnalysisStore();
  const response = createAnalysisStream(req, "image-only-in-memory", { store, readIdentity: async () => identity, readDocument: async () => document, searchDocument: async () => search, ...options });
  return { response, store };
}

test("quick identity arrives while detailed field mapping is still blocked", async () => {
  const mapping = deferred<DocumentReading>();
  let mappingStarted = false;
  const { response, store } = await create({ readDocument: () => { mappingStarted = true; return mapping.promise; } });
  const stream = events(response);
  assert.deepEqual(await stream.next(), { type: "stage", stage: "identifying" });
  assert.deepEqual(await stream.next(), { type: "identity", identity });
  assert.equal(mappingStarted, true);
  assert.deepEqual(await stream.next(), { type: "stage", stage: "mapping" });
  mapping.resolve(document);
  const rest = await collect(stream.next);
  assert.deepEqual(rest.map(event => event.type), ["mapped", "stage", "complete"]);
  const complete = rest.at(-1)!;
  if (complete.type === "complete") store.delete(complete.analysis.id);
  assert.match(response.headers.get("Content-Type")!, /application\/x-ndjson/);
  assert.match(response.headers.get("Cache-Control")!, /no-store/);
  assert.match(response.headers.get("Cache-Control")!, /no-transform/);
  assert.equal(response.headers.get("X-Content-Type-Options"), "nosniff");
});

test("mapped fields are usable before search finishes and enrichment preserves edits", async () => {
  const finding = deferred<SearchResult>();
  const { response, store } = await create({ searchDocument: () => finding.promise });
  const stream = events(response);
  let mapped: Extract<AnalysisEvent, { type: "mapped" }> | undefined;
  while (!mapped) { const event = await stream.next(); if (event?.type === "mapped") mapped = event; }
  assert.equal(mapped.analysis.search.status, "pending");
  assert.equal(store.get(mapped.analysis.id)?.analysis.search.status, "pending");
  store.updateField(mapped.analysis.id, "name", { ...document.fields[0].box, y: .3 });
  store.addField(mapped.analysis.id, { label: "주소", printedHint: "신청인", confidence: .9 }, { ...document.fields[0].box, y: .4 }, 1);
  finding.resolve(search);
  const rest = await collect(stream.next);
  const complete = rest.at(-1)!;
  assert.equal(complete.type, "complete");
  if (complete.type !== "complete") return;
  assert.equal(complete.analysis.search.status, "completed");
  assert.equal(complete.analysis.document.fields[0].box.y, .3);
  assert.equal(complete.analysis.document.fields.length, 2);
  assert.equal(store.get(mapped.analysis.id)?.version, 2);
  assert.ok(store.get(mapped.analysis.id));
  store.delete(mapped.analysis.id);
});

test("failed quick identity falls back to printed metadata from the field map", async () => {
  const { response, store } = await create({ readIdentity: async () => { throw new Error("identity unavailable"); } });
  const all = await collect(events(response).next);
  const identified = all.find(event => event.type === "identity");
  assert.equal(identified?.type, "identity");
  if (identified?.type === "identity") {
    assert.equal(identified.identity.title, document.title);
    assert.equal(identified.identity.description, "");
  }
  assert.equal(all.some(event => event.type === "error"), false);
  const last = all.at(-1)!;
  if (last.type === "complete") store.delete(last.analysis.id);
});

test("mapping failure reports a safe error and aborts a still-running identity request", async () => {
  let identitySignal: AbortSignal | undefined;
  const { response } = await create({ readIdentity: (_image: string, signal: AbortSignal) => { identitySignal = signal; return new Promise(() => {}); }, readDocument: async () => { throw new Error("secret provider text"); } });
  const all = await collect(events(response).next);
  const error = all.at(-1)!;
  assert.equal(error.type, "error");
  if (error.type === "error") { assert.equal(error.code, "AI_INVALID_RESPONSE"); assert.ok(!error.error.includes("secret")); }
  assert.equal(identitySignal?.aborted, true);
});

test("cancel before mapping aborts both requests and late mapping never creates a session", async () => {
  const mapping = deferred<DocumentReading>();
  const identityWait = deferred<DocumentIdentity>();
  const signals: AbortSignal[] = [];
  let progress: ((reading: DocumentReading) => void) | undefined;
  const store = new AnalysisStore();
  let puts = 0;
  const originalPut = store.put.bind(store);
  store.put = (...args) => { puts++; return originalPut(...args); };
  const { response } = await create({ store, readIdentity: (_image: string, signal: AbortSignal) => { signals.push(signal); return identityWait.promise; }, readDocument: (_image: string, signal: AbortSignal, onProgress?: (reading: DocumentReading) => void) => { signals.push(signal); progress = onProgress; return mapping.promise; } });
  const stream = events(response);
  await stream.next();
  await stream.reader.cancel();
  assert.equal(signals.length, 2);
  assert.ok(signals.every(signal => signal.aborted));
  progress?.(document);
  mapping.resolve(document); identityWait.resolve(identity);
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(puts, 0);
});

test("disconnect after mapping preserves usable fields with unavailable search and ignores late results", async () => {
  const finding = deferred<SearchResult>();
  const store = new AnalysisStore();
  const unrelated = store.put(document, search);
  let searchSignal: AbortSignal | undefined;
  const { response } = await create({ store, searchDocument: (_document: DocumentReading, signal: AbortSignal) => { searchSignal = signal; return finding.promise; } });
  const stream = events(response);
  let id = "";
  while (!id) { const event = await stream.next(); if (event?.type === "mapped") id = event.analysis.id; }
  await stream.reader.cancel();
  assert.equal(searchSignal?.aborted, true);
  assert.equal(store.get(id)?.analysis.search.status, "unavailable");
  assert.equal(store.get(id)?.analysis.mappingStatus, "completed");
  assert.deepEqual(store.get(id)?.analysis.document, document);
  assert.ok(store.get(unrelated.id));
  finding.resolve(search);
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(store.get(id)?.analysis.search.status, "unavailable");
  store.delete(id);
  store.delete(unrelated.id);
});

test("request abort after mapping cleans up without waiting for an uncooperative search", async () => {
  const controller = new AbortController();
  const { response, store } = await create({ searchDocument: () => new Promise(() => {}) }, request(controller.signal));
  const stream = events(response);
  let id = "";
  while (!id) { const event = await stream.next(); if (event?.type === "mapped") id = event.analysis.id; }
  controller.abort();
  assert.equal(store.get(id)?.analysis.search.status, "unavailable");
  const remaining = await collect(stream.next);
  assert.equal(remaining.some(event => event.type === "complete"), false);
  store.delete(id);
});

test("a fatal search failure completes with current mapped fields and unavailable search", async () => {
  const finding = deferred<SearchResult>();
  const { response, store } = await create({ searchDocument: () => finding.promise });
  const stream = events(response);
  let id = "";
  while (!id) { const event = await stream.next(); if (event?.type === "mapped") id = event.analysis.id; }
  store.updateField(id, "name", { ...document.fields[0].box, y: .35 });
  finding.reject(new Error("secret provider text"));
  const rest = await collect(stream.next);
  const last = rest.at(-1)!;
  assert.equal(last.type, "complete");
  if (last.type === "complete") {
    assert.equal(last.analysis.search.status, "unavailable");
    assert.equal(last.analysis.mappingStatus, "completed");
    assert.equal(last.analysis.document.fields[0].box.y, .35);
    assert.ok(!JSON.stringify(last).includes("secret"));
  }
  store.delete(id);
});

test("deleting the mapped session before disconnect cannot revive it", async () => {
  const finding = deferred<SearchResult>();
  const { response, store } = await create({ searchDocument: () => finding.promise });
  const stream = events(response);
  let id = "";
  while (!id) { const event = await stream.next(); if (event?.type === "mapped") id = event.analysis.id; }
  store.delete(id);
  await stream.reader.cancel();
  finding.resolve(search);
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(store.get(id), undefined);
});

test("deleted sessions are never recreated by completed search", async () => {
  const finding = deferred<SearchResult>();
  const { response, store } = await create({ searchDocument: () => finding.promise });
  const stream = events(response);
  let id = "";
  while (!id) { const event = await stream.next(); if (event?.type === "mapped") id = event.analysis.id; }
  store.delete(id);
  finding.resolve(search);
  const rest = await collect(stream.next);
  assert.equal(store.get(id), undefined);
  assert.equal(rest.some(event => event.type === "complete"), false);
  const last = rest.at(-1)!;
  if (last.type === "error") assert.equal(last.code, "SESSION_EXPIRED");
  else assert.fail("expected expired session error");
});

test("first fields publish while the full reader is pending and final search uses current stable identities", async () => {
  const mapping = deferred<DocumentReading>();
  const finding = deferred<SearchResult>();
  let progress: ((reading: DocumentReading) => void) | undefined;
  const searched: DocumentReading[] = [];
  let puts = 0;
  const store = new AnalysisStore();
  const originalPut = store.put.bind(store);
  store.put = (...args) => { puts++; return originalPut(...args); };
  const { response } = await create({ store, readDocument: (_image: string, _signal: AbortSignal, onProgress?: (reading: DocumentReading) => void) => { progress = onProgress; return mapping.promise; }, searchDocument: (reading: DocumentReading) => { searched.push(reading); return finding.promise; } });
  const stream = events(response);
  let id = "";
  try {
    await stream.next();
    await new Promise(resolve => setImmediate(resolve));
    assert.equal(typeof progress, "function", "the detailed reader receives its progress callback before it resolves");
    progress!(document);
    while (!id) {
      const event = await stream.next();
      if (event?.type === "mapped") {
        id = event.analysis.id;
        assert.equal(event.analysis.mappingStatus, "in_progress");
        assert.equal(event.analysis.search.status, "pending");
      }
    }
    assert.equal(searched.length, 0);
    const edited = store.updateField(id, "name", { ...document.fields[0].box, y: .3 }).field;
    const manual = store.addField(id, { label: "주소", printedHint: "", confidence: .9 }, { ...document.fields[0].box, y: .4 }, 1).field;
    const question = { id: "self", text: "본인 서류인가요?", choices: [{ id: "yes", label: "네" }] };
    const guide = { fieldId: "name", explanation: "이름을 적어요.", example: "", check: "", provenance: "photo_inference" as const, sourceIds: [], question };
    store.saveGuide(id, 2, "pending:guide", guide);
    const phone = { ...document.fields[0], id: "phone", label: "전화번호", box: { ...document.fields[0].box, y: .5 } };
    progress!({ ...document, title: "확인한 상담 신청서", fields: [document.fields[0], phone] });
    const addition = await stream.next();
    assert.equal(addition?.type, "fields");
    if (addition?.type === "fields") {
      assert.equal(addition.analysis.id, id);
      assert.equal(addition.analysis.mappingStatus, "in_progress");
      assert.deepEqual(addition.analysis.document.fields.map(field => field.id), ["name", manual.id, "phone"]);
      assert.equal(addition.analysis.document.fields[0].box.y, .3);
    }
    assert.equal(store.get(id)?.guides.get("pending:guide"), guide);
    assert.equal(store.get(id)?.questions.get("name")?.get("self"), question);
    assert.equal(store.saveGuide(id, 2, "pending:late-guide", guide), guide);
    mapping.resolve({ ...document, fields: [phone, { ...document.fields[0], box: { ...document.fields[0].box, y: .7 } }] });
    const finalFields = await stream.next();
    assert.equal(finalFields?.type, "fields");
    if (finalFields?.type === "fields") assert.equal(finalFields.analysis.mappingStatus, "completed");
    assert.deepEqual(await stream.next(), { type: "stage", stage: "searching" });
    await new Promise(resolve => setImmediate(resolve));
    assert.equal(searched.length, 1);
    assert.deepEqual(searched[0].fields.map(field => field.id), ["name", manual.id, "phone"]);
    assert.equal(searched[0].fields[0], edited);
    assert.equal(searched[0].fields[1], manual);
    finding.resolve(search);
    const rest = await collect(stream.next);
    assert.equal(rest.at(-1)?.type, "complete");
    if (rest.at(-1)?.type === "complete") assert.equal((rest.at(-1) as Extract<AnalysisEvent, { type: "complete" }>).analysis.mappingStatus, "completed");
    progress!({ ...document, fields: [...document.fields, { ...phone, id: "too_late" }] });
    assert.deepEqual(store.get(id)?.analysis.document.fields.map(field => field.id), ["name", manual.id, "phone"]);
    assert.equal(puts, 1);
  } finally {
    mapping.resolve(document); finding.resolve(search);
    await stream.reader.cancel();
    if (id) store.delete(id);
  }
});

test("progressive mapping uses metadata fallback without allowing late identity to reroute the session", async () => {
  const mapping = deferred<DocumentReading>();
  const identifying = deferred<DocumentIdentity>();
  let progress: ((reading: DocumentReading) => void) | undefined;
  const { response, store } = await create({ readIdentity: () => identifying.promise, readDocument: (_image: string, _signal: AbortSignal, onProgress?: (reading: DocumentReading) => void) => { progress = onProgress; return mapping.promise; } });
  const stream = events(response);
  let id = "";
  try {
    await stream.next();
    await new Promise(resolve => setImmediate(resolve));
    assert.equal(typeof progress, "function");
    progress!(document);
    const fallback = await stream.next();
    assert.equal(fallback?.type, "identity");
    if (fallback?.type === "identity") assert.equal(fallback.identity.title, document.title);
    assert.deepEqual(await stream.next(), { type: "stage", stage: "mapping" });
    const mapped = await stream.next();
    assert.equal(mapped?.type, "mapped");
    if (mapped?.type === "mapped") id = mapped.analysis.id;
    identifying.resolve({ ...identity, title: "뒤늦은 다른 제목" });
    mapping.resolve(document);
    const rest = await collect(stream.next);
    assert.equal(rest.some(event => event.type === "identity"), false);
    assert.equal(rest.some(event => event.type === "mapped"), false);
  } finally {
    identifying.resolve(identity); mapping.resolve(document);
    await stream.reader.cancel();
    if (id) store.delete(id);
  }
});

test("a full-reader failure after first fields completes with partial usable mapping and a safe warning", async () => {
  const mapping = deferred<DocumentReading>();
  let progress: ((reading: DocumentReading) => void) | undefined;
  let searches = 0;
  const { response, store } = await create({ readDocument: (_image: string, _signal: AbortSignal, onProgress?: (reading: DocumentReading) => void) => { progress = onProgress; return mapping.promise; }, searchDocument: async () => { searches++; return search; } });
  const stream = events(response);
  let id = "";
  try {
    await stream.next();
    await new Promise(resolve => setImmediate(resolve));
    assert.equal(typeof progress, "function");
    progress!(document);
    while (!id) { const event = await stream.next(); if (event?.type === "mapped") id = event.analysis.id; }
    store.updateField(id, "name", { ...document.fields[0].box, y: .35 });
    mapping.reject(new Error("secret provider text"));
    const rest = await collect(stream.next);
    const last = rest.at(-1);
    assert.equal(last?.type, "complete");
    if (last?.type === "complete") {
      assert.equal(last.analysis.mappingStatus, "partial");
      assert.equal(last.analysis.search.status, "unavailable");
      assert.equal(last.analysis.document.fields[0].box.y, .35);
      assert.ok(last.analysis.document.warnings.length > 0);
      assert.ok(!JSON.stringify(last).includes("secret"));
    }
    assert.equal(searches, 0);
  } finally {
    mapping.resolve(document);
    await stream.reader.cancel();
    if (id) store.delete(id);
  }
});

test("cancelling progressive mapping preserves a partial session and ignores all late snapshots", async () => {
  const mapping = deferred<DocumentReading>();
  let progress: ((reading: DocumentReading) => void) | undefined;
  let signal: AbortSignal | undefined;
  let searches = 0;
  const { response, store } = await create({ readDocument: (_image: string, readerSignal: AbortSignal, onProgress?: (reading: DocumentReading) => void) => { progress = onProgress; signal = readerSignal; return mapping.promise; }, searchDocument: async () => { searches++; return search; } });
  const stream = events(response);
  let id = "";
  try {
    await stream.next();
    await new Promise(resolve => setImmediate(resolve));
    assert.equal(typeof progress, "function");
    progress!(document);
    while (!id) { const event = await stream.next(); if (event?.type === "mapped") id = event.analysis.id; }
    await stream.reader.cancel();
    assert.equal(signal?.aborted, true);
    assert.equal(store.get(id)?.analysis.mappingStatus, "partial");
    assert.equal(store.get(id)?.analysis.search.status, "unavailable");
    progress!({ ...document, fields: [...document.fields, { ...document.fields[0], id: "late" }] });
    mapping.resolve(document);
    await new Promise(resolve => setImmediate(resolve));
    assert.deepEqual(store.get(id)?.analysis.document.fields.map(field => field.id), ["name"]);
    assert.equal(searches, 0);
    store.delete(id);
    progress!(document);
    assert.equal(store.get(id), undefined);
  } finally {
    mapping.resolve(document);
    await stream.reader.cancel();
    if (id) store.delete(id);
  }
});

test("progressive callbacks cannot recreate a deleted session or continue its search", async () => {
  const mapping = deferred<DocumentReading>();
  let progress: ((reading: DocumentReading) => void) | undefined;
  let searches = 0;
  const { response, store } = await create({ readDocument: (_image: string, _signal: AbortSignal, onProgress?: (reading: DocumentReading) => void) => { progress = onProgress; return mapping.promise; }, searchDocument: async () => { searches++; return search; } });
  const stream = events(response);
  let id = "";
  try {
    await stream.next();
    await new Promise(resolve => setImmediate(resolve));
    assert.equal(typeof progress, "function");
    progress!(document);
    while (!id) { const event = await stream.next(); if (event?.type === "mapped") id = event.analysis.id; }
    store.delete(id);
    mapping.resolve(document);
    const rest = await collect(stream.next);
    assert.equal(rest.at(-1)?.type, "error");
    if (rest.at(-1)?.type === "error") assert.equal((rest.at(-1) as Extract<AnalysisEvent, { type: "error" }>).code, "SESSION_EXPIRED");
    assert.equal(store.get(id), undefined);
    assert.equal(searches, 0);
  } finally {
    mapping.resolve(document);
    await stream.reader.cancel();
    if (id) store.delete(id);
  }
});

test("legacy reader overrides can still map an empty document on final resolution", async () => {
  const { response, store } = await create({ readDocument: async () => ({ ...document, readable: false, fields: [] }) });
  const all = await collect(events(response).next);
  assert.equal(all.filter(event => event.type === "mapped").length, 1);
  assert.equal(all.some(event => event.type === "fields"), false);
  const last = all.at(-1);
  assert.equal(last?.type, "complete");
  if (last?.type === "complete") {
    assert.equal(last.analysis.mappingStatus, "completed");
    assert.deepEqual(last.analysis.document.fields, []);
    store.delete(last.analysis.id);
  }
});

test("stream admission budget covers the entire response body lifetime", async () => {
  const one = await create({ readDocument: () => new Promise(() => {}) });
  const two = await create({ readDocument: () => new Promise(() => {}) });
  try {
    await assert.rejects(() => create(), error => error instanceof InputError && error.code === "AI_RATE_LIMIT");
    await one.response.body!.cancel();
    const three = await create({ readDocument: () => new Promise(() => {}) });
    await three.response.body!.cancel();
  } finally { await one.response.body!.cancel(); await two.response.body!.cancel(); }
});

test("mapped fields arrive before an enabled legal lookup completes", async () => {
  const resolving = deferred<LegalContext>();
  const { response, store } = await create({ readLegalReferences: async () => hints, resolveLegalContext: () => resolving.promise });
  const stream = events(response);
  const seen: AnalysisEvent[] = [];
  while (!seen.some(event => event.type === "legal_reference")) {
    const event = await stream.next();
    if (!event) break;
    seen.push(event);
  }
  assert.equal(seen.some(event => event.type === "mapped"), true);
  assert.equal(seen.some(event => event.type === "legal_reference"), true);
  assert.equal(seen.some(event => event.type === "legal_complete"), false);
  resolving.resolve(legal);
  const rest = await collect(stream.next);
  assert.equal(rest.some(event => event.type === "legal_complete"), true);
  const complete = rest.find(event => event.type === "complete");
  assert.equal(complete?.type, "complete");
  if (complete?.type === "complete") {
    assert.equal(complete.analysis.legal?.status, "completed");
    store.delete(complete.analysis.id);
  }
});

test("legal lookup failure is nonfatal and completes existing document search", async () => {
  const { response, store } = await create({ readLegalReferences: async () => hints, resolveLegalContext: async () => { throw new Error("private upstream detail"); } });
  const all = await collect(events(response).next);
  assert.equal(all.some(event => event.type === "legal_unavailable"), true);
  const complete = all.at(-1)!;
  assert.equal(complete.type, "complete");
  if (complete.type === "complete") {
    assert.equal(complete.analysis.search.status, "completed");
    assert.equal(complete.analysis.legal?.status, "unavailable");
    assert.equal(JSON.stringify(complete).includes("private upstream detail"), false);
    store.delete(complete.analysis.id);
  }
});

test("disconnect aborts legal work and late legal results cannot replace the unavailable state", async () => {
  const resolving = deferred<LegalContext>();
  let legalSignal: AbortSignal | undefined;
  const { response, store } = await create({ readLegalReferences: async () => hints, resolveLegalContext: (_hints: LegalReferenceHints, signal: AbortSignal) => { legalSignal = signal; return resolving.promise; } });
  const stream = events(response);
  let id = "";
  while (!legalSignal || !id) {
    const event = await stream.next();
    if (!event) break;
    if (event?.type === "mapped") id = event.analysis.id;
  }
  assert.ok(legalSignal);
  await stream.reader.cancel();
  assert.equal(legalSignal?.aborted, true);
  assert.equal(store.get(id)?.analysis.legal?.status, "unavailable");
  resolving.resolve(legal);
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(store.get(id)?.analysis.legal?.status, "unavailable");
  store.delete(id);
});
