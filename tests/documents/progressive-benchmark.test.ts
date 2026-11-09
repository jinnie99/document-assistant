import assert from "node:assert/strict";
import test from "node:test";
import { resolve } from "node:path";
import { runProgressiveFixture } from "../../scripts/verify-progressive-analysis.ts";
import type { AnalysisEvent, AnalysisResult, FieldGuidance } from "../../lib/documents/types.ts";

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>(yes => { resolve = yes; });
  return { promise, resolve };
}
const first = { id: "field_1", label: "성명", box: { x: .1, y: .2, width: .4, height: .05 }, confidence: .9, printedHint: "" };
const analysis: AnalysisResult = {
  id: "test_session", document: { title: "테스트 신청서", institution: "", formNumber: "", revision: "", readable: true, warnings: [], fields: [first] },
  mappingStatus: "in_progress", search: { status: "pending", case: "photo_only", summary: "찾고 있어요.", sources: [] }, expiresAt: "2030-01-01T00:00:00.000Z",
};
const guidance: FieldGuidance = { fieldId: first.id, explanation: "이름을 적어요.", example: "김가람", check: "이름을 확인해요.", provenance: "photo_inference", sourceIds: [], question: null };
const fixture = { id: "test_fixture", imagePath: resolve("tests/fixtures/fictional-form.png") };

test("progressive benchmark consumes later fields while its one guide request is pending and deletes after both complete", { timeout: 5000 }, async () => {
  const guideStarted = deferred<void>();
  const guideResponse = deferred<Response>();
  const nextFieldsObserved = deferred<void>();
  let controller!: ReadableStreamDefaultController<Uint8Array>;
  const body = new ReadableStream<Uint8Array>({ start(value) { controller = value; } });
  const publish = (event: AnalysisEvent) => controller.enqueue(new TextEncoder().encode(JSON.stringify(event) + "\n"));
  const requests: string[] = [];
  const request: typeof fetch = async (input, init) => {
    const path = new URL(String(input)).pathname;
    requests.push(`${init?.method} ${path}`);
    if (init?.method === "DELETE") return Response.json({ deleted: true });
    if (path.endsWith("/guide")) { guideStarted.resolve(); return guideResponse.promise; }
    publish({ type: "identity", identity: { ...analysis.document, description: "빈 신청서예요." } });
    publish({ type: "mapped", analysis });
    return new Response(body, { headers: { "Content-Type": "application/x-ndjson" } });
  };
  const task = runProgressiveFixture(fixture, new URL("http://127.0.0.1:3000"), {
    request,
    onProgress: value => { if (value.event === "fields" && value.fieldCount === 2) nextFieldsObserved.resolve(); },
  });
  await guideStarted.promise;
  const expanded = { ...analysis, document: { ...analysis.document, fields: [first, { ...first, id: "field_2", label: "주소" }] } };
  publish({ type: "fields", analysis: expanded });
  await nextFieldsObserved.promise;
  assert.deepEqual(requests, ["POST /api/documents/analyze", "POST /api/documents/guide"]);
  guideResponse.resolve(Response.json(guidance));
  await new Promise(yes => setImmediate(yes));
  publish({ type: "fields", analysis: { ...expanded, mappingStatus: "completed" } });
  publish({ type: "complete", analysis: { ...expanded, mappingStatus: "completed", search: { ...analysis.search, status: "completed" } } });
  controller.close();
  const benchmark = await task;
  assert.equal(benchmark.passed, true);
  assert.equal(benchmark.firstMapped?.fieldCount, 1);
  assert.deepEqual(benchmark.updates.map(value => [value.event, value.fieldCount, value.mappingStatus]), [["mapped", 1, "in_progress"], ["fields", 2, "in_progress"], ["fields", 2, "completed"], ["complete", 2, "completed"]]);
  assert.equal(benchmark.checks.firstFieldStable, true);
  assert.equal(benchmark.checks.guideFinishedBeforeMappingComplete, true);
  assert.equal(benchmark.checks.guideFinishedBeforeComplete, true);
  assert.deepEqual(benchmark.requestCounts, { analyze: 1, guide: 1, delete: 1 });
  assert.equal(benchmark.cleanup?.deleted, true);
  assert.deepEqual(requests, ["POST /api/documents/analyze", "POST /api/documents/guide", "DELETE /api/documents/analyze"]);
});

test("progressive benchmark records changed first coordinates as failure without leaking body text", { timeout: 5000 }, async () => {
  const encoder = new TextEncoder();
  const changed = { ...analysis, document: { ...analysis.document, fields: [{ ...first, box: { ...first.box, y: .4 } }, { ...first, id: "field_2" }] }, mappingStatus: "completed" as const, search: { ...analysis.search, status: "completed" as const } };
  const request: typeof fetch = async (input, init) => {
    if (init?.method === "DELETE") return Response.json({ deleted: true });
    if (new URL(String(input)).pathname.endsWith("/guide")) return Response.json({ error: "provider secret body" }, { status: 502 });
    return new Response(new ReadableStream({ start(controller) {
      for (const event of [{ type: "mapped", analysis }, { type: "fields", analysis: changed }, { type: "complete", analysis: changed }]) controller.enqueue(encoder.encode(JSON.stringify(event) + "\n"));
      controller.close();
    } }), { headers: { "Content-Type": "application/x-ndjson" } });
  };
  const benchmark = await runProgressiveFixture(fixture, new URL("http://127.0.0.1:3000"), { request, onProgress: () => {} });
  assert.equal(benchmark.passed, false);
  assert.equal(benchmark.checks.firstFieldStable, false);
  assert.equal(benchmark.guide.httpStatus, 502);
  assert.equal(benchmark.cleanup?.deleted, true);
  assert.ok(benchmark.failureCodes.includes("FIRST_FIELD_CHANGED"));
  assert.ok(benchmark.failureCodes.includes("GUIDE_HTTP_FAILED"));
  assert.ok(!JSON.stringify(benchmark).includes("provider secret body"));
});
