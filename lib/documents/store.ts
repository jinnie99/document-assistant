import { randomUUID } from "node:crypto";
import { InputError } from "./http.ts";
import { MAX_DOCUMENT_FIELDS } from "./limits.ts";
import { validateRegionBox } from "./region-validation.ts";
import type { AnalysisResult, Box, DocumentField, DocumentReading, FieldGuidance, SearchResult, SituationQuestion } from "./types.ts";
import type { LegalCandidate, LegalContext } from "../legal/types.ts";

export type StoredAnalysis = {
  analysis: AnalysisResult;
  guides: Map<string, FieldGuidance>;
  questions: Map<string, Map<string, SituationQuestion>>;
  version: number;
  legalVersion: number;
};

export type RecognizedField = Pick<DocumentField, "label" | "printedHint" | "confidence">;
export type FieldChange = { analysis: AnalysisResult; field: DocumentField };

export function guideCacheKey(status: SearchResult["status"], fieldId: string, answers: [string, string][]): string {
  return `${status}:${JSON.stringify([fieldId, [...answers].sort(([a], [b]) => a.localeCompare(b))])}`;
}

export class AnalysisStore {
  private records = new Map<string, StoredAnalysis>();
  private expiryTimers = new Map<string, ReturnType<typeof setTimeout>>();
  private ttl: number;
  private capacity: number;
  private now: () => number;
  constructor(ttl = 30 * 60_000, capacity = 40, now: () => number = Date.now) {
    this.ttl = ttl; this.capacity = capacity; this.now = now;
  }
  put(document: DocumentReading, search: SearchResult, mappingStatus?: AnalysisResult["mappingStatus"]): AnalysisResult {
    this.prune();
    while (this.records.size >= this.capacity) this.delete(this.records.keys().next().value!);
    const analysis: AnalysisResult = { id: randomUUID(), document, search, expiresAt: new Date(this.now() + this.ttl).toISOString(), ...(mappingStatus ? { mappingStatus } : {}) };
    this.records.set(analysis.id, { analysis, guides: new Map(), questions: new Map(), version: 0, legalVersion: 0 });
    const expiry = setTimeout(() => this.delete(analysis.id), this.ttl);
    expiry.unref();
    this.expiryTimers.set(analysis.id, expiry);
    return analysis;
  }
  get(id: string): StoredAnalysis | undefined {
    this.prune();
    return this.records.get(id);
  }
  updateSearch(id: string, search: SearchResult): AnalysisResult {
    const record = this.requireCurrent(id);
    record.analysis = { ...record.analysis, search };
    return record.analysis;
  }
  updateLegal(id: string, legal: LegalContext, expectedLegalVersion?: number): AnalysisResult {
    const record = this.requireCurrent(id);
    if (expectedLegalVersion !== undefined && record.legalVersion !== expectedLegalVersion) throw new InputError("LEGAL_CONTEXT_CONFLICT", 409);
    record.analysis = { ...record.analysis, legal };
    return record.analysis;
  }
  selectLegalCandidate(id: string, candidateId: string): { analysis: AnalysisResult; candidate: LegalCandidate; legalVersion: number } {
    const record = this.requireCurrent(id);
    const legal = record.analysis.legal;
    const candidate = legal?.candidates.find(item => item.id === candidateId);
    if (!legal || !candidate) throw new InputError("UNKNOWN_LEGAL_CANDIDATE", 404);
    record.legalVersion++;
    record.version++;
    record.guides.clear();
    record.questions.clear();
    record.analysis = {
      ...record.analysis,
      legal: {
        ...legal,
        status: "pending",
        canonicalRule: candidate,
        hierarchy: { act: null, decree: null, rule: null, administrativeRules: [] },
        provisions: [], forms: [], authority: candidate.authority, procedure: null, summary: "", sources: [], warnings: [], stale: false,
      },
    };
    return { analysis: record.analysis, candidate, legalVersion: record.legalVersion };
  }
  appendReading(id: string, document: DocumentReading, mappingStatus: NonNullable<AnalysisResult["mappingStatus"]>): AnalysisResult {
    const record = this.requireCurrent(id);
    const fields = [...record.analysis.document.fields];
    const known = new Set(fields.map(field => field.id));
    for (const field of document.fields) {
      if (known.has(field.id) || fields.length >= MAX_DOCUMENT_FIELDS) continue;
      known.add(field.id);
      fields.push(field);
    }
    record.analysis = { ...record.analysis, document: { ...document, fields, readable: document.readable || fields.length > 0 }, mappingStatus };
    return record.analysis;
  }
  updateField(id: string, fieldId: string, nextBox: Box): FieldChange {
    const record = this.requireCurrent(id);
    const previous = record.analysis.document.fields.find((field) => field.id === fieldId);
    if (!previous) throw new InputError("UNKNOWN_FIELD");
    const field = { ...previous, box: validateRegionBox(nextBox) };
    return this.replaceFields(record, record.analysis.document.fields.map((item) => item.id === fieldId ? field : item), field);
  }
  addField(id: string, recognized: RecognizedField, nextBox: Box, expectedVersion: number): FieldChange {
    const record = this.requireCurrent(id, expectedVersion);
    if (record.analysis.document.fields.length >= MAX_DOCUMENT_FIELDS) throw new InputError("FIELD_LIMIT", 409);
    if (typeof recognized.label !== "string" || !recognized.label.trim() || recognized.label.length > 80 || typeof recognized.printedHint !== "string" || recognized.printedHint.length > 600 || !Number.isFinite(recognized.confidence) || recognized.confidence < 0 || recognized.confidence > 1) throw new InputError("REGION_NOT_READABLE", 422);
    const field: DocumentField = { id: `manual_${randomUUID()}`, label: recognized.label.trim(), printedHint: recognized.printedHint.trim(), confidence: recognized.confidence, box: validateRegionBox(nextBox) };
    return this.replaceFields(record, [...record.analysis.document.fields, field], field);
  }
  saveGuide(id: string, expectedVersion: number, key: string, guide: FieldGuidance): FieldGuidance {
    const record = this.requireCurrent(id, expectedVersion);
    if (!record.analysis.document.fields.some((field) => field.id === guide.fieldId)) throw new InputError("UNKNOWN_FIELD");
    if (guide.question) {
      const questions = record.questions.get(guide.fieldId) || new Map();
      questions.set(guide.question.id, guide.question);
      record.questions.set(guide.fieldId, questions);
    }
    record.guides.set(key, guide);
    return guide;
  }
  delete(id: string) {
    clearTimeout(this.expiryTimers.get(id));
    this.expiryTimers.delete(id);
    this.records.delete(id);
  }
  private prune() {
    const now = this.now();
    for (const [id, record] of this.records) if (Date.parse(record.analysis.expiresAt) <= now) this.delete(id);
  }
  private requireCurrent(id: string, expectedVersion?: number): StoredAnalysis {
    const record = this.get(id);
    if (!record) throw new InputError("SESSION_EXPIRED", 410);
    if (expectedVersion !== undefined && record.version !== expectedVersion) throw new InputError("REGION_CONFLICT", 409);
    return record;
  }
  private replaceFields(record: StoredAnalysis, fields: DocumentField[], field: DocumentField): FieldChange {
    record.analysis = { ...record.analysis, document: { ...record.analysis.document, fields, readable: true } };
    record.version++;
    record.guides.clear();
    record.questions.clear();
    return { analysis: record.analysis, field };
  }
}

const processStore = globalThis as typeof globalThis & { documentAnalysisStore?: AnalysisStore };
export const analysisStore = processStore.documentAnalysisStore?.selectLegalCandidate ? processStore.documentAnalysisStore : (processStore.documentAnalysisStore = new AnalysisStore());
