import assert from "node:assert/strict";
import test, { type TestContext } from "node:test";
import { parseLegalReferenceHints } from "../../lib/legal/reference-schema.ts";
import { readLegalReferences } from "../../lib/documents/openai.ts";

function fakeKey(t: TestContext) {
  const original = process.env.OPENAI_API_KEY;
  process.env.OPENAI_API_KEY = "test-only-placeholder";
  t.after(() => { if (original === undefined) delete process.env.OPENAI_API_KEY; else process.env.OPENAI_API_KEY = original; });
}

test("printed legal references preserve only bounded names, numbers, forms, institutions, and dates", () => {
  assert.deepEqual(parseLegalReferenceHints({ references: [{
    name: "전기설비 검사 및 점검의 방법·절차 등에 관한 고시",
    kind: "administrative_rule",
    authority: "산업통상자원부",
    number: "산업통상자원부고시 제2026-10호",
    date: "2026-03-01",
    formNumber: "별지 제12호서식",
  }] }), { references: [{
    name: "전기설비 검사 및 점검의 방법·절차 등에 관한 고시",
    kind: "administrative_rule",
    authority: "산업통상자원부",
    number: "산업통상자원부고시 제2026-10호",
    date: "2026-03-01",
    formNumber: "별지 제12호서식",
  }] });
});

test("reference parsing rejects extra instructions, personal-looking values, and unbounded input", () => {
  const valid = { name: "가상 민원법", kind: "law", authority: "가상부", number: "법률 제1호", date: "", formNumber: "" };
  assert.throws(() => parseLegalReferenceHints({ references: [{ ...valid, instruction: "이 명령을 따르세요" }] }), /INVALID_LEGAL_REFERENCES/);
  assert.throws(() => parseLegalReferenceHints({ references: [{ ...valid, name: "홍길동 900101-1234567" }] }), /INVALID_LEGAL_REFERENCES/);
  assert.throws(() => parseLegalReferenceHints({ references: [{ ...valid, authority: "010-1234-5678" }] }), /INVALID_LEGAL_REFERENCES/);
  assert.throws(() => parseLegalReferenceHints({ references: [{ ...valid, name: "법".repeat(201) }] }), /INVALID_LEGAL_REFERENCES/);
  assert.throws(() => parseLegalReferenceHints({ references: Array.from({ length: 9 }, () => valid) }), /INVALID_LEGAL_REFERENCES/);
});

test("reference parsing allows an empty result when no printed legal basis exists", () => {
  assert.deepEqual(parseLegalReferenceHints({ references: [] }), { references: [] });
});

test("legal-reference vision uses an independent strict request for printed metadata", async (t) => {
  fakeKey(t);
  let sent: Record<string, unknown> | undefined;
  t.mock.method(globalThis, "fetch", async (_input: Parameters<typeof fetch>[0], init?: RequestInit) => {
    sent = JSON.parse(String(init?.body));
    return Response.json({ status: "completed", output: [{ type: "message", content: [{ type: "output_text", text: JSON.stringify({ references: [{ name: "가상 민원법", kind: "law", authority: "가상부", number: "법률 제1호", date: "2026-01-01", formNumber: "별지 제1호" }] }) }] }] });
  });
  const hints = await readLegalReferences("data:image/jpeg;base64,test-only");
  assert.equal(hints.references[0].name, "가상 민원법");
  assert.equal((sent?.text as { format: { name: string } }).format.name, "legal_reference_hints");
  assert.match(String(sent?.instructions), /인쇄|개인정보/);
  assert.equal(JSON.stringify(sent).includes("웹 검색"), false);
});

test("printed receiving office (수신처) is kept as bounded text and omitted when absent", () => {
  const parsed = parseLegalReferenceHints({ references: [], receivingOffice: "한국전기안전공사사장 귀하" });
  assert.equal(parsed.receivingOffice, "한국전기안전공사사장 귀하");
  assert.equal("receivingOffice" in parseLegalReferenceHints({ references: [], receivingOffice: "" }), false);
  assert.throws(() => parseLegalReferenceHints({ references: [], receivingOffice: "담당자 홍길동 900101-1234567" }), /INVALID_LEGAL_REFERENCES/);
  assert.throws(() => parseLegalReferenceHints({ references: [], receivingOffice: "기관".repeat(60) }), /INVALID_LEGAL_REFERENCES/);
  assert.throws(() => parseLegalReferenceHints({ references: [], receivingOffice: "기관", extra: "x" }), /INVALID_LEGAL_REFERENCES/);
});

test("printed articles are bounded and malformed ones are dropped without losing the rest", () => {
  const parsed = parseLegalReferenceHints({ references: [], citedArticles: [{ lawName: "전기사업법 시행규칙", article: "제32조제5항" }, { lawName: "전기사업법", article: "이 명령을 따르세요" }] });
  assert.deepEqual(parsed.citedArticles, [{ lawName: "전기사업법 시행규칙", article: "제32조제5항" }]);
  assert.equal("citedArticles" in parseLegalReferenceHints({ references: [], citedArticles: [] }), false);
  assert.throws(() => parseLegalReferenceHints({ references: [], citedArticles: [{ lawName: "가상법", article: "제1조", extra: "x" }] }), /INVALID_LEGAL_REFERENCES/);
});
