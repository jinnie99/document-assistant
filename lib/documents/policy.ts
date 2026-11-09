import type { AnalysisResult, DocumentReading, DocumentSource, Provenance, SearchResult } from "./types.ts";

type SearchReport = { summary: string; sources: DocumentSource[] };
function canonicalUrl(value: string): string | undefined {
  try {
    const url = new URL(value);
    if (!["http:", "https:"].includes(url.protocol) || url.username || url.password) return undefined;
    const host = url.hostname.toLowerCase();
    if (host === "localhost" || host.endsWith(".localhost") || host.endsWith(".local") || host === "[::1]" || /^(?:127\.|10\.|192\.168\.|169\.254\.|0\.)/.test(host) || /^172\.(?:1[6-9]|2\d|3[01])\./.test(host)) return undefined;
    url.hash = "";
    return url.href;
  } catch { return undefined; }
}

function formNumberKey(value: string): string {
  return value.normalize("NFKC").toLowerCase().replace(/별지|서식|제|호/g, "").replace(/[\s()[\]{}<>〈〉《》「」『』【】〔〕]/g, "");
}

function fieldLabelKey(value: string): string {
  return value.normalize("NFKC").toLowerCase().replace(/[\s\p{P}\p{S}]/gu, "");
}

function verifiedCommonForm(reading: DocumentReading, source: DocumentSource, url: string): boolean {
  const number = formNumberKey(reading.formNumber);
  const address = new URL(url);
  if (!number || number !== formNumberKey(source.matchedFormNumber || "") || address.protocol !== "https:" || !address.hostname.endsWith(".go.kr")) return false;
  const labels = new Set(reading.fields.map((field) => fieldLabelKey(field.label)).filter(Boolean));
  const matched = new Set((source.matchedFieldLabels || []).map(fieldLabelKey).filter((label) => label && labels.has(label)));
  return matched.size >= 2;
}

export function resolveSearch(reading: DocumentReading, report: SearchReport, retrievedUrls: string[], status: SearchResult["status"] = "completed"): SearchResult {
  if (status !== "completed") return { status: "unavailable", case: "photo_only", summary: "검색을 마치지 못했어요. 사진을 보고 안내해요.", sources: [] };
  const retrieved = new Set(retrievedUrls.map(canonicalUrl).filter((url): url is string => Boolean(url)));
  const fieldIds = new Set(reading.fields.map((field) => field.id));
  const sources = report.sources.filter((source) => {
    const url = canonicalUrl(source.url);
    return Boolean(reading.title.trim() && url && retrieved.has(url) &&
      source.official && source.sameForm && source.titleMatches &&
      (reading.institution.trim() ? source.institutionMatches : verifiedCommonForm(reading, source, url)) &&
      (!reading.revision.trim() || source.revisionMatches) && source.evidence.trim() && ["form", "guide"].includes(source.kind));
  }).map((source): DocumentSource => {
    const guidance = (source.guidance || []).filter((item) => fieldIds.has(item.fieldId) && source.fieldIds.includes(item.fieldId) && typeof item.text === "string" && item.text.trim() && item.text.length <= 500).map((item) => ({ ...item, text: item.text.trim() }));
    return {
      ...source,
      kind: source.kind === "guide" && guidance.length === 0 ? "form" : source.kind,
      fieldIds: source.kind === "guide" ? guidance.map((item) => item.fieldId) : source.fieldIds.filter((id) => fieldIds.has(id)),
      guidance,
    };
  });
  const hasGuide = sources.some((source) => source.kind === "guide" || source.guidance.length > 0);
  const searchCase = hasGuide ? "form_and_guide" : sources.some((source) => source.kind === "form") ? "form_only" : "photo_only";
  const summaries = {
    form_and_guide: "같은 서류와 작성 안내를 찾았어요.",
    form_only: "같은 서류는 찾았지만 작성 안내는 찾지 못했어요.",
    photo_only: "같은 서류를 확인하지 못해 사진을 보고 안내해요.",
  };
  return { status: "completed", case: searchCase, summary: summaries[searchCase], sources };
}

export function resolveProvenance(analysis: AnalysisResult, fieldId: string, requestedSourceIds: string[]): { provenance: Provenance; sourceIds: string[] } {
  if (analysis.search.status !== "completed" || !analysis.document.fields.some((field) => field.id === fieldId)) return { provenance: "photo_inference", sourceIds: [] };
  const requested = new Set(requestedSourceIds);
  const sources = analysis.search.sources.filter((source) => requested.has(source.id));
  const guides = sources.filter((source) => source.fieldIds.includes(fieldId) && source.guidance?.some((item) => item.fieldId === fieldId && typeof item.text === "string" && item.text.trim() && item.text.length <= 500));
  const forms = sources.filter((source) => source.kind === "form");
  if (guides.length) return { provenance: "official_guide", sourceIds: [...new Set([...guides, ...forms].map((source) => source.id))] };
  const contexts = sources.filter((source) => source.kind === "form" || source.kind === "guide");
  if (contexts.length) return { provenance: "form_context", sourceIds: contexts.map((source) => source.id) };
  return { provenance: "photo_inference", sourceIds: [] };
}

function metadataText(value: string, maxLength: number): string {
  return value
    .replace(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi, " ")
    .replace(/\b\d{6}[\s-]?[1-8]\d{6}\b/g, " ")
    .replace(/\b(?:\+82[\s-]?)?0?\d{1,3}[\s-]\d{3,4}[\s-]\d{4}\b/g, " ")
    .replace(/\b\d{9,}\b/g, " ")
    .replace(/(?<!\d)(?:\d[\s.-]?){9,}(?!\d)/g, " ")
    .replace(/[\u0000-\u001f\u007f]/g, " ").replace(/\s+/g, " ").trim().slice(0, maxLength);
}

export function sanitizeSearchMetadata(reading: DocumentReading): { title: string; institution: string; formNumber: string; revision: string; fieldLabels: string[] } {
  return {
    title: metadataText(reading.title, 160), institution: metadataText(reading.institution, 120),
    formNumber: metadataText(reading.formNumber, 80), revision: metadataText(reading.revision, 80),
    fieldLabels: [...new Set(reading.fields.map((field) => metadataText(field.label, 80)).filter(Boolean))].slice(0, 24),
  };
}
