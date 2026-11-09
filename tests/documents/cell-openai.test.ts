import assert from "node:assert/strict";
import test, { type TestContext } from "node:test";
import sharp from "sharp";
import { readDocument } from "../../lib/documents/openai.ts";
import type { Box, DocumentReading } from "../../lib/documents/types.ts";

type Cell = { id: string; box: Box };
type RequestBody = {
  stream?: boolean;
  input: { content: { type: string; text?: string; image_url?: string }[] }[];
  text: { format: { name: string; schema: { properties: { fields: { items: { required: string[] } } } } } };
};
const encoding = new TextEncoder();
const event = (type: string, value: Record<string, unknown>) => `event: ${type}\ndata: ${JSON.stringify({ type, ...value })}\n\n`;
const delta = (text: string) => event("response.output_text.delta", { output_index: 0, content_index: 0, delta: text });
const completed = (text: string) => event("response.completed", { response: { status: "completed", output: [{ type: "message", content: [{ type: "output_text", text }] }] } });
const streamed = (text: string) => new Response(encoding.encode(delta(text) + completed(text)), { headers: { "Content-Type": "text/event-stream" } });
const response = (value: unknown) => Response.json({ status: "completed", output: [{ type: "message", content: [{ type: "output_text", text: JSON.stringify(value) }] }] });
const reading = { title: "가상 신청서", institution: "가상기관", formNumber: "", revision: "", readable: true, warnings: [] };
const primaryBox: Box = { x: .1, y: .1, width: .4, height: .3 };
const bottomBox: Box = { x: .5, y: .7, width: .4, height: .2 };
const textBox: Box = { x: .2, y: .18, width: .12, height: .04 };
const field = (cellId: unknown, box = textBox, id = "primary_name", label = "신청인 성명") => ({ id, label, printedHint: "신청인", box, confidence: .9, cellId });

function fakeKey(t: TestContext) {
  const original = process.env.OPENAI_API_KEY;
  process.env.OPENAI_API_KEY = "test-only-placeholder";
  t.after(() => { if (original === undefined) delete process.env.OPENAI_API_KEY; else process.env.OPENAI_API_KEY = original; });
}

async function tableImage() {
  const svg = `<svg width="600" height="500" xmlns="http://www.w3.org/2000/svg"><rect width="100%" height="100%" fill="white"/><path d="M60 50H540 M60 200H540 M60 350H540 M60 450H540 M60 50V450 M300 50V450 M540 50V450" fill="none" stroke="black" stroke-width="2"/></svg>`;
  const bytes = await sharp(Buffer.from(svg)).png().toBuffer();
  return `data:image/png;base64,${bytes.toString("base64")}`;
}

function context(body: RequestBody): { tableCells: Cell[]; knownFields?: unknown[] } {
  const text = body.input[0].content.find(part => part.type === "input_text")?.text;
  assert.ok(text, "vision request should include JSON context");
  return JSON.parse(text);
}

function noInternalCells(document: DocumentReading) {
  for (const item of document.fields) assert.equal(Object.hasOwn(item, "cellId"), false);
}

function assertBox(actual: Box, expected: Box) {
  for (const key of ["x", "y", "width", "height"] as const) assert.ok(Math.abs(actual[key] - expected[key]) < .004, `${key}: ${actual[key]} should match ${expected[key]}`);
}

const hasCode = (expected: string) => (error: unknown) => error instanceof Error && "code" in error && error.code === expected;

test("a table cell selected by the model is published before primary SSE completion", async t => {
  fakeKey(t);
  const image = await tableImage();
  let source: ReadableStreamDefaultController<Uint8Array> | undefined;
  let finishText = "";
  let suppliedCellBox: Box | undefined;
  let notify!: () => void;
  const notified = new Promise<void>(resolve => { notify = resolve; });
  const sent: RequestBody[] = [];
  t.mock.method(globalThis, "fetch", async (_url: unknown, init?: RequestInit) => {
    const body = JSON.parse(String(init?.body)) as RequestBody;
    sent.push(body);
    if (!body.stream) return response({ ...reading, fields: [] });
    const selected = context(body).tableCells.find(cell => cell.id === "cell_1");
    assert.ok(selected, "primary request must supply detected table cells");
    assertBox(selected.box, primaryBox);
    suppliedCellBox = selected.box;
    assert.ok(body.text.format.schema.properties.fields.items.required.includes("cellId"));
    finishText = JSON.stringify({ ...reading, fields: [field(selected.id)] });
    const split = finishText.lastIndexOf("]");
    return new Response(new ReadableStream<Uint8Array>({ start(controller) { source = controller; controller.enqueue(encoding.encode(delta(finishText.slice(0, split)))); } }));
  });
  const snapshots: DocumentReading[] = [];
  let finished = false;
  const work = readDocument(image, undefined, value => { snapshots.push(value); notify(); }).finally(() => { finished = true; });
  void work.catch(() => {});
  let deadline: ReturnType<typeof setTimeout> | undefined;
  try {
    await Promise.race([notified, work, new Promise<never>((_, reject) => { deadline = setTimeout(() => reject(new Error("cell was not published before primary completion")), 2000); })]);
    assert.equal(finished, false);
    assertBox(snapshots[0].fields[0].box, primaryBox);
    assert.deepEqual(snapshots[0].fields[0].box, suppliedCellBox);
    assert.equal(snapshots[0].fields[0].id, "primary_name");
    noInternalCells(snapshots[0]);
  } finally {
    clearTimeout(deadline);
    if (source) { source.enqueue(encoding.encode(delta(finishText.slice(finishText.lastIndexOf("]"))) + completed(finishText))); source.close(); }
  }
  const result = await work;
  assert.deepEqual(result.fields[0], snapshots[0].fields[0]);
  for (const snapshot of snapshots) noInternalCells(snapshot);
  assert.equal(sent.length, 3);
});

test("the primary vision image visibly marks the numbered cells supplied in context", async t => {
  fakeKey(t);
  const image = await tableImage();
  let annotated = "";
  t.mock.method(globalThis, "fetch", async (_url: unknown, init?: RequestInit) => {
    const body = JSON.parse(String(init?.body)) as RequestBody;
    if (body.text.format.name !== "document_reading") return response({ ...reading, fields: [] });
    const cells = context(body).tableCells;
    assert.equal(cells.length, 6);
    annotated = body.input[0].content.find(part => part.type === "input_image")?.image_url || "";
    return response({ ...reading, fields: [field(cells[0].id)] });
  });
  await readDocument(image);
  assert.notEqual(annotated, image);
  const { data, info } = await sharp(Buffer.from(annotated.slice(annotated.indexOf(",") + 1), "base64")).removeAlpha().raw().toBuffer({ resolveWithObject: true });
  let amber = 0;
  for (let index = 0; index < data.length; index += info.channels) {
    const [red, green, blue] = [data[index], data[index + 1], data[index + 2]];
    if (red > 100 && red - green > 15 && green - blue > 8) amber++;
  }
  assert.ok(amber > 100, "the model image should visibly distinguish cell markers from the monochrome form");
});

test("nonstream primary readings resolve cell IDs to the same full cell rectangles", async t => {
  fakeKey(t);
  t.mock.method(globalThis, "fetch", async (_url: unknown, init?: RequestInit) => {
    const body = JSON.parse(String(init?.body)) as RequestBody;
    if (body.text.format.name !== "document_reading") return response({ ...reading, fields: [] });
    const selected = context(body).tableCells.find(cell => cell.id === "cell_1");
    assert.ok(selected);
    return response({ ...reading, fields: [field(selected.id)] });
  });
  const result = await readDocument(await tableImage());
  assert.equal(result.fields.length, 1);
  assertBox(result.fields[0].box, primaryBox);
  noInternalCells(result);
});

test("cropped reading keeps global cell IDs and maps a new cell back to its full-image rectangle", async t => {
  fakeKey(t);
  const cropContexts: Cell[][] = [];
  const snapshots: DocumentReading[] = [];
  t.mock.method(globalThis, "fetch", async (_url: unknown, init?: RequestInit) => {
    const body = JSON.parse(String(init?.body)) as RequestBody;
    const cells = context(body).tableCells;
    if (body.stream) return streamed(JSON.stringify({ ...reading, fields: [field(cells.find(cell => cell.id === "cell_1")!.id)] }));
    cropContexts.push(cells);
    const selected = cells.find(cell => cell.id === "cell_6");
    return response({ ...reading, fields: selected ? [field(selected.id, { x: .65, y: .6, width: .12, height: .04 }, "primary_name", "대리인 연락처")] : [] });
  });
  const result = await readDocument(await tableImage(), undefined, value => snapshots.push(value));
  const bottomContext = cropContexts.find(cells => cells.some(cell => cell.id === "cell_6"));
  assert.ok(bottomContext);
  assert.ok(!bottomContext.some(cell => cell.id === "cell_1"), "the lower crop should not renumber its first visible cell as cell_1");
  const selected = bottomContext.find(cell => cell.id === "cell_6")!;
  assert.ok(Math.abs(selected.box.y - (.7 - .44) / .56) < .01, "crop context should use crop-relative coordinates");
  const primary = result.fields.find(item => item.label === "신청인 성명")!;
  const addition = result.fields.find(item => item.label === "대리인 연락처")!;
  assert.equal(primary.id, "primary_name");
  assert.notEqual(addition.id, primary.id);
  assertBox(primary.box, primaryBox);
  assertBox(addition.box, bottomBox);
  for (const snapshot of snapshots) {
    assert.deepEqual(snapshot.fields.find(item => item.id === primary.id), snapshots[0].fields[0]);
    noInternalCells(snapshot);
  }
});

for (const cellId of ["", "cell_9999"]) test(`an ${cellId ? "unknown" : "empty"} cell ID preserves validated fallback geometry`, async t => {
  fakeKey(t);
  t.mock.method(globalThis, "fetch", async (_url: unknown, init?: RequestInit) => {
    const body = JSON.parse(String(init?.body)) as RequestBody;
    return body.stream ? streamed(JSON.stringify({ ...reading, fields: [field(cellId)] })) : response({ ...reading, fields: [] });
  });
  const snapshots: DocumentReading[] = [];
  const result = await readDocument(await tableImage(), undefined, value => snapshots.push(value));
  assert.deepEqual(snapshots[0].fields[0].box, textBox);
  assert.deepEqual(result.fields[0].box, textBox);
  noInternalCells(result);
});

for (const cellId of [1, { id: "cell_1" }]) test(`a malformed ${typeof cellId} cell ID cannot produce a successful reading`, async t => {
  fakeKey(t);
  const image = await tableImage();
  t.mock.method(globalThis, "fetch", async () => streamed(JSON.stringify({ ...reading, fields: [field(cellId)] })));
  let published = 0;
  await assert.rejects(() => readDocument(image, undefined, () => { published++; }), hasCode("AI_INVALID_RESPONSE"));
  assert.equal(published, 0);
});

test("aborting after the first mapped cell stops later fields in the same stream chunk", async t => {
  fakeKey(t);
  const controller = new AbortController();
  t.mock.method(globalThis, "fetch", async (_url: unknown, init?: RequestInit) => {
    const body = JSON.parse(String(init?.body)) as RequestBody;
    const cells = context(body).tableCells;
    return streamed(JSON.stringify({ ...reading, fields: [field(cells[0].id), field(cells[1].id, textBox, "address", "주소")] }));
  });
  const snapshots: DocumentReading[] = [];
  const image = await tableImage();
  await assert.rejects(() => readDocument(image, controller.signal, value => { snapshots.push(value); controller.abort(); }), hasCode("CANCELLED"));
  assert.equal(snapshots.length, 1);
  assertBox(snapshots[0].fields[0].box, primaryBox);
  noInternalCells(snapshots[0]);
});
