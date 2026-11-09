import assert from "node:assert/strict";
import test, { type TestContext } from "node:test";
import { readFileSync } from "node:fs";
import * as documentAI from "../../lib/documents/openai.ts";
import { generateGuidance, searchDocument } from "../../lib/documents/openai.ts";
import type { AnalysisResult } from "../../lib/documents/types.ts";

const analysis: AnalysisResult = { id: "test", expiresAt: "2099-01-01T00:00:00Z", document: { title: "상담 신청서", institution: "가상기관", formNumber: "", revision: "", readable: true, warnings: [], fields: [{ id: "name", label: "이름", box: { x: 0, y: 0, width: 1, height: .1 }, confidence: .9, printedHint: "private-filled-value" }] }, search: { status: "completed", case: "photo_only", summary: "사진으로 설명", sources: [] } };
const message = (value: unknown) => ({ type: "message", content: [{ type: "output_text", text: JSON.stringify(value) }] });
const guide = { fieldId: "name", explanation: "상담받을 분의 이름을 적어요.", example: "홍길동 (가상)", check: "헷갈리면 기관에 확인해요.", provenance: "official_guide", sourceIds: ["invented"], question: null };

function fakeKey(t: TestContext) {
  const original = process.env.OPENAI_API_KEY;
  process.env.OPENAI_API_KEY = "test-only-placeholder";
  t.after(() => { if (original === undefined) delete process.env.OPENAI_API_KEY; else process.env.OPENAI_API_KEY = original; });
}

test("quick identity uses a short independent image request and a cautious description", async (t) => {
  fakeKey(t);
  assert.equal(typeof documentAI.readIdentity, "function");
  const identity = { title: "상담 신청서", institution: "가상기관", formNumber: "", revision: "", description: "상담을 신청할 때 쓰는 서류예요.", readable: true };
  let sent: Record<string, unknown> | undefined;
  let signal: AbortSignal | undefined;
  t.mock.method(globalThis, "fetch", async (_input: Parameters<typeof fetch>[0], init?: RequestInit) => {
    sent = JSON.parse(String(init?.body)); signal = init?.signal as AbortSignal;
    return Response.json({ status: "completed", output: [message(identity)] });
  });
  assert.deepEqual(await documentAI.readIdentity("data:image/jpeg;base64,test-only"), identity);
  assert.equal(sent?.store, false);
  assert.ok(Number(sent?.max_output_tokens) <= 1000);
  assert.ok(signal);
  const instructions = String(sent?.instructions);
  assert.match(instructions, /수수료/);
  assert.match(instructions, /개인정보/);
  assert.match(instructions, /추측|만들/);
});

test("a model cannot promote invented official sources", async (t) => {
  fakeKey(t);
  t.mock.method(globalThis, "fetch", async () => Response.json({ status: "completed", output: [message(guide)] }));
  const result = await generateGuidance(analysis, "name", {});
  assert.equal(result.provenance, "photo_inference");
  assert.deepEqual(result.sourceIds, []);
});

test("suppressing an already-answered question cannot return an empty explanation", async (t) => {
  fakeKey(t);
  const question = { id: "visit", text: "오늘 어떤 일을 보러 오셨나요?", choices: [{ id: "self", label: "제 일로 왔어요" }, { id: "other", label: "다른 분 일을 도와요" }, { id: "unknown", label: "잘 모르겠어요" }] };
  t.mock.method(globalThis, "fetch", async () => Response.json({ status: "completed", output: [message({ ...guide, explanation: "", question })] }));
  await assert.rejects(() => generateGuidance(analysis, "name", { visit: "unknown" }), (error) => error instanceof Error && "code" in error && error.code === "AI_INVALID_RESPONSE");
});

test("web search receives only printed metadata, not field hints or images", async (t) => {
  fakeKey(t);
  const sent: Record<string, unknown>[] = [];
  t.mock.method(globalThis, "fetch", async (_input: Parameters<typeof fetch>[0], init?: RequestInit) => {
    const body = JSON.parse(String(init?.body)) as Record<string, unknown>; sent.push(body);
    return Response.json({ status: "completed", output: body.tools ? [{ type: "web_search_call", status: "completed", action: { sources: [] } }, { type: "message", content: [{ type: "output_text", text: "동일 서류를 확인하지 못했습니다." }] }] : [message({ summary: "찾지 못했어요", sources: [] })] });
  });
  const result = await searchDocument(analysis.document);
  assert.equal(result.status, "completed");
  assert.equal(result.case, "photo_only");
  assert.ok(sent.length >= 2);
  for (const payload of sent) {
    assert.equal(payload.store, false);
    assert.ok(!JSON.stringify(payload).includes("private-filled-value"));
    assert.ok(!JSON.stringify(payload).includes("data:image"));
  }
});

test("an upstream search failure is distinguished from a completed empty search", async (t) => {
  fakeKey(t);
  t.mock.method(globalThis, "fetch", async () => new Response("unavailable", { status: 503 }));
  const result = await searchDocument(analysis.document);
  assert.equal(result.status, "unavailable");
  assert.equal(result.case, "photo_only");
});

test("기관 없는 공통 서식의 실제 조회 대조 값이 파싱과 최종 근거 정책으로 전달된다", async (t) => {
  fakeKey(t);
  const document = { ...analysis.document, institution: "", formNumber: "서식 제11호", fields: [...analysis.document.fields, { ...analysis.document.fields[0], id: "address", label: "등록기준지" }] };
  const source = { id: "source_1", title: document.title, url: "https://example.go.kr/form", kind: "form", official: true, sameForm: true, titleMatches: true, institutionMatches: false, revisionMatches: false, fieldIds: [], evidence: "전국 공통 제11호 서식과 이름·등록기준지 항목을 정부 원문에서 확인", guidance: [], matchedFormNumber: "별지 제11호서식", matchedFieldLabels: ["이름", "등록기준지"] };
  const sent: Record<string, unknown>[] = [];
  t.mock.method(globalThis, "fetch", async (_input: Parameters<typeof fetch>[0], init?: RequestInit) => {
    const body = JSON.parse(String(init?.body)) as Record<string, unknown>; sent.push(body);
    return Response.json({ status: "completed", output: body.tools ? [{ type: "web_search_call", status: "completed", action: { sources: [{ url: source.url }] } }, { type: "message", content: [{ type: "output_text", text: "공식 원문의 전국 공통 서식 번호와 두 항목을 확인했습니다." }] }] : [message({ summary: "같은 공통 서식", sources: [source] })] });
  });
  const result = await searchDocument(document);
  assert.equal(result.status, "completed"); assert.equal(result.case, "form_only");
  assert.equal(result.sources[0].matchedFormNumber, source.matchedFormNumber);
  assert.deepEqual(result.sources[0].matchedFieldLabels, source.matchedFieldLabels);
  const reportRequest = sent.find((body) => !body.tools)!;
  const format = (reportRequest.text as { format: { schema: { properties: { sources: { items: { required: string[] } } } } } }).format;
  assert.ok(format.schema.properties.sources.items.required.includes("matchedFormNumber"));
  assert.ok(format.schema.properties.sources.items.required.includes("matchedFieldLabels"));
});

test("사진 전체와 겹친 확대 부분을 확인하고 부분 좌표를 합친다", async (t) => {
  fakeKey(t);
  const image = `data:image/png;base64,${readFileSync(new URL("../fixtures/fictional-form.png", import.meta.url)).toString("base64")}`;
  const sent: Record<string, unknown>[] = [];
  t.mock.method(globalThis, "fetch", async (_input: Parameters<typeof fetch>[0], init?: RequestInit) => {
    const body = JSON.parse(String(init?.body)) as Record<string, unknown>; sent.push(body);
    const name = (body.text as { format: { name: string } }).format.name;
    const doc = { ...analysis.document, fields: [{ ...analysis.document.fields[0], printedHint: "신청인", box: { x: .1, y: .1, width: .5, height: .05 } }] };
    if (name === "document_section_reading") doc.fields = [{ ...doc.fields[0], label: "주민등록번호", box: { x: .2, y: .3, width: .5, height: .05 } }];
    return Response.json({ status: "completed", output: [message(doc)] });
  });
  const result = await documentAI.readDocument(image);
  assert.equal(sent.length, 3);
  assert.ok(result.fields.some(field => field.label === "주민등록번호"));
  assert.equal(result.title, analysis.document.title);
  assert.ok(result.fields.every(field => field.box.y + field.box.height <= 1.000001));
  assert.ok(sent.every(body => body.store === false));
});

test("부분 확대 확인이 실패해도 전체에서 읽은 항목은 보존하고 경고한다", async (t) => {
  fakeKey(t);
  const image = `data:image/png;base64,${readFileSync(new URL("../fixtures/fictional-form.png", import.meta.url)).toString("base64")}`;
  t.mock.method(globalThis, "fetch", async (_input: Parameters<typeof fetch>[0], init?: RequestInit) => {
    const body = JSON.parse(String(init?.body));
    return body.text.format.name === "document_reading" ? Response.json({ status: "completed", output: [message(analysis.document)] }) : new Response("unavailable", { status: 503 });
  });
  const result = await documentAI.readDocument(image);
  assert.equal(result.fields.length, 1);
  assert.ok(result.warnings.some(warning => /확인.*못|직접/.test(warning)));
});

test("확대된 부분을 읽을 수 없으면 원본 항목을 보존하고 재확인 필요를 알린다", async (t) => {
  fakeKey(t);
  const image = `data:image/png;base64,${readFileSync(new URL("../fixtures/fictional-form.png", import.meta.url)).toString("base64")}`;
  t.mock.method(globalThis, "fetch", async (_input: Parameters<typeof fetch>[0], init?: RequestInit) => {
    const body = JSON.parse(String(init?.body));
    const document = body.text.format.name === "document_reading" ? analysis.document : { ...analysis.document, readable: false, fields: [], warnings: ["글씨가 흐려요."] };
    return Response.json({ status: "completed", output: [message(document)] });
  });
  const result = await documentAI.readDocument(image);
  assert.equal(result.fields.length, 1);
  assert.ok(result.warnings.some(warning => /확인.*못|직접/.test(warning)));
});

test("부분 재확인에 기존 칸의 인쇄 문맥과 부분 좌표를 주고 추가 항목 0개를 정상 처리한다", async (t) => {
  fakeKey(t);
  const image = `data:image/png;base64,${readFileSync(new URL("../fixtures/fictional-form.png", import.meta.url)).toString("base64")}`;
  const sent: Record<string, unknown>[] = [];
  const full = { ...analysis.document, fields: [{ ...analysis.document.fields[0], printedHint: "신청인" }] };
  t.mock.method(globalThis, "fetch", async (_input: Parameters<typeof fetch>[0], init?: RequestInit) => {
    const body = JSON.parse(String(init?.body)); sent.push(body);
    const document = body.text.format.name === "document_reading" ? full : { ...full, fields: [] };
    return Response.json({ status: "completed", output: [message(document)] });
  });
  const result = await documentAI.readDocument(image);
  assert.equal(result.fields.length, 1);
  assert.equal(result.warnings.length, 0);
  const contexts = sent.filter(body => (body.text as { format: { name: string } }).format.name === "document_section_reading").map(body => JSON.parse((body.input as { content: { text: string }[] }[])[0].content[0].text));
  const context = contexts.find(item => item.knownFields.length > 0);
  assert.equal(context.knownFields[0].label, "이름");
  assert.equal(context.knownFields[0].printedHint, "신청인");
  assert.ok(context.knownFields[0].box.height > .1 && context.knownFields[0].box.height < .2);
});

test("확대 재판독 중 취소하면 원본만 성공한 것처럼 반환하지 않는다", async (t) => {
  fakeKey(t);
  const controller = new AbortController();
  const image = `data:image/png;base64,${readFileSync(new URL("../fixtures/fictional-form.png", import.meta.url)).toString("base64")}`;
  t.mock.method(globalThis, "fetch", async (_input: Parameters<typeof fetch>[0], init?: RequestInit) => {
    const body = JSON.parse(String(init?.body));
    if (body.text.format.name === "document_section_reading") controller.abort();
    return Response.json({ status: "completed", output: [message(analysis.document)] });
  });
  await assert.rejects(() => documentAI.readDocument(image, controller.signal), error => error instanceof Error && "code" in error && error.code === "CANCELLED");
});

test("직접 고른 한 칸은 인쇄 항목만 읽고 직원란·읽기 불가 영역은 거절한다", async (t) => {
  fakeKey(t);
  assert.equal(typeof documentAI.readSelectedField, "function");
  let writable = true;
  const sent: Record<string, unknown>[] = [];
  t.mock.method(globalThis, "fetch", async (_input: Parameters<typeof fetch>[0], init?: RequestInit) => {
    sent.push(JSON.parse(String(init?.body)));
    return Response.json({ status: "completed", output: [message({ writable, label: " 주민등록번호 ", printedHint: "신청인", confidence: .9 })] });
  });
  const result = await documentAI.readSelectedField("data:image/jpeg;base64,test-only", "서류");
  assert.equal(result.label, "주민등록번호");
  assert.equal(sent[0].store, false);
  writable = false;
  await assert.rejects(() => documentAI.readSelectedField("data:image/jpeg;base64,test-only", "서류"), error => error instanceof Error && "code" in error && error.code === "REGION_NOT_READABLE");
});
