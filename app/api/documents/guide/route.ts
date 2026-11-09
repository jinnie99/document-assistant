import { generateGuidance } from "@/lib/documents/openai";
import { analysisStore, guideCacheKey } from "@/lib/documents/store";
import { errorResponse, InputError, json, requestJson, withBudget } from "@/lib/documents/http";
import type { GuideAnswers } from "@/lib/documents/types";

export const maxDuration = 90;

export async function POST(request: Request) {
  try {
    const { analysisId, fieldId, answers = {} } = await requestJson(request);
    if (typeof analysisId !== "string" || analysisId.length > 80 || typeof fieldId !== "string") throw new InputError("INVALID_JSON");
    const record = analysisStore.get(analysisId);
    if (!record) throw new InputError("SESSION_EXPIRED", 410);
    if (!record.analysis.document.fields.some((field) => field.id === fieldId)) throw new InputError("UNKNOWN_FIELD");
    if (!answers || typeof answers !== "object" || Array.isArray(answers) || Object.keys(answers).length > 2) throw new InputError("INVALID_ANSWER");
    const entries = Object.entries(answers);
    for (const [id, value] of entries) {
      const question = record.questions.get(fieldId)?.get(id);
      if (!question || typeof value !== "string" || !question.choices.some((choice) => choice.id === value)) throw new InputError("INVALID_ANSWER");
    }
    const safeAnswers: GuideAnswers = Object.fromEntries(entries);
    const answerContext = entries.map(([id, value]) => {
      const question = record.questions.get(fieldId)!.get(id)!;
      return { question: question.text, answer: question.choices.find((choice) => choice.id === value)!.label };
    });
    const cacheKey = guideCacheKey(record.analysis.search.status, fieldId, entries as [string, string][]);
    const cached = record.guides.get(cacheKey);
    if (cached) return json(cached);
    const version = record.version;
    return await withBudget(request, async () => {
      const guide = await generateGuidance(record.analysis, fieldId, safeAnswers, request.signal, answerContext);
      if (request.signal.aborted) throw new InputError("CANCELLED", 499);
      return json(analysisStore.saveGuide(analysisId, version, cacheKey, guide));
    });
  } catch (error) { return errorResponse(error); }
}
