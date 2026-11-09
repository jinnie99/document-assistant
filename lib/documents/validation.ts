import type { Box, DocumentField, DocumentIdentity, DocumentReading, DocumentSource, FieldGuidance, SituationQuestion } from "./types.ts";
import { MAX_DOCUMENT_FIELDS } from "./limits.ts";

type RecordValue = Record<string, unknown>;
const MAX_FIELDS = MAX_DOCUMENT_FIELDS;
const MAX_IMAGE_BYTES = 6 * 1024 * 1024;
const ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$/;

function invalid(label: string): never { throw new TypeError(`${label} 형식을 확인하지 못했어요.`); }
function object(value: unknown, keys: string[], label: string, optional: string[] = []): RecordValue {
  if (!value || typeof value !== "object" || Array.isArray(value)) return invalid(label);
  const record = value as RecordValue;
  const optionalCount = optional.filter((key) => Object.hasOwn(record, key)).length;
  if (Object.keys(record).length !== keys.length + optionalCount || keys.some((key) => !Object.hasOwn(record, key))) return invalid(label);
  return record;
}
function text(value: unknown, label: string, max: number, empty = false): string {
  if (typeof value !== "string" || value.length > max || (!empty && !value.trim())) return invalid(label);
  return value.trim();
}
function id(value: unknown, label: string): string {
  const result = text(value, label, 64);
  if (!ID_PATTERN.test(result)) return invalid(label);
  return result;
}
function boolean(value: unknown, label: string): boolean {
  if (typeof value !== "boolean") return invalid(label);
  return value;
}
function bounded(value: unknown, label: string, positive = false): number {
  if (typeof value !== "number" || !Number.isFinite(value) || value > 1 || (positive ? value <= 0 : value < 0)) return invalid(label);
  return value;
}
function list<T>(value: unknown, label: string, parse: (item: unknown) => T, max: number, min = 0): T[] {
  if (!Array.isArray(value) || value.length < min || value.length > max) return invalid(label);
  return value.map(parse);
}
function unique(values: string[], label: string): string[] {
  if (new Set(values).size !== values.length) return invalid(label);
  return values;
}
function box(value: unknown): Box {
  const raw = object(value, ["x", "y", "width", "height"], "칸 위치");
  const parsed = { x: bounded(raw.x, "칸 위치"), y: bounded(raw.y, "칸 위치"), width: bounded(raw.width, "칸 너비", true), height: bounded(raw.height, "칸 높이", true) };
  if (parsed.x + parsed.width > 1 + 1e-8 || parsed.y + parsed.height > 1 + 1e-8) return invalid("칸 위치");
  return parsed;
}
export function parseField(value: unknown): DocumentField {
  const raw = object(value, ["id", "label", "box", "confidence", "printedHint"], "문서 항목");
  return { id: id(raw.id, "항목 ID"), label: text(raw.label, "항목 이름", 80), box: box(raw.box), confidence: bounded(raw.confidence, "판독 신뢰도"), printedHint: text(raw.printedHint, "인쇄 안내", 600, true) };
}

export function parseIdentity(value: unknown): DocumentIdentity {
  const raw = object(value, ["title", "institution", "formNumber", "revision", "description", "readable"], "서류 확인 결과");
  const readable = boolean(raw.readable, "판독 가능 여부");
  const description = text(raw.description, "서류 설명", 200, true);
  return {
    title: text(raw.title, "서류 이름", 200, true), institution: text(raw.institution, "기관 이름", 200, true),
    formNumber: text(raw.formNumber, "서식 번호", 100, true), revision: text(raw.revision, "개정 정보", 100, true),
    description: readable ? description : "", readable,
  };
}

export function parseReading(value: unknown, options: { allowEmptyFields?: boolean } = {}): DocumentReading {
  const raw = object(value, ["title", "institution", "formNumber", "revision", "readable", "warnings", "fields"], "사진 분석 결과");
  const fields = list(raw.fields, "문서 항목", parseField, MAX_FIELDS);
  unique(fields.map((item) => item.id), "중복 항목 ID");
  const readable = boolean(raw.readable, "판독 가능 여부");
  if (readable && fields.length === 0 && !options.allowEmptyFields) return invalid("문서 항목");
  return {
    title: text(raw.title, "서류 이름", 200, true), institution: text(raw.institution, "기관 이름", 200, true),
    formNumber: text(raw.formNumber, "서식 번호", 100, true), revision: text(raw.revision, "개정 정보", 100, true),
    readable, warnings: list(raw.warnings, "사진 주의 사항", (item) => text(item, "사진 주의 사항", 300), 8), fields,
  };
}

function source(value: unknown): DocumentSource {
  const raw = object(value, ["id", "title", "url", "kind", "official", "sameForm", "titleMatches", "institutionMatches", "revisionMatches", "fieldIds", "evidence", "guidance"], "검색 자료", ["matchedFormNumber", "matchedFieldLabels"]);
  const url = text(raw.url, "자료 주소", 2048);
  let parsedUrl: URL;
  try { parsedUrl = new URL(url); } catch { return invalid("자료 주소"); }
  if (!["https:", "http:"].includes(parsedUrl.protocol) || parsedUrl.username || parsedUrl.password) return invalid("자료 주소");
  if (raw.kind !== "form" && raw.kind !== "guide" && raw.kind !== "other") return invalid("자료 종류");
  const guidance = list(raw.guidance, "칸별 작성 지침", (value) => {
    const item = object(value, ["fieldId", "text"], "칸별 작성 지침");
    return { fieldId: id(item.fieldId, "작성 지침 항목 ID"), text: text(item.text, "칸별 작성 지침 내용", 500) };
  }, MAX_FIELDS);
  unique(guidance.map((item) => item.fieldId), "중복 작성 지침 항목");
  return {
    id: id(raw.id, "자료 ID"), title: text(raw.title, "자료 제목", 300), url, kind: raw.kind,
    official: boolean(raw.official, "공식 자료 여부"), sameForm: boolean(raw.sameForm, "동일 서류 여부"),
    titleMatches: boolean(raw.titleMatches, "서류 이름 일치"), institutionMatches: boolean(raw.institutionMatches, "기관 일치"), revisionMatches: boolean(raw.revisionMatches, "개정 정보 일치"),
    fieldIds: unique(list(raw.fieldIds, "근거 항목", (item) => id(item, "근거 항목 ID"), MAX_FIELDS), "중복 근거 항목"),
    evidence: text(raw.evidence, "자료 확인 내용", 1800, true),
    guidance,
    matchedFormNumber: Object.hasOwn(raw, "matchedFormNumber") ? text(raw.matchedFormNumber, "대조한 서식번호", 100, true) : "",
    matchedFieldLabels: Object.hasOwn(raw, "matchedFieldLabels") ? list(raw.matchedFieldLabels, "대조한 항목명", (item) => text(item, "대조한 항목명", 80), MAX_FIELDS) : [],
  };
}

export function parseSearchReport(value: unknown): { summary: string; sources: DocumentSource[] } {
  const raw = object(value, ["summary", "sources"], "검색 결과");
  const sources = list(raw.sources, "검색 자료", source, 12);
  unique(sources.map((item) => item.id), "중복 자료 ID");
  return { summary: text(raw.summary, "검색 요약", 500, true), sources };
}

function question(value: unknown): SituationQuestion | null {
  if (value === null) return null;
  const raw = object(value, ["id", "text", "choices"], "상황 질문");
  const choices = list(raw.choices, "질문 선택지", (item) => {
    const choice = object(item, ["id", "label"], "질문 선택지");
    return { id: id(choice.id, "선택지 ID"), label: text(choice.label, "선택지 이름", 20) };
  }, 3, 3);
  unique(choices.map((item) => item.id), "중복 선택지 ID");
  unique(choices.map((item) => item.label), "중복 선택지 이름");
  if (!choices.some((item) => item.id === "unknown" && /모르/.test(item.label))) return invalid("모름 선택지");
  return { id: id(raw.id, "질문 ID"), text: text(raw.text, "질문 내용", 50), choices };
}

export function parseGuidance(value: unknown, fieldId: string): FieldGuidance {
  const raw = object(value, ["fieldId", "explanation", "example", "check", "provenance", "sourceIds", "question"], "칸 안내");
  const parsedId = id(raw.fieldId, "항목 ID");
  if (parsedId !== fieldId) return invalid("요청한 항목");
  if (!["official_guide", "form_context", "photo_inference"].includes(String(raw.provenance))) return invalid("안내 근거 종류");
  const parsedQuestion = question(raw.question);
  return {
    fieldId: parsedId, explanation: text(raw.explanation, "작성 설명", 80, Boolean(parsedQuestion)),
    example: text(raw.example, "작성 예시", 80, true), check: text(raw.check, "확인할 내용", 80, true),
    provenance: raw.provenance as FieldGuidance["provenance"],
    sourceIds: unique(list(raw.sourceIds, "참고 자료", (item) => id(item, "자료 ID"), 12), "중복 참고 자료"), question: parsedQuestion,
  };
}

export function validateImage(value: unknown): string {
  if (typeof value !== "string" || value.length > Math.ceil(MAX_IMAGE_BYTES / 3) * 4 + 30) return invalid("사진");
  const matched = /^data:image\/(png|jpeg);base64,([A-Za-z0-9+/]+={0,2})$/.exec(value);
  if (!matched || matched[2].length > Math.ceil(MAX_IMAGE_BYTES / 3) * 4) return invalid("사진");
  const bytes = Buffer.from(matched[2], "base64");
  if (bytes.length > MAX_IMAGE_BYTES || bytes.toString("base64") !== matched[2]) return invalid("사진");
  const png = bytes.length >= 8 && bytes.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]));
  const jpeg = bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff;
  if ((matched[1] === "png" && (!png || !validPng(bytes))) || (matched[1] === "jpeg" && (!jpeg || !validJpeg(bytes)))) return invalid("사진 파일 형식");
  return value;
}

function validSize(width: number, height: number): boolean {
  return width > 0 && height > 0 && width <= 20000 && height <= 20000 && width * height <= 40_000_000;
}
function validPng(bytes: Buffer): boolean {
  let offset = 8, hasData = false, hasHeader = false;
  while (offset + 12 <= bytes.length) {
    const size = bytes.readUInt32BE(offset);
    if (size > bytes.length - offset - 12) return false;
    const type = bytes.toString("ascii", offset + 4, offset + 8);
    if (!hasHeader) {
      if (type !== "IHDR" || size !== 13 || !validSize(bytes.readUInt32BE(offset + 8), bytes.readUInt32BE(offset + 12))) return false;
      hasHeader = true;
    } else if (type === "IHDR") return false;
    if (type === "IDAT" && size > 0) hasData = true;
    if (type === "IEND") return size === 0 && hasData && offset + 12 === bytes.length;
    offset += size + 12;
  }
  return false;
}
function validJpeg(bytes: Buffer): boolean {
  if (bytes.length < 16 || bytes[bytes.length - 2] !== 0xff || bytes[bytes.length - 1] !== 0xd9) return false;
  let offset = 2, hasFrame = false;
  while (offset + 4 <= bytes.length) {
    if (bytes[offset++] !== 0xff) return false;
    while (bytes[offset] === 0xff) offset++;
    const marker = bytes[offset++];
    if (offset + 2 > bytes.length) return false;
    const size = bytes.readUInt16BE(offset);
    if (size < 2 || offset + size > bytes.length) return false;
    if (marker >= 0xc0 && marker <= 0xcf && ![0xc4, 0xc8, 0xcc].includes(marker)) {
      if (size < 8 || !validSize(bytes.readUInt16BE(offset + 5), bytes.readUInt16BE(offset + 3))) return false;
      hasFrame = true;
    }
    if (marker === 0xda) return hasFrame && size >= 6 && offset + size < bytes.length - 2;
    offset += size;
  }
  return false;
}
