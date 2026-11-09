import type { LegalContext, LegalSearchReference } from "../legal/types.ts";

export type Box = { x: number; y: number; width: number; height: number };
export type DocumentField = { id: string; label: string; box: Box; confidence: number; printedHint: string };
export type DocumentIdentity = {
  title: string; institution: string; formNumber: string; revision: string;
  description: string; readable: boolean;
};
export type DocumentReading = {
  title: string; institution: string; formNumber: string; revision: string;
  readable: boolean; warnings: string[]; fields: DocumentField[];
};
export type SourceKind = "form" | "guide" | "other";
export type DocumentSource = {
  id: string; title: string; url: string; kind: SourceKind;
  official: boolean; sameForm: boolean; titleMatches: boolean; institutionMatches: boolean;
  revisionMatches: boolean; fieldIds: string[]; evidence: string;
  guidance: { fieldId: string; text: string }[];
  matchedFormNumber?: string;
  matchedFieldLabels?: string[];
};
export type SearchCase = "form_and_guide" | "form_only" | "photo_only";
export type SearchResult = {
  status: "pending" | "completed" | "unavailable"; case: SearchCase;
  summary: string; sources: DocumentSource[];
};
export type AnalysisResult = {
  id: string; document: DocumentReading; search: SearchResult; expiresAt: string;
  mappingStatus?: "in_progress" | "completed" | "partial";
  legal?: LegalContext;
};
export type AnalysisEvent =
  | { type: "stage"; stage: "identifying" | "mapping" | "searching" }
  | { type: "identity"; identity: DocumentIdentity }
  | { type: "mapped"; analysis: AnalysisResult }
  | { type: "fields"; analysis: AnalysisResult }
  | { type: "legal_started"; analysisId: string }
  | { type: "legal_reference"; analysisId: string; references: LegalSearchReference[] }
  | { type: "legal_complete"; analysis: AnalysisResult }
  | { type: "legal_unavailable"; analysis: AnalysisResult }
  | { type: "complete"; analysis: AnalysisResult }
  | { type: "error"; code: string; error: string };
export type Provenance = "official_guide" | "form_context" | "photo_inference";
export type SituationQuestion = { id: string; text: string; choices: { id: string; label: string }[] };
export type FieldGuidance = {
  fieldId: string; explanation: string; example: string; check: string;
  provenance: Provenance; sourceIds: string[]; question: SituationQuestion | null;
};
export type GuideAnswers = Record<string, string>;
export type ApiError = { error: string; code: string };
