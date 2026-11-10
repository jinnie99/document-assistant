import type { OfficialEvidence } from "./official-url.ts";
import type { LegalContext, ProcedureInfo } from "./types.ts";
import { generateGroundedLegalSummary } from "../documents/openai.ts";

export type GroundedLegalSummary = {
  overview: string;
  overviewSourceIds: string[];
  procedure: ProcedureInfo | null;
};

const TOP_KEYS = new Set(["overview", "overviewSourceIds", "procedure"]);
const PROCEDURE_KEYS = new Set(["reception", "submission", "requiredItems", "fee", "processingTime", "contact", "sourceIds"]);

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function invalid(): never { throw new Error("INVALID_LEGAL_SUMMARY"); }

function string(value: unknown, max: number): string {
  if (typeof value !== "string" || value.length > max || /[\u0000-\u001f\u007f]/.test(value)) invalid();
  return value.trim();
}

function ids(value: unknown, allowed: Set<string>): string[] {
  if (!Array.isArray(value) || value.length > 20 || value.some(item => typeof item !== "string" || !allowed.has(item)) || new Set(value).size !== value.length) invalid();
  return value as string[];
}

function tokens(value: string, pattern: RegExp): string[] {
  return [...value.matchAll(pattern)].map(match => match[0]);
}

function validateInvariants(context: LegalContext, evidence: OfficialEvidence[], text: string): void {
  const allowedArticles = new Set(context.provisions.map(item => item.article.replace(/\s/g, "")));
  const compact = (value: string) => value.replace(/\s/g, "");
  const groundText = compact([...context.provisions.map(item => item.text), ...evidence.map(item => item.text)].join(" "));
  const allowedDates = new Set(context.candidates.flatMap(item => [item.promulgationDate, item.effectiveDate]).filter(Boolean));
  const evidenceText = evidence.map(item => item.text).join(" ");
  const allowedUrls = new Set([...context.sources.map(item => item.url), ...evidence.map(item => item.url)]);
  for (const article of tokens(text, /제\s*\d+(?:의\d+)?\s*조/g).map(item => item.replace(/\s/g, ""))) if (!allowedArticles.has(article) && !groundText.includes(article)) invalid();
  for (const [raw, y, m, d] of text.matchAll(/(\d{4})\.\s*(\d{1,2})\.\s*(\d{1,2})\.?/g)) if (!allowedDates.has(`${y}-${m.padStart(2, "0")}-${d.padStart(2, "0")}`) && !groundText.includes(compact(raw).replace(/\.$/, ""))) invalid();
  for (const date of tokens(text, /\b\d{4}-\d{2}-\d{2}\b/g)) if (!allowedDates.has(date) && !evidenceText.includes(date)) invalid();
  for (const amount of tokens(text, /\b\d[\d,]*\s*원\b/g).map(item => item.replace(/\s/g, ""))) if (!evidenceText.replace(/\s/g, "").includes(amount)) invalid();
  for (const url of tokens(text, /https:\/\/[^\s)\]}>,]+/g)) if (!allowedUrls.has(url)) invalid();
}

export function validateLegalSummary(context: LegalContext, evidence: OfficialEvidence[], value: unknown): GroundedLegalSummary {
  if (!isRecord(value) || Object.keys(value).length !== TOP_KEYS.size || Object.keys(value).some(key => !TOP_KEYS.has(key))) invalid();
  const allowedIds = new Set([...context.sources.map(item => item.id), ...evidence.map(item => item.id)]);
  const overview = string(value.overview, 2000);
  const overviewSourceIds = ids(value.overviewSourceIds, allowedIds);
  if (overview && (!overviewSourceIds.length || !context.canonicalRule || !overview.includes(context.canonicalRule.name))) invalid();
  validateInvariants(context, evidence, overview);

  if (!isRecord(value.procedure) || Object.keys(value.procedure).length !== PROCEDURE_KEYS.size || Object.keys(value.procedure).some(key => !PROCEDURE_KEYS.has(key))) invalid();
  const procedure: ProcedureInfo = {
    reception: string(value.procedure.reception, 500), submission: string(value.procedure.submission, 500),
    requiredItems: Array.isArray(value.procedure.requiredItems) && value.procedure.requiredItems.length <= 30 ? value.procedure.requiredItems.map(item => string(item, 500)) : invalid(),
    fee: string(value.procedure.fee, 200), processingTime: string(value.procedure.processingTime, 200), contact: string(value.procedure.contact, 300),
    sourceIds: ids(value.procedure.sourceIds, allowedIds),
  };
  const procedureValues = [procedure.reception, procedure.submission, ...procedure.requiredItems, procedure.fee, procedure.processingTime, procedure.contact].filter(Boolean);
  if (procedureValues.length) {
    if (!procedure.sourceIds.length) invalid();
    const citedEvidence = evidence.filter(item => procedure.sourceIds.includes(item.id)).map(item => item.text.replace(/\s/g, "")).join(" ");
    if (!citedEvidence || procedureValues.some(item => !citedEvidence.includes(item.replace(/\s/g, "")))) invalid();
    for (const item of procedureValues) validateInvariants(context, evidence, item);
  }
  return { overview, overviewSourceIds, procedure: procedureValues.length ? procedure : null };
}

/** 근거 본문에 없는 절차 항목만 지우고, 출처는 문구가 실제로 있는 자료로 다시 계산한다. */
export function keepSupportedProcedure(value: unknown, evidence: OfficialEvidence[]): unknown {
  if (!isRecord(value) || !isRecord(value.procedure)) return value;
  const sources = evidence.map(item => ({ id: item.id, text: item.text.replace(/\s/g, "") }));
  const used = new Set<string>();
  const supported = (raw: unknown): boolean => {
    if (typeof raw !== "string" || !raw.trim()) return false;
    const needle = raw.replace(/\s/g, "");
    const found = sources.filter(item => item.text.includes(needle));
    for (const item of found.slice(0, 2)) used.add(item.id);
    return found.length > 0;
  };
  const single = (key: string) => supported(value.procedure && (value.procedure as Record<string, unknown>)[key]) ? (value.procedure as Record<string, unknown>)[key] : "";
  const procedure = {
    reception: single("reception"), submission: single("submission"), fee: single("fee"), processingTime: single("processingTime"), contact: single("contact"),
    requiredItems: Array.isArray(value.procedure.requiredItems) ? value.procedure.requiredItems.filter(supported) : [],
  };
  return { ...value, procedure: { ...procedure, sourceIds: [...used] } };
}

export async function summarizeLegalContext(context: LegalContext, evidence: OfficialEvidence[], signal?: AbortSignal): Promise<GroundedLegalSummary> {
  const pruned = keepSupportedProcedure(await generateGroundedLegalSummary(context, evidence, signal), evidence);
  try { return validateLegalSummary(context, evidence, pruned); }
  catch { return validateLegalSummary(context, evidence, { ...(pruned as Record<string, unknown>), overview: "", overviewSourceIds: [] }); }
}
