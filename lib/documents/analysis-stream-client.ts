import type { AnalysisEvent, AnalysisResult, Box, DocumentField, DocumentIdentity, DocumentReading, DocumentSource, SearchResult } from "./types.ts";
import { MAX_DOCUMENT_FIELDS } from "./limits.ts";

const MAX_EVENT_BYTES = 512 * 1024;
const INVALID_RESPONSE = "분석 응답을 확인하지 못했어요. 다시 시도해 주세요.";
const INCOMPLETE_RESPONSE = "분석 연결이 완료되기 전에 끊겼어요. 다시 시도해 주세요.";
const ANALYSIS_FAILED = "서류를 분석하지 못했어요. 잠시 후 다시 시도해 주세요.";
const ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$/;
const CODE_PATTERN = /^[A-Z][A-Z0-9_]{0,63}$/;

export class AnalysisStreamError extends Error {
  readonly code?: string;

  constructor(message: string, code?: string) {
    super(message);
    this.name = "AnalysisStreamError";
    this.code = code;
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}
function isText(value: unknown, max: number, allowEmpty = true): value is string {
  return typeof value === "string" && value.length <= max && (allowEmpty || value.trim().length > 0);
}
function isId(value: unknown): value is string { return typeof value === "string" && ID_PATTERN.test(value); }
function isCode(value: unknown): value is string { return typeof value === "string" && CODE_PATTERN.test(value); }
function isUnit(value: unknown): value is number { return typeof value === "number" && Number.isFinite(value) && value >= 0 && value <= 1; }
function unique(values: unknown[]): boolean { return new Set(values).size === values.length; }
function isIdList(value: unknown): value is string[] {
  return Array.isArray(value) && value.length <= MAX_DOCUMENT_FIELDS && value.every(isId) && unique(value);
}
function isBox(value: unknown): value is Box {
  return isRecord(value) && isUnit(value.x) && isUnit(value.y) && isUnit(value.width) && value.width > 0 && isUnit(value.height) && value.height > 0
    && value.x + value.width <= 1 + 1e-8 && value.y + value.height <= 1 + 1e-8;
}
function isField(value: unknown): value is DocumentField {
  return isRecord(value) && isId(value.id) && isText(value.label, 80, false) && isBox(value.box) && isUnit(value.confidence) && isText(value.printedHint, 600);
}
function hasMetadata(value: Record<string, unknown>): boolean {
  return isText(value.title, 200) && isText(value.institution, 200) && isText(value.formNumber, 100) && isText(value.revision, 100) && typeof value.readable === "boolean";
}
function isIdentity(value: unknown): value is DocumentIdentity {
  return isRecord(value) && hasMetadata(value) && isText(value.description, 1000);
}
function isReading(value: unknown): value is DocumentReading {
  if (!isRecord(value) || !hasMetadata(value) || !Array.isArray(value.warnings) || value.warnings.length > 8 || !value.warnings.every((warning) => isText(warning, 300, false))) return false;
  return Array.isArray(value.fields) && value.fields.length <= MAX_DOCUMENT_FIELDS && (!value.readable || value.fields.length > 0)
    && value.fields.every(isField) && unique(value.fields.map((field) => field.id));
}
function isSource(value: unknown): value is DocumentSource {
  if (!isRecord(value) || !isId(value.id) || !isText(value.title, 300, false) || !isText(value.url, 2048, false)) return false;
  try {
    const url = new URL(value.url);
    if ((url.protocol !== "https:" && url.protocol !== "http:") || url.username || url.password) return false;
  } catch { return false; }
  if ((value.kind !== "form" && value.kind !== "guide" && value.kind !== "other") || ![value.official, value.sameForm, value.titleMatches, value.institutionMatches, value.revisionMatches].every((flag) => typeof flag === "boolean")) return false;
  if (!isIdList(value.fieldIds) || !isText(value.evidence, 1800) || !Array.isArray(value.guidance) || value.guidance.length > MAX_DOCUMENT_FIELDS) return false;
  if (!value.guidance.every((item) => isRecord(item) && isId(item.fieldId) && isText(item.text, 500, false)) || !unique(value.guidance.map((item) => item.fieldId))) return false;
  return (value.matchedFormNumber === undefined || isText(value.matchedFormNumber, 100))
    && (value.matchedFieldLabels === undefined || (Array.isArray(value.matchedFieldLabels) && value.matchedFieldLabels.length <= MAX_DOCUMENT_FIELDS && value.matchedFieldLabels.every((label) => isText(label, 80, false))));
}
function isSearch(value: unknown): value is SearchResult {
  return isRecord(value) && (value.status === "pending" || value.status === "completed" || value.status === "unavailable") && (value.case === "form_and_guide" || value.case === "form_only" || value.case === "photo_only")
    && isText(value.summary, 500) && Array.isArray(value.sources) && value.sources.length <= 12 && value.sources.every(isSource) && unique(value.sources.map((source) => source.id));
}
function isLegalReference(value: unknown): boolean {
  return isRecord(value) && isText(value.name, 200, false) && (value.kind === "law" || value.kind === "administrative_rule")
    && (value.authority === undefined || isText(value.authority, 100)) && (value.number === undefined || isText(value.number, 100))
    && (value.date === undefined || isText(value.date, 30)) && (value.formNumber === undefined || isText(value.formNumber, 100));
}
function isLegalCandidate(value: unknown): boolean {
  return isRecord(value) && isText(value.id, 160, false) && /^(law|administrative_rule):[A-Za-z0-9_-]+$/.test(value.id as string)
    && isText(value.serialNumber, 100, false) && (value.kind === "law" || value.kind === "administrative_rule")
    && isText(value.name, 200, false) && isText(value.category, 100) && isText(value.authority, 100)
    && isText(value.promulgationNumber, 100) && isText(value.promulgationDate, 30) && isText(value.effectiveDate, 30)
    && (value.status === "current" || value.status === "repealed" || value.status === "unknown")
    && (value.apiTarget === "law" || value.apiTarget === "admrul");
}
function isSafeUrl(value: unknown): value is string {
  if (!isText(value, 2048, false)) return false;
  try { const url = new URL(value); return url.protocol === "https:" && !url.username && !url.password; } catch { return false; }
}
function isLegalContext(value: unknown): boolean {
  if (!isRecord(value) || !["pending", "completed", "unavailable", "ambiguous", "not_found"].includes(String(value.status))) return false;
  if (!Array.isArray(value.detectedReferences) || value.detectedReferences.length > 8 || !value.detectedReferences.every(isLegalReference)) return false;
  if (!Array.isArray(value.candidates) || value.candidates.length > 20 || !value.candidates.every(isLegalCandidate) || !unique(value.candidates.map(item => (item as { id: string }).id))) return false;
  if (value.canonicalRule !== null && !isLegalCandidate(value.canonicalRule)) return false;
  if (value.printedReceivingOffice !== undefined && !isText(value.printedReceivingOffice, 100)) return false;
  if (value.department !== undefined && !isText(value.department, 200)) return false;
  if (value.contacts !== undefined && (!Array.isArray(value.contacts) || value.contacts.length > 10 || !value.contacts.every(item => isRecord(item) && isText(item.department, 200, false) && isText(item.phone, 60, false)))) return false;
  if (value.printedArticles !== undefined && (!Array.isArray(value.printedArticles) || value.printedArticles.length > 8 || !value.printedArticles.every(item => isRecord(item) && isText(item.lawName, 200, false) && isText(item.article, 40, false)))) return false;
  if (!isRecord(value.hierarchy) || ![value.hierarchy.act, value.hierarchy.decree, value.hierarchy.rule].every(item => item === null || isLegalCandidate(item)) || !Array.isArray(value.hierarchy.administrativeRules) || value.hierarchy.administrativeRules.length > 20 || !value.hierarchy.administrativeRules.every(isLegalCandidate)) return false;
  if (!Array.isArray(value.provisions) || value.provisions.length > 80 || !value.provisions.every(item => isRecord(item) && isId(item.id) && isText(item.lawName, 200) && isText(item.article, 80, false) && isText(item.title, 200) && isText(item.text, 5000) && Array.isArray(item.sourceIds) && item.sourceIds.length <= 20 && item.sourceIds.every(isId))) return false;
  if (!Array.isArray(value.forms) || value.forms.length > 120 || !value.forms.every(item => isRecord(item) && isId(item.id) && isText(item.title, 300, false) && isSafeUrl(item.url) && Array.isArray(item.sourceIds) && item.sourceIds.length <= 20 && item.sourceIds.every(isId))) return false;
  if (!isText(value.authority, 200) || !isText(value.summary, 2000) || !isText(value.retrievedAt, 64) || typeof value.stale !== "boolean") return false;
  if (value.procedure !== null && (!isRecord(value.procedure) || !isText(value.procedure.reception, 500) || !isText(value.procedure.submission, 500) || !Array.isArray(value.procedure.requiredItems) || value.procedure.requiredItems.length > 30 || !value.procedure.requiredItems.every(item => isText(item, 500, false)) || !isText(value.procedure.fee, 200) || !isText(value.procedure.processingTime, 200) || !isText(value.procedure.contact, 300) || !Array.isArray(value.procedure.sourceIds) || value.procedure.sourceIds.length > 20 || !value.procedure.sourceIds.every(isId))) return false;
  if (!Array.isArray(value.sources) || value.sources.length > 40 || !value.sources.every(item => isRecord(item) && isId(item.id) && isText(item.title, 300, false) && isSafeUrl(item.url) && ["law", "administrative_rule", "procedure", "form"].includes(String(item.kind)) && isText(item.retrievedAt, 64))) return false;
  return Array.isArray(value.warnings) && value.warnings.length <= 12 && value.warnings.every(item => isText(item, 500, false));
}
function isAnalysis(value: unknown): value is AnalysisResult {
  return isRecord(value) && isId(value.id) && isText(value.expiresAt, 64, false) && Number.isFinite(Date.parse(value.expiresAt)) && isReading(value.document) && isSearch(value.search)
    && (value.mappingStatus === undefined || value.mappingStatus === "in_progress" || value.mappingStatus === "completed" || value.mappingStatus === "partial")
    && (value.legal === undefined || isLegalContext(value.legal));
}
function parseEvent(line: string): AnalysisEvent {
  let value: unknown;
  try { value = JSON.parse(line); } catch { throw new AnalysisStreamError(INVALID_RESPONSE, "INVALID_STREAM"); }
  if (isRecord(value)) {
    if (value.type === "stage" && (value.stage === "identifying" || value.stage === "mapping" || value.stage === "searching")) return value as AnalysisEvent;
    if (value.type === "identity" && isIdentity(value.identity)) return value as AnalysisEvent;
    if ((value.type === "mapped" || value.type === "fields") && isAnalysis(value.analysis)) return value as AnalysisEvent;
    if (value.type === "legal_started" && isId(value.analysisId)) return value as AnalysisEvent;
    if (value.type === "legal_reference" && isId(value.analysisId) && Array.isArray(value.references) && value.references.length <= 8 && value.references.every(isLegalReference)) return value as AnalysisEvent;
    if (value.type === "legal_complete" && isAnalysis(value.analysis) && value.analysis.legal !== undefined && value.analysis.legal.status !== "pending" && value.analysis.legal.status !== "unavailable") return value as AnalysisEvent;
    if (value.type === "legal_unavailable" && isAnalysis(value.analysis) && value.analysis.legal?.status === "unavailable") return value as AnalysisEvent;
    if (value.type === "complete" && isAnalysis(value.analysis) && value.analysis.search.status !== "pending") return value as AnalysisEvent;
    if (value.type === "error" && isCode(value.code) && isText(value.error, 1000, false)) return value as AnalysisEvent;
  }
  throw new AnalysisStreamError(INVALID_RESPONSE, "INVALID_STREAM");
}
function abortError(): DOMException { return new DOMException("분석을 취소했어요.", "AbortError"); }

export async function consumeAnalysisStream(response: Response, onEvent: (event: AnalysisEvent) => void, signal?: AbortSignal): Promise<void> {
  if (signal?.aborted) {
    void response.body?.cancel().catch(() => {});
    throw abortError();
  }
  if (!response.body) throw new AnalysisStreamError(response.ok ? INVALID_RESPONSE : ANALYSIS_FAILED, response.ok ? "INVALID_STREAM" : "HTTP_ERROR");
  let reader: ReadableStreamDefaultReader<Uint8Array>;
  try { reader = response.body.getReader(); } catch { throw new AnalysisStreamError(INVALID_RESPONSE, "INVALID_STREAM"); }
  let canceled = false;
  const cancelReader = () => {
    if (!canceled) { canceled = true; void reader.cancel().catch(() => {}); }
  };
  let rejectAbort!: (error: DOMException) => void;
  const aborted = new Promise<never>((_resolve, reject) => { rejectAbort = reject; });
  const onAbort = () => { cancelReader(); rejectAbort(abortError()); };
  const checkAbort = () => { if (signal?.aborted) throw abortError(); };
  const readChunk = async () => {
    checkAbort();
    try {
      const result = await Promise.race([reader.read(), aborted]);
      checkAbort();
      return result;
    } catch {
      checkAbort();
      throw new AnalysisStreamError(INCOMPLETE_RESPONSE, "INCOMPLETE_STREAM");
    }
  };
  signal?.addEventListener("abort", onAbort, { once: true });
  try {
    checkAbort();
    if (!response.ok) {
      let body = "", bytes = 0, code = "HTTP_ERROR";
      const decoder = new TextDecoder("utf-8", { fatal: true });
      try {
        while (true) {
          const { done, value } = await readChunk();
          if (done) { body += decoder.decode(); break; }
          bytes += value.byteLength;
          if (bytes > MAX_EVENT_BYTES) break;
          body += decoder.decode(value, { stream: true });
        }
        if (bytes <= MAX_EVENT_BYTES) {
          const error: unknown = JSON.parse(body);
          if (isRecord(error) && isCode(error.code)) code = error.code;
        }
      } catch { checkAbort(); }
      throw new AnalysisStreamError(ANALYSIS_FAILED, code);
    }
    if (response.headers.get("Content-Type")?.split(";")[0].trim().toLowerCase() !== "application/x-ndjson") throw new AnalysisStreamError(INVALID_RESPONSE, "INVALID_STREAM");

    const decoder = new TextDecoder("utf-8", { fatal: true });
    let pending = "", lineBytes = 0;
    const decode = (bytes?: Uint8Array) => {
      try { return bytes ? decoder.decode(bytes, { stream: true }) : decoder.decode(); }
      catch { throw new AnalysisStreamError(INVALID_RESPONSE, "INVALID_STREAM"); }
    };
    const append = (bytes: Uint8Array) => {
      lineBytes += bytes.byteLength;
      if (lineBytes > MAX_EVENT_BYTES) throw new AnalysisStreamError(INVALID_RESPONSE, "EVENT_TOO_LARGE");
      pending += decode(bytes);
    };
    const publish = (): boolean => {
      pending += decode();
      const line = pending.trim();
      pending = ""; lineBytes = 0;
      if (!line) return false;
      checkAbort();
      const event = parseEvent(line);
      onEvent(event);
      checkAbort();
      if (event.type === "error") throw new AnalysisStreamError(ANALYSIS_FAILED, event.code);
      return event.type === "complete";
    };
    while (true) {
      const { done, value } = await readChunk();
      if (done) {
        if (publish()) return;
        throw new AnalysisStreamError(INCOMPLETE_RESPONSE, "INCOMPLETE_STREAM");
      }
      let offset = 0;
      for (let index = 0; index < value.length; index++) {
        if (value[index] !== 10) continue;
        append(value.subarray(offset, index));
        if (publish()) return;
        offset = index + 1;
      }
      append(value.subarray(offset));
    }
  } finally {
    signal?.removeEventListener("abort", onAbort);
    cancelReader();
    reader.releaseLock();
  }
}
