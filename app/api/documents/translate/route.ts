import { translateLabels } from "@/lib/documents/openai";
import { analysisStore } from "@/lib/documents/store";
import { errorResponse, InputError, json, requestJson } from "@/lib/documents/http";
import { isLocale, type Locale } from "@/lib/i18n/locales";

export const maxDuration = 60;

/**
 * 사진에서 읽은 한국어 항목명을 고른 언어로 옮겨 준다.
 * 분석 중에도 불러야 해서 동시 요청 한도(withBudget)는 쓰지 않는다. 대신 살아 있는 분석의 항목명만 옮기고
 * 한 번 옮긴 항목명은 다시 묻지 않아, 분석 한 건당 호출량이 칸 수로 묶인다.
 */
const processCache = globalThis as typeof globalThis & { documentLabelTranslations?: Map<string, Map<string, string>> };
const cache = processCache.documentLabelTranslations ??= new Map<string, Map<string, string>>();
const MAX_CACHED_ANALYSES = 80;

function translationsFor(analysisId: string, locale: Locale): Map<string, string> {
  const key = `${analysisId}:${locale}`;
  let known = cache.get(key);
  if (!known) {
    for (const stale of cache.keys()) if (!analysisStore.get(stale.slice(0, stale.lastIndexOf(":")))) cache.delete(stale);
    while (cache.size >= MAX_CACHED_ANALYSES) cache.delete(cache.keys().next().value!);
    known = new Map();
    cache.set(key, known);
  }
  return known;
}

export async function POST(request: Request) {
  try {
    const { analysisId, locale } = await requestJson(request);
    if (typeof analysisId !== "string" || analysisId.length > 80 || !isLocale(locale)) throw new InputError("INVALID_JSON");
    const record = analysisStore.get(analysisId);
    if (!record) throw new InputError("SESSION_EXPIRED", 410);
    const fields = record.analysis.document.fields;
    if (locale === "ko") return json({ labels: {} });
    const known = translationsFor(analysisId, locale);
    const missing = [...new Set(fields.map(field => field.label).filter(label => !known.has(label)))];
    if (missing.length) {
      const translated = await translateLabels(missing, record.analysis.document.title, locale, request.signal);
      if (request.signal.aborted) throw new InputError("CANCELLED", 499);
      missing.forEach((label, index) => { if (translated[index]) known.set(label, translated[index]); });
    }
    return json({ labels: Object.fromEntries(fields.flatMap(field => known.has(field.label) ? [[field.id, known.get(field.label)!]] : [])) });
  } catch (error) { return errorResponse(error); }
}
