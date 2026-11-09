import type { LegalPrintedArticle, LegalReferenceHints, LegalReferenceKind, LegalSearchReference } from "./types.ts";

const REFERENCE_KEYS = new Set(["name", "kind", "authority", "number", "date", "formNumber"]);
const LEGAL_NAME = /(법|령|규칙|규정|지침|고시|훈령|예규|조례|기준|요강|절차|시행세칙)/;
const PERSONAL_VALUE = /(?:\d{6}\s*[- ]?\s*[1-4]\d{6})|(?:01[016789]\s*[- ]?\s*\d{3,4}\s*[- ]?\s*\d{4})|(?:[\w.+-]+@[\w.-]+\.[A-Za-z]{2,})/;

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function safeText(value: unknown, maxLength: number, allowEmpty = true): string {
  if (typeof value !== "string" || value.length > maxLength || (!allowEmpty && !value.trim()) || /[\u0000-\u001f\u007f]/.test(value) || PERSONAL_VALUE.test(value)) throw new Error("INVALID_LEGAL_REFERENCES");
  return value.trim();
}

function reference(value: unknown): LegalSearchReference {
  if (!isRecord(value) || Object.keys(value).some(key => !REFERENCE_KEYS.has(key)) || Object.keys(value).length !== REFERENCE_KEYS.size) throw new Error("INVALID_LEGAL_REFERENCES");
  const name = safeText(value.name, 200, false);
  if (!LEGAL_NAME.test(name)) throw new Error("INVALID_LEGAL_REFERENCES");
  if (value.kind !== "law" && value.kind !== "administrative_rule") throw new Error("INVALID_LEGAL_REFERENCES");
  const kind = value.kind as LegalReferenceKind;
  const authority = safeText(value.authority, 100);
  const number = safeText(value.number, 100);
  const date = safeText(value.date, 30);
  const formNumber = safeText(value.formNumber, 100);
  return { name, kind, authority, number, date, formNumber };
}

const ARTICLE = /^제\s*\d+\s*조(?:의\s*\d+)?(?:\s*제\s*\d+\s*항)?(?:\s*제\s*\d+\s*호)?$/;

/** 형식이 어긋난 조문은 전체 실패 대신 그 항목만 버린다. */
function printedArticles(value: unknown): LegalPrintedArticle[] {
  if (value === undefined) return [];
  if (!Array.isArray(value) || value.length > 8) throw new Error("INVALID_LEGAL_REFERENCES");
  return value.flatMap(item => {
    if (!isRecord(item) || Object.keys(item).some(key => key !== "lawName" && key !== "article")) throw new Error("INVALID_LEGAL_REFERENCES");
    const lawName = safeText(item.lawName, 200);
    const article = safeText(item.article, 40).replace(/\s/g, "");
    return lawName && LEGAL_NAME.test(lawName) && ARTICLE.test(article) ? [{ lawName, article }] : [];
  });
}

export function parseLegalReferenceHints(value: unknown): LegalReferenceHints {
  const allowed = new Set(["references", "receivingOffice", "citedArticles"]);
  if (!isRecord(value) || Object.keys(value).some(key => !allowed.has(key)) || !Array.isArray(value.references) || value.references.length > 8) throw new Error("INVALID_LEGAL_REFERENCES");
  const receivingOffice = value.receivingOffice === undefined ? "" : safeText(value.receivingOffice, 100);
  if (receivingOffice.length > 100) throw new Error("INVALID_LEGAL_REFERENCES");
  const hints: LegalReferenceHints = { references: value.references.map(reference) };
  if (receivingOffice) hints.receivingOffice = receivingOffice;
  const citedArticles = printedArticles(value.citedArticles);
  if (citedArticles.length) hints.citedArticles = citedArticles;
  return hints;
}

