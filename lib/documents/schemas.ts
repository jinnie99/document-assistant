import { MAX_DOCUMENT_FIELDS } from "./limits.ts";

type Schema = Record<string, unknown>;
const string = (maxLength: number, minLength = 0): Schema => ({ type: "string", minLength, maxLength });
const number: Schema = { type: "number", minimum: 0, maximum: 1 };
const boolean: Schema = { type: "boolean" };
const object = (properties: Record<string, Schema>): Schema => ({ type: "object", properties, required: Object.keys(properties), additionalProperties: false });
const array = (items: Schema, maxItems: number, minItems = 0): Schema => ({ type: "array", items, minItems, maxItems });
const id = string(64, 1);

export const IDENTITY_SCHEMA = object({
  title: string(200), institution: string(200), formNumber: string(100), revision: string(100),
  description: string(200), readable: boolean,
});

export const VISION_SCHEMA = object({
  title: string(200), institution: string(200), formNumber: string(100), revision: string(100),
  readable: boolean, warnings: array(string(300, 1), 8),
  fields: array(object({ id, label: string(80, 1), box: object({ x: number, y: number, width: number, height: number }), confidence: number, printedHint: string(600) }), MAX_DOCUMENT_FIELDS),
});

// Internal provider format: cell references are resolved to boxes before publication.
export const TABLE_VISION_SCHEMA = object({
  title: string(200), institution: string(200), formNumber: string(100), revision: string(100),
  readable: boolean, warnings: array(string(300, 1), 8),
  fields: array(object({ id, label: string(80, 1), cellId: string(64), box: object({ x: number, y: number, width: number, height: number }), confidence: number, printedHint: string(600) }), MAX_DOCUMENT_FIELDS),
});

export const REGION_SCHEMA = object({ writable: boolean, label: string(80), printedHint: string(600), confidence: number });

export const LEGAL_REFERENCE_SCHEMA = object({
  references: array(object({
    name: string(200, 1),
    kind: { type: "string", enum: ["law", "administrative_rule"] },
    authority: string(100),
    number: string(100),
    date: string(30),
    formNumber: string(100),
  }), 8),
  receivingOffice: string(100),
  citedArticles: array(object({ lawName: string(200), article: string(40) }), 8),
});

export const SEARCH_SCHEMA = object({
  summary: string(500),
  sources: array(object({
    id, title: string(300, 1), url: string(2048, 1), kind: { type: "string", enum: ["form", "guide", "other"] },
    official: boolean, sameForm: boolean, titleMatches: boolean, institutionMatches: boolean, revisionMatches: boolean,
    fieldIds: array(id, MAX_DOCUMENT_FIELDS), evidence: string(1800),
    matchedFormNumber: string(100), matchedFieldLabels: array(string(80, 1), MAX_DOCUMENT_FIELDS),
    guidance: array(object({ fieldId: id, text: string(500, 1) }), MAX_DOCUMENT_FIELDS),
  }), 12),
});

export const GUIDE_SCHEMA = object({
  fieldId: id, explanation: string(80), example: string(80), check: string(80),
  provenance: { type: "string", enum: ["official_guide", "form_context", "photo_inference"] },
  sourceIds: array(id, 12),
  question: { anyOf: [object({ id, text: string(50, 1), choices: array(object({ id, label: string(20, 1) }), 3, 3) }), { type: "null" }] },
});

export const LEGAL_SUMMARY_SCHEMA = object({
  overview: string(2000),
  overviewSourceIds: array(id, 20),
  procedure: object({
    reception: string(500), submission: string(500), requiredItems: array(string(500, 1), 30),
    fee: string(200), processingTime: string(200), contact: string(300), sourceIds: array(id, 20),
  }),
});
