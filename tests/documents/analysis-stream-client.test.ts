import assert from "node:assert/strict";
import test from "node:test";
import type { AnalysisEvent } from "../../lib/documents/types.ts";

const encoder = new TextEncoder();
const identity = { title: "한글 신청서", institution: "가상기관", formNumber: "F-1", revision: "2026", description: "이름과 주소를 작성하는 신청서예요.", readable: true };
const legalCandidate = { id: "administrative_rule:10", serialNumber: "10", kind: "administrative_rule", name: "가상 처리지침", category: "고시", authority: "가상부", promulgationNumber: "제10호", promulgationDate: "2026-01-01", effectiveDate: "2026-02-01", status: "current", apiTarget: "admrul" };
const legal = { status: "completed", detectedReferences: [{ name: "가상 처리지침", kind: "administrative_rule", authority: "", number: "", date: "", formNumber: "" }], candidates: [legalCandidate], canonicalRule: legalCandidate, hierarchy: { act: null, decree: null, rule: null, administrativeRules: [legalCandidate] }, provisions: [], forms: [], authority: "가상부", procedure: null, summary: "", sources: [{ id: "legal-rule-10", title: "가상 처리지침", url: "https://www.law.go.kr/rule", kind: "administrative_rule", retrievedAt: "2026-11-09T00:00:00.000Z" }], warnings: [], retrievedAt: "2026-11-09T00:00:00.000Z", stale: false };

function analysis(status = "pending") {
  return {
    id: "analysis_1", expiresAt: "2026-10-29T04:00:00.000Z",
    document: {
      title: "한글 신청서", institution: "가상기관", formNumber: "F-1", revision: "2026", readable: true, warnings: [],
      fields: [{ id: "name", label: "이름", box: { x: 0.1, y: 0.2, width: 0.3, height: 0.1 }, confidence: 0.9, printedHint: "본인 이름" }],
    },
    search: { status, case: "photo_only", summary: "", sources: [] },
  };
}

function line(value: unknown) { return JSON.stringify(value); }
function responseFrom(chunks: Uint8Array[], onCancel?: () => void) {
  return new Response(new ReadableStream<Uint8Array>({
    start(controller) { chunks.forEach((chunk) => controller.enqueue(chunk)); controller.close(); },
    cancel() { onCancel?.(); },
  }), { headers: { "Content-Type": "application/x-ndjson; charset=utf-8" } });
}
async function consume(response: Response, onEvent: (event: AnalysisEvent) => void, signal?: AbortSignal) {
  const client = await import("../../lib/documents/analysis-stream-client.ts");
  return client.consumeAnalysisStream(response, onEvent, signal);
}

test("decodes one-byte UTF-8 chunks, CRLF, and a final event without a newline", async () => {
  const raw = [line({ type: "stage", stage: "identifying" }), line({ type: "identity", identity }), line({ type: "mapped", analysis: analysis() }), line({ type: "complete", analysis: analysis("completed") })].join("\r\n");
  const events: AnalysisEvent[] = [];
  await consume(responseFrom(Array.from(encoder.encode(raw), (byte) => new Uint8Array([byte]))), (event) => events.push(event));
  assert.deepEqual(events.map((event) => event.type), ["stage", "identity", "mapped", "complete"]);
  const identified = events.find((event) => event.type === "identity");
  assert.equal(identified?.identity.title, "한글 신청서");
});

test("decodes progressive field snapshots across split UTF-8 chunks", async () => {
  const first = { ...analysis(), mappingStatus: "in_progress" };
  const expanded = {
    ...first,
    document: {
      ...first.document,
      fields: [...first.document.fields, { id: "address", label: "주소", box: { x: 0.1, y: 0.4, width: 0.6, height: 0.1 }, confidence: 0.8, printedHint: "현재 주소" }],
    },
  };
  const raw = [
    { type: "mapped", analysis: first },
    { type: "fields", analysis: expanded },
    { type: "fields", analysis: { ...expanded, mappingStatus: "partial" } },
    { type: "complete", analysis: { ...expanded, mappingStatus: "completed", search: analysis("completed").search } },
  ].map(line).join("\r\n");
  const received: AnalysisEvent[] = [];
  await consume(responseFrom(Array.from(encoder.encode(raw), (byte) => new Uint8Array([byte]))), (event) => received.push(event));
  assert.deepEqual(received.map((event) => event.type), ["mapped", "fields", "fields", "complete"]);
  const snapshots = received.flatMap((event) => "analysis" in event ? [event.analysis] : []);
  assert.deepEqual(snapshots.map((snapshot) => snapshot.document.fields.map((field) => field.label)), [["이름"], ["이름", "주소"], ["이름", "주소"], ["이름", "주소"]]);
});

test("a field snapshot keeps consuming until the later completion arrives", async () => {
  let controller!: ReadableStreamDefaultController<Uint8Array>;
  let canceled = false;
  const response = new Response(new ReadableStream<Uint8Array>({
    start(value) { controller = value; },
    cancel() { canceled = true; },
  }), { headers: { "Content-Type": "application/x-ndjson" } });
  let publishFields!: () => void;
  const fields = new Promise<void>((resolve) => { publishFields = resolve; });
  const received: string[] = [];
  let finished = false;
  const consuming = consume(response, (event) => { received.push(event.type); if (event.type === "fields") publishFields(); }).then(() => { finished = true; });
  const fieldsSeen = Promise.race([fields, consuming.then(() => assert.fail("field snapshot ended the stream"))]);
  controller.enqueue(encoder.encode(`${line({ type: "fields", analysis: { ...analysis("completed"), mappingStatus: "in_progress" } })}\n`));
  await fieldsSeen;
  assert.deepEqual(received, ["fields"]);
  assert.equal(finished, false);
  assert.equal(canceled, false);
  controller.enqueue(encoder.encode(`${line({ type: "complete", analysis: { ...analysis("completed"), mappingStatus: "completed" } })}\n`));
  controller.close();
  await consuming;
  assert.deepEqual(received, ["fields", "complete"]);
});

test("rejects unknown mapping statuses before publishing analysis snapshots", async () => {
  for (const type of ["mapped", "fields", "complete"]) {
    for (const mappingStatus of ["pending", "done", "IN_PROGRESS", null, 1]) {
      await assert.rejects(() => consume(responseFrom([encoder.encode(`${line({ type, analysis: { ...analysis("completed"), mappingStatus } })}\n`)]), () => assert.fail("malformed mapping status reached callback")), (error: unknown) => error instanceof Error && "code" in error && error.code === "INVALID_STREAM");
    }
  }
});

test("accepts legacy field snapshots without a mapping status", async () => {
  const received: string[] = [];
  await consume(responseFrom([encoder.encode(`${line({ type: "fields", analysis: analysis() })}\n${line({ type: "complete", analysis: analysis("completed") })}\n`)]), (event) => received.push(event.type));
  assert.deepEqual(received, ["fields", "complete"]);
});

test("publishes mapped fields while the source-search chunk is still blocked", async () => {
  let controller!: ReadableStreamDefaultController<Uint8Array>;
  const response = new Response(new ReadableStream<Uint8Array>({ start(value) { controller = value; } }), { headers: { "Content-Type": "application/x-ndjson" } });
  let publishMapped!: () => void;
  const mapped = new Promise<void>((resolve) => { publishMapped = resolve; });
  const received: string[] = [];
  let finished = false;
  const consuming = consume(response, (event) => { received.push(event.type); if (event.type === "mapped") publishMapped(); }).then(() => { finished = true; });
  controller.enqueue(encoder.encode(`${line({ type: "mapped", analysis: analysis() })}\n`));
  await mapped;
  assert.deepEqual(received, ["mapped"]);
  assert.equal(finished, false);
  controller.enqueue(encoder.encode(`${line({ type: "complete", analysis: analysis("unavailable") })}\n`));
  controller.close();
  await consuming;
  assert.deepEqual(received, ["mapped", "complete"]);
});

test("accepts unreadable identity metadata and completed source structures", async () => {
  const complete = analysis("completed");
  const source = { id: "source_1", title: "서식 안내", url: "https://example.org/form", kind: "guide", official: true, sameForm: true, titleMatches: true, institutionMatches: true, revisionMatches: true, fieldIds: ["name"], evidence: "서식 번호 일치", guidance: [{ fieldId: "name", text: "본인 이름을 적으세요." }], matchedFormNumber: "F-1", matchedFieldLabels: ["이름"] };
  const events: AnalysisEvent[] = [];
  await consume(responseFrom([encoder.encode(`${line({ type: "identity", identity: { title: "", institution: "", formNumber: "", revision: "", description: "", readable: false } })}\n${line({ type: "complete", analysis: { ...complete, search: { ...complete.search, sources: [source] } } })}\n`)]), (event) => events.push(event));
  assert.equal(events.length, 2);
  assert.equal(events[1].type, "complete");
});

test("validates and publishes bounded legal progress events", async () => {
  const withLegal = { ...analysis("completed"), legal };
  const raw = [
    { type: "legal_started", analysisId: "analysis_1" },
    { type: "legal_reference", analysisId: "analysis_1", references: legal.detectedReferences },
    { type: "legal_complete", analysis: withLegal },
    { type: "complete", analysis: withLegal },
  ].map(line).join("\n") + "\n";
  const events: AnalysisEvent[] = [];
  await consume(responseFrom([encoder.encode(raw)]), event => events.push(event));
  assert.deepEqual(events.map(event => event.type), ["legal_started", "legal_reference", "legal_complete", "complete"]);
});

test("rejects malformed or unbounded legal events before callbacks", async () => {
  const invalid = [
    { type: "legal_started", analysisId: "unsafe id" },
    { type: "legal_reference", analysisId: "analysis_1", references: Array.from({ length: 9 }, () => legal.detectedReferences[0]) },
    { type: "legal_complete", analysis: { ...analysis("completed"), legal: { ...legal, status: "invented" } } },
    { type: "legal_unavailable", analysis: { ...analysis("completed"), legal: { ...legal, sources: [{ ...legal.sources[0], url: "javascript:alert(1)" }] } } },
  ];
  for (const value of invalid) await assert.rejects(() => consume(responseFrom([encoder.encode(line(value) + "\n")]), () => assert.fail("invalid legal event reached callback")), (error: unknown) => error instanceof Error && "code" in error && error.code === "INVALID_STREAM");
});

test("rejects premature EOF but keeps already delivered mapped fields", async () => {
  const received: AnalysisEvent[] = [];
  await assert.rejects(() => consume(responseFrom([encoder.encode(`${line({ type: "mapped", analysis: analysis() })}\n`)]), (event) => received.push(event)), (error: unknown) => error instanceof Error && /다시|연결|완료/.test(error.message));
  assert.equal(received[0].type, "mapped");
});

test("delivers a terminal error once and rejects without exposing provider details", async () => {
  let canceled = false;
  const secret = "provider secret and customer document text";
  const response = new Response(new ReadableStream<Uint8Array>({
    start(controller) { controller.enqueue(encoder.encode(`${line({ type: "error", code: "AI_INVALID_RESPONSE", error: secret })}\n${line({ type: "stage", stage: "searching" })}\n`)); },
    cancel() { canceled = true; },
  }), { headers: { "Content-Type": "application/x-ndjson" } });
  const events: AnalysisEvent[] = [];
  await assert.rejects(() => consume(response, (event) => events.push(event)), (error: unknown) => error instanceof Error && "code" in error && error.code === "AI_INVALID_RESPONSE" && !error.message.includes(secret));
  assert.deepEqual(events.map((event) => event.type), ["error"]);
  assert.equal(canceled, true);
  assert.equal(response.body?.locked, false);
});

test("stops reading after complete without waiting for the connection to close", async () => {
  let canceled = false;
  const response = new Response(new ReadableStream<Uint8Array>({
    start(controller) { controller.enqueue(encoder.encode(`${line({ type: "complete", analysis: analysis("completed") })}\n${line({ type: "stage", stage: "searching" })}\n`)); },
    cancel() { canceled = true; },
  }), { headers: { "Content-Type": "application/x-ndjson" } });
  const events: string[] = [];
  await consume(response, (event) => events.push(event.type));
  assert.deepEqual(events, ["complete"]);
  assert.equal(canceled, true);
  assert.equal(response.body?.locked, false);
});

test("cancellation interrupts a blocked read and releases the stream", async () => {
  let canceled = false;
  let sawStage!: () => void;
  const stageSeen = new Promise<void>((resolve) => { sawStage = resolve; });
  const response = new Response(new ReadableStream<Uint8Array>({
    start(controller) { controller.enqueue(encoder.encode(`${line({ type: "stage", stage: "mapping" })}\n`)); },
    cancel() { canceled = true; },
  }), { headers: { "Content-Type": "application/x-ndjson" } });
  const abort = new AbortController();
  const events: string[] = [];
  const consuming = consume(response, (event) => { events.push(event.type); sawStage(); }, abort.signal);
  const rejected = assert.rejects(consuming, (error: unknown) => error instanceof Error && error.name === "AbortError");
  await stageSeen;
  abort.abort();
  await rejected;
  assert.deepEqual(events, ["stage"]);
  assert.equal(canceled, true);
  assert.equal(response.body?.locked, false);
});

test("abort from an event callback prevents later events in the same chunk", async () => {
  const abort = new AbortController();
  const response = responseFrom([encoder.encode(`${line({ type: "stage", stage: "mapping" })}\n${line({ type: "complete", analysis: analysis("completed") })}\n`)]);
  const events: string[] = [];
  await assert.rejects(() => consume(response, (event) => { events.push(event.type); abort.abort(); }, abort.signal), (error: unknown) => error instanceof Error && error.name === "AbortError");
  assert.deepEqual(events, ["stage"]);
});

test("an already aborted request consumes no events", async () => {
  const abort = new AbortController();
  abort.abort();
  const events: AnalysisEvent[] = [];
  await assert.rejects(() => consume(responseFrom([encoder.encode(`${line({ type: "complete", analysis: analysis("completed") })}\n`)]), (event) => events.push(event), abort.signal), (error: unknown) => error instanceof Error && error.name === "AbortError");
  assert.deepEqual(events, []);
});

test("HTTP JSON errors preserve a safe code without leaking the raw error", async () => {
  const secret = "server trace: customer registration number and private key";
  const response = new Response(JSON.stringify({ error: secret, code: "DOCUMENT_EXPIRED" }), { status: 410, headers: { "Content-Type": "application/json" } });
  await assert.rejects(() => consume(response, () => assert.fail("no event expected")), (error: unknown) => error instanceof Error && "code" in error && error.code === "DOCUMENT_EXPIRED" && !error.message.includes(secret));
});

test("HTML HTTP errors and broken connections become friendly errors", async () => {
  await assert.rejects(() => consume(new Response("<html>secret proxy trace</html>", { status: 502 }), () => assert.fail("no event expected")), (error: unknown) => error instanceof Error && /다시|분석|연결/.test(error.message) && !error.message.includes("secret"));
  const response = new Response(new ReadableStream<Uint8Array>({ start(controller) { controller.error(new Error("private network trace")); } }), { headers: { "Content-Type": "application/x-ndjson" } });
  await assert.rejects(() => consume(response, () => assert.fail("no event expected")), (error: unknown) => error instanceof Error && /다시|분석|연결/.test(error.message) && !error.message.includes("private"));
});

test("unknown events and malformed event payloads are rejected before callbacks", async () => {
  const badValues: unknown[] = [
    { type: "unknown" }, { type: "stage", stage: "uploading" }, { type: "stage", stage: { toString: "private diagnostic" } }, { type: "identity", identity: { ...identity, readable: "yes" } },
    { type: "mapped", analysis: { ...analysis(), document: { ...analysis().document, fields: [{ ...analysis().document.fields[0], box: { x: 0.9, y: 0.1, width: 0.5, height: 0.1 } }] } } },
    { type: "mapped", analysis: { ...analysis(), document: { ...analysis().document, fields: [{ ...analysis().document.fields[0], id: "unsafe id" }] } } },
    { type: "mapped", analysis: { ...analysis(), search: { status: "pending", case: "photo_only", summary: "", sources: [{}] } } },
    { type: "mapped", analysis: { ...analysis(), expiresAt: "not-a-date" } },
    { type: "complete", analysis: analysis("pending") }, { type: "error", code: 123, error: "실패" }, null, [],
  ];
  for (const value of badValues) {
    await assert.rejects(() => consume(responseFrom([encoder.encode(`${line(value)}\n`)]), () => assert.fail(`invalid event reached callback: ${line(value)}`)), (error: unknown) => error instanceof Error && /응답|다시|분석/.test(error.message));
  }
});

test("invalid JSON and malformed UTF-8 do not escape parser diagnostics", async () => {
  for (const bytes of [encoder.encode('{"type":"stage",secret}\n'), new Uint8Array([0x7b, 0x22, 0xc3, 0x28, 0x22, 0x7d, 0x0a])]) {
    await assert.rejects(() => consume(responseFrom([bytes]), () => assert.fail("no event expected")), (error: unknown) => error instanceof Error && /응답|다시|분석/.test(error.message) && !error.message.includes("secret"));
  }
});

test("limits a single event by UTF-8 bytes across chunks before its newline arrives", async () => {
  let canceled = false;
  const oversized = encoder.encode(line({ type: "identity", identity: { ...identity, description: "가".repeat(180_000) } }));
  const response = new Response(new ReadableStream<Uint8Array>({
    start(controller) { for (let offset = 0; offset < oversized.length; offset += 10_000) controller.enqueue(oversized.slice(offset, offset + 10_000)); },
    cancel() { canceled = true; },
  }), { headers: { "Content-Type": "application/x-ndjson" } });
  await assert.rejects(() => consume(response, () => assert.fail("oversized event reached callback")), (error: unknown) => error instanceof Error && "code" in error && error.code === "EVENT_TOO_LARGE");
  assert.equal(canceled, true);
});

test("real law sizes with many forms still pass the legal stream check", async () => {
  const forms = Array.from({ length: 84 }, (_, i) => ({ id: `form-${i + 1}`, title: `서식 ${i + 1}`, url: `https://www.law.go.kr/LSW/flDownload.do?flSeq=${i + 1}`, sourceIds: [], label: `별지 제${i + 1}호서식` }));
  const withForms = { ...analysis("completed"), legal: { ...legal, status: "completed", forms, contacts: [{ department: "가상과", phone: "044-000-0000" }], printedArticles: [{ lawName: "가상법", article: "제1조" }] } };
  const events: AnalysisEvent[] = [];
  await consume(responseFrom([encoder.encode([{ type: "legal_complete", analysis: withForms }, { type: "complete", analysis: withForms }].map(line).join("\n") + "\n")]), event => events.push(event));
  assert.deepEqual(events.map(event => event.type), ["legal_complete", "complete"]);
});
