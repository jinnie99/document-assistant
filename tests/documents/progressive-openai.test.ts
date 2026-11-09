import assert from "node:assert/strict";
import test, { type TestContext } from "node:test";
import { readFileSync } from "node:fs";
import sharp from "sharp";
import { readDocument } from "../../lib/documents/openai.ts";
import type { DocumentReading } from "../../lib/documents/types.ts";

const field = { id: "primary_name", label: "성명 {이름}", printedHint: '신청인 "본인"', box: { x: .12, y: .2, width: .5, height: .05 }, confidence: .9 };
const document: DocumentReading = { title: "신청서", institution: "", formNumber: "", revision: "", readable: true, warnings: [], fields: [field] };
const encode = new TextEncoder();
const event = (type: string, value: Record<string, unknown> = {}) => `event: ${type}\r\ndata: ${JSON.stringify({ type, ...value })}\r\n\r\n`;
const delta = (text: string) => event("response.output_text.delta", { output_index: 0, content_index: 0, delta: text });
const completed = (text: string, status = "completed") => event("response.completed", { response: { status, output: [{ type: "message", content: [{ type: "output_text", text }] }] } });
function setup(t: TestContext) {
  const original = process.env.OPENAI_API_KEY;
  process.env.OPENAI_API_KEY = "test-only-placeholder";
  t.after(() => { if (original === undefined) delete process.env.OPENAI_API_KEY; else process.env.OPENAI_API_KEY = original; });
}
function sse(text: string) { return new Response(encode.encode(text), { headers: { "Content-Type": "text/event-stream" } }); }
const code = (expected: string) => (error: unknown) => error instanceof Error && "code" in error && error.code === expected;

test("primary response publishes a complete validated field while the same SSE request is still blocked", async (t) => {
  setup(t);
  const text = JSON.stringify(document), split = text.lastIndexOf("]");
  let source!: ReadableStreamDefaultController<Uint8Array>;
  const sent: Record<string, unknown>[] = [];
  t.mock.method(globalThis, "fetch", async (_url: unknown, init?: RequestInit) => {
    sent.push(JSON.parse(String(init?.body)));
    return new Response(new ReadableStream<Uint8Array>({ start(controller) { source = controller; controller.enqueue(encode.encode(delta(text.slice(0, split)))); } }));
  });
  let notify!: () => void;
  const notified = new Promise<void>(resolve => { notify = resolve; });
  const snapshots: DocumentReading[] = [];
  let finished = false;
  const work = readDocument("data:image/png;base64,test-only", undefined, reading => { snapshots.push(reading); notify(); }).finally(() => { finished = true; });
  void work.catch(() => {});
  try {
    await Promise.race([notified, new Promise((_, reject) => setTimeout(() => reject(new Error("no field before stream completion")), 500))]);
    assert.equal(finished, false);
    assert.deepEqual(snapshots[0].fields, [field]);
    assert.equal(sent.length, 1);
    assert.equal(sent[0].stream, true);
    assert.equal(sent[0].store, false);
  } finally {
    source.enqueue(encode.encode(delta(text.slice(split)) + completed(text))); source.close();
  }
  const result = await work;
  assert.equal(result.fields[0].id, "primary_name");
});

test("split UTF-8 and SSE lines preserve escaped strings and cumulative stable primary IDs", async (t) => {
  setup(t);
  const full = { ...document, fields: [field, { ...field, id: "primary_address", label: "주소", box: { ...field.box, y: .4 } }] };
  const text = JSON.stringify(full), bytes = encode.encode(delta(text) + completed(text));
  t.mock.method(globalThis, "fetch", async () => new Response(new ReadableStream({ start(controller) { for (const byte of bytes) controller.enqueue(new Uint8Array([byte])); controller.close(); } })));
  const snapshots: DocumentReading[] = [];
  const result = await readDocument("data:image/png;base64,test-only", undefined, reading => snapshots.push(reading));
  assert.deepEqual(snapshots[0].fields, [field]);
  assert.deepEqual(snapshots[1].fields.map(item => item.id), ["primary_name", "primary_address"]);
  assert.equal(result.fields[0].printedHint, '신청인 "본인"');
});

for (const [name, suffix, expected] of [
  ["EOF without completion", "", "AI_INCOMPLETE"],
  ["upstream error", event("error", { message: "secret upstream detail" }), "AI_UPSTREAM_ERROR"],
  ["incomplete response", event("response.incomplete", { response: { status: "incomplete" } }), "AI_INCOMPLETE"],
  ["refusal", event("response.refusal.delta", { delta: "refused" }), "AI_REFUSED"],
  ["failed response", event("response.failed", { response: { status: "failed" } }), "AI_UPSTREAM_ERROR"],
] as const) test(`stream rejects ${name} without returning partial success`, async (t) => {
  setup(t);
  t.mock.method(globalThis, "fetch", async () => sse(delta(JSON.stringify(document)) + suffix));
  await assert.rejects(() => readDocument("data:image/png;base64,test-only", undefined, () => {}), code(expected));
});

test("malformed, duplicate, oversized and invalid complete fields never publish", async (t) => {
  setup(t);
  for (const text of [
    JSON.stringify({ ...document, fields: [{ ...field, label: "a".repeat(81) }] }),
    JSON.stringify({ ...document, fields: [{ ...field, printedHint: "a".repeat(601) }] }),
    JSON.stringify({ ...document, fields: [{ ...field, box: { ...field.box, width: 2 } }] }),
    '{"fields":[{"id":"bad","label":"name"}]}',
    '{"fields":[true]}',
    '{"fields":[],"fields":[]}',
    '{"fields":[{"id":"bad","label":"name",}]}',
  ]) {
    let count = 0;
    t.mock.method(globalThis, "fetch", async () => sse(delta(text) + completed(text)));
    await assert.rejects(() => readDocument("data:image/png;base64,test-only", undefined, () => { count++; }), code("AI_INVALID_RESPONSE"));
    assert.equal(count, 0);
  }
});

test("a blocked upstream body is cancelled promptly and its lock released", async (t) => {
  setup(t);
  const controller = new AbortController();
  let cancelled = false;
  t.mock.method(globalThis, "fetch", async () => new Response(new ReadableStream({ cancel() { cancelled = true; } })));
  const work = readDocument("data:image/png;base64,test-only", controller.signal, () => {});
  setTimeout(() => controller.abort(), 10);
  await assert.rejects(() => work, code("CANCELLED"));
  assert.equal(cancelled, true);
});

test("cancellation does not wait for a stalled upstream cancel cleanup", async (t) => {
  setup(t);
  const controller = new AbortController();
  t.mock.method(globalThis, "fetch", async () => new Response(new ReadableStream({ cancel() { return new Promise<void>(() => {}); } })));
  const work = readDocument("data:image/png;base64,test-only", controller.signal, () => {});
  setTimeout(() => controller.abort(), 10);
  await assert.rejects(() => Promise.race([work, new Promise((_, reject) => setTimeout(() => reject(new Error("cancel cleanup blocked")), 200))]), code("CANCELLED"));
});

test("abort from the first field callback stops all later fields in the same chunk", async (t) => {
  setup(t);
  const controller = new AbortController();
  const text = JSON.stringify({ ...document, fields: [field, { ...field, id: "address", label: "주소" }] });
  t.mock.method(globalThis, "fetch", async () => sse(delta(text) + completed(text)));
  let count = 0;
  await assert.rejects(() => readDocument("data:image/png;base64,test-only", controller.signal, () => { count++; controller.abort(); }), code("CANCELLED"));
  assert.equal(count, 1);
});

test("abort from the validated primary completion stops before any crop work", async (t) => {
  setup(t);
  const controller = new AbortController(), text = JSON.stringify(document);
  let count = 0;
  t.mock.method(globalThis, "fetch", async () => sse(delta(text) + completed(text)));
  await assert.rejects(() => readDocument("data:image/png;base64,test-only", controller.signal, () => { if (++count === 2) controller.abort(); }), code("CANCELLED"));
  assert.equal(count, 2);
});

test("stream payload and event bounds reject unbounded provider input", async (t) => {
  setup(t);
  for (const wire of [delta(" ".repeat(1_048_577)), "data: " + "x".repeat(2_097_153)]) {
    t.mock.method(globalThis, "fetch", async () => sse(wire));
    await assert.rejects(() => readDocument("data:image/png;base64,test-only", undefined, () => {}), code("AI_INVALID_RESPONSE"));
  }
});

test("completion text must match deltas and contain a valid complete final reading", async (t) => {
  setup(t);
  for (const [text, final] of [[JSON.stringify(document), JSON.stringify({ ...document, title: "changed" })], ['{"fields":[' + JSON.stringify(field), '{"fields":[' + JSON.stringify(field)]]) {
    t.mock.method(globalThis, "fetch", async () => sse(delta(text) + completed(final)));
    await assert.rejects(() => readDocument("data:image/png;base64,test-only", undefined, () => {}), code("AI_INVALID_RESPONSE"));
  }
});

test("metadata that follows the fields stays blank until the final validated reading", async (t) => {
  setup(t);
  const text = JSON.stringify({ fields: document.fields, ...Object.fromEntries(Object.entries(document).filter(([key]) => key !== "fields")) });
  t.mock.method(globalThis, "fetch", async () => sse(delta(text) + completed(text)));
  const snapshots: DocumentReading[] = [];
  const result = await readDocument("data:image/png;base64,test-only", undefined, reading => snapshots.push(reading));
  assert.equal(snapshots[0].title, "");
  assert.equal(result.title, "신청서");
});

test("malformed UTF-8 and invalid SSE event JSON cannot become a successful reading", async (t) => {
  setup(t);
  for (const wire of [new Uint8Array([100, 97, 116, 97, 58, 32, 0xc3, 0x28, 10, 10]), encode.encode("data: {broken}\n\n")]) {
    t.mock.method(globalThis, "fetch", async () => new Response(wire));
    await assert.rejects(() => readDocument("data:image/png;base64,test-only", undefined, () => {}), code("AI_INVALID_RESPONSE"));
  }
});

test("a duplicate ID or an 81st field aborts instead of publishing that field", async (t) => {
  setup(t);
  for (const fields of [[field, field], Array.from({ length: 81 }, (_, index) => ({ ...field, id: `item_${index}` }))]) {
    const text = JSON.stringify({ ...document, fields });
    t.mock.method(globalThis, "fetch", async () => sse(delta(text) + completed(text)));
    let published = 0;
    await assert.rejects(() => readDocument("data:image/png;base64,test-only", undefined, reading => { published = reading.fields.length; }), code("AI_INVALID_RESPONSE"));
    assert.equal(published, fields.length === 2 ? 1 : 80);
  }
});

test("event and total wire bounds include ignored provider events", async (t) => {
  setup(t);
  const wire = event("response.created", { padding: "x".repeat(700_000) }).repeat(7);
  t.mock.method(globalThis, "fetch", async () => new Response(new ReadableStream({ start(controller) { for (let index = 0; index < wire.length; index += 500_000) controller.enqueue(encode.encode(wire.slice(index, index + 500_000))); controller.close(); } })));
  await assert.rejects(() => readDocument("data:image/png;base64,test-only", undefined, () => {}), code("AI_INVALID_RESPONSE"));
});

test("multiline data with CR-only framing finishes without waiting for transport EOF", async (t) => {
  setup(t);
  const text = JSON.stringify(document);
  let cancelled = false;
  const multiline = (value: unknown) => JSON.stringify(value, null, 2).split("\n").map(line => `data: ${line}\r`).join("") + "\r";
  const wire = multiline({ type: "response.output_text.delta", delta: text }) + completed(text).replace(/\r\n/g, "\r");
  t.mock.method(globalThis, "fetch", async () => new Response(new ReadableStream({ start(controller) { controller.enqueue(encode.encode(wire + ": keep-alive\r")); }, cancel() { cancelled = true; } })));
  const result = await readDocument("data:image/png;base64,test-only", undefined, () => {});
  assert.equal(result.title, "신청서");
  assert.equal(cancelled, true);
});

test("network failure keeps the unavailable code without exposing upstream details", async (t) => {
  setup(t);
  t.mock.method(globalThis, "fetch", async () => { throw new TypeError("private network detail"); });
  await assert.rejects(() => readDocument("data:image/png;base64,test-only", undefined, () => {}), code("AI_UNAVAILABLE"));
});

test("grid boundaries are refined before the first field is published", async (t) => {
  setup(t);
  const width = 500, height = 500, pixels = Buffer.alloc(width * height, 255);
  for (let x = 100; x <= 400; x++) { pixels[100 * width + x] = 0; pixels[150 * width + x] = 0; }
  for (let y = 100; y <= 150; y++) { pixels[y * width + 100] = 0; pixels[y * width + 400] = 0; }
  const bytes = await sharp(pixels, { raw: { width, height, channels: 1 } }).png().toBuffer();
  const full = { ...document, fields: [{ ...field, box: { x: .204, y: .204, width: .592, height: .092 } }] };
  t.mock.method(globalThis, "fetch", async (_url: unknown, init?: RequestInit) => {
    const body = JSON.parse(String(init?.body)), text = JSON.stringify(full);
    return body.stream ? sse(delta(text) + completed(text)) : Response.json({ status: "completed", output: [{ type: "message", content: [{ type: "output_text", text: JSON.stringify({ ...full, fields: [] }) }] }] });
  });
  const snapshots: DocumentReading[] = [];
  const result = await readDocument(`data:image/png;base64,${bytes.toString("base64")}`, undefined, reading => snapshots.push(reading));
  assert.deepEqual(snapshots[0].fields[0].box, { x: .2, y: .2, width: .6, height: .1 });
  assert.deepEqual(result.fields[0], snapshots[0].fields[0]);
});

test("crop completions append fresh IDs without changing published primary geometry", async (t) => {
  setup(t);
  const image = `data:image/png;base64,${readFileSync(new URL("../fixtures/fictional-form.png", import.meta.url)).toString("base64")}`;
  let pass = 0;
  const sent: Record<string, unknown>[] = [];
  t.mock.method(globalThis, "fetch", async (_url: unknown, init?: RequestInit) => {
    const body = JSON.parse(String(init?.body)); sent.push(body);
    if (body.stream) { const text = JSON.stringify(document); return sse(delta(text) + completed(text)); }
    const section = { ...document, fields: [{ ...field, id: field.id, label: `추가 칸 ${++pass}`, box: { x: .15, y: .6, width: .4, height: .05 } }] };
    return Response.json({ status: "completed", output: [{ type: "message", content: [{ type: "output_text", text: JSON.stringify(section) }] }] });
  });
  const snapshots: DocumentReading[] = [];
  const result = await readDocument(image, undefined, reading => snapshots.push(reading));
  assert.equal(sent.length, 3);
  assert.equal(result.fields.length, 3);
  assert.equal(new Set(result.fields.map(item => item.id)).size, 3);
  for (const snapshot of snapshots) assert.deepEqual(snapshot.fields.find(item => item.id === "primary_name"), snapshots[0].fields[0]);
  assert.ok(snapshots.some(snapshot => snapshot.fields.length === 2));
  assert.deepEqual(snapshots.at(-1), result);
});
