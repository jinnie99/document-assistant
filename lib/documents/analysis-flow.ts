import type { AnalysisResult, DocumentIdentity, DocumentReading } from "./types.ts";
import { MAX_DOCUMENT_FIELDS } from "./limits.ts";

function titleKey(title: string) {
  return title.normalize("NFKC").replace(/[\s\p{P}\p{S}]/gu, "").toLowerCase();
}

export function identityTitleChanged(identity: DocumentIdentity | undefined, document: DocumentReading): boolean {
  return Boolean(identity?.title && document.title && titleKey(identity.title) !== titleKey(document.title));
}

export function documentConfirmationDestination(_identity: DocumentIdentity | undefined, latest: AnalysisResult | undefined): "guide" | "mapping" | "preview" {
  if (!latest) return "mapping";
  if (!latest.document.readable || !latest.document.fields.length) return "preview";
  return "guide";
}

/** 빠른 확인 결과가 없을 때 쓰는 기본 설명. 화면은 이 값을 고른 언어의 문구로 바꿔 보여 준다. */
export const READING_IDENTITY_DESCRIPTION = "사진에서 읽은 서류입니다. 이름이 맞는지 확인해 주세요.";

export function documentIdentityForReading(document: DocumentReading, previous?: DocumentIdentity): DocumentIdentity {
  return {
    title: document.title, institution: document.institution, formNumber: document.formNumber, revision: document.revision,
    readable: document.readable,
    description: previous?.readable && !identityTitleChanged(previous, document) ? previous.description : READING_IDENTITY_DESCRIPTION,
  };
}

function mappingStatus(current: AnalysisResult, incoming: AnalysisResult): AnalysisResult["mappingStatus"] {
  const rank = { in_progress: 0, partial: 1, completed: 2 };
  return rank[current.mappingStatus ?? "completed"] >= rank[incoming.mappingStatus ?? "completed"] ? current.mappingStatus : incoming.mappingStatus;
}

function combine(current: AnalysisResult, incoming: AnalysisResult, changedFieldId?: string, preferIncoming = false): AnalysisResult {
  const fields = current.document.fields.map(field => (preferIncoming || field.id === changedFieldId) ? incoming.document.fields.find(next => next.id === field.id) ?? field : field);
  const ids = new Set(fields.map(field => field.id));
  for (const field of incoming.document.fields) {
    if (fields.length >= MAX_DOCUMENT_FIELDS) break;
    if (!ids.has(field.id)) { fields.push(field); ids.add(field.id); }
  }
  const document = { ...incoming.document, fields };
  if (incoming.mappingStatus === "in_progress") {
    for (const key of ["title", "institution", "formNumber", "revision"] as const) document[key] ||= current.document[key];
  }
  return {
    ...current, ...incoming, document, mappingStatus: mappingStatus(current, incoming),
    search: current.search.status !== "pending" && incoming.search.status === "pending" ? current.search : incoming.search,
  };
}

export function mergeAnalysisFields(current: AnalysisResult | undefined, incoming: AnalysisResult): AnalysisResult | undefined {
  return current?.id === incoming.id ? combine(current, incoming) : current;
}

export function mergeAnalysisSearch(current: AnalysisResult | undefined, incoming: AnalysisResult): AnalysisResult | undefined {
  return mergeAnalysisFields(current, incoming);
}

export function mergeRegionAnalysis(current: AnalysisResult | undefined, incoming: AnalysisResult, changedFieldId?: string): AnalysisResult {
  return current?.id === incoming.id ? combine(current, incoming, changedFieldId, !changedFieldId) : incoming;
}
