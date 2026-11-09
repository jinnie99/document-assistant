import { searchOfficialProcedureSources } from "../documents/openai.ts";
import { fetchOfficialEvidence, type OfficialEvidence } from "./official-url.ts";
import { summarizeLegalContext, type GroundedLegalSummary } from "./summary.ts";
import type { LegalContext } from "./types.ts";

export type ProcedureSearchQuery = {
  lawName: string;
  authority: string;
  formNumber: string;
};

export function discoverOfficialProcedureSources(query: ProcedureSearchQuery, signal?: AbortSignal, verifiedHosts: ReadonlySet<string> = new Set()): Promise<string[]> {
  return searchOfficialProcedureSources(query, signal, verifiedHosts);
}

type EnrichmentDependencies = {
  discover: (query: ProcedureSearchQuery, signal?: AbortSignal) => Promise<string[]>;
  fetchEvidence: (url: string, signal?: AbortSignal) => Promise<OfficialEvidence>;
  summarize: (context: LegalContext, evidence: OfficialEvidence[], signal?: AbortSignal) => Promise<GroundedLegalSummary>;
};

/* 법령 본문은 국가법령정보 API가 정본이다. 연혁·신구법 화면은 옛 시행일을 섞으므로 절차 근거로 쓰지 않는다. */
const LAW_HISTORY_PAGE = /법령\(연혁\)|신구법\s*비교/;

const defaults: EnrichmentDependencies = {
  discover: discoverOfficialProcedureSources,
  fetchEvidence: (url, signal) => fetchOfficialEvidence(url, {}, signal),
  summarize: summarizeLegalContext,
};

export async function enrichLegalContext(context: LegalContext, signal?: AbortSignal, overrides: Partial<EnrichmentDependencies> = {}): Promise<LegalContext> {
  if (context.status !== "completed" || !context.canonicalRule) return context;
  const dependencies = { ...defaults, ...overrides };
  const query = { lawName: context.canonicalRule.name, authority: context.authority || context.canonicalRule.authority, formNumber: context.detectedReferences.find(item => item.formNumber)?.formNumber ?? "" };
  let urls: string[];
  try { urls = await dependencies.discover(query, signal); }
  catch { return { ...context, warnings: [...new Set([...context.warnings, "공식 민원 절차 자료를 찾지 못했어요."])] }; }
  const fetched = await Promise.allSettled(urls.slice(0, 5).map(url => dependencies.fetchEvidence(url, signal)));
  const evidence = fetched.flatMap(item => item.status === "fulfilled" && !item.value.linkOnly && !LAW_HISTORY_PAGE.test(item.value.text) ? [item.value] : []);
  const sourcesFor = (ids: Set<string>) => evidence.filter(item => ids.has(item.id)).map(item => ({ id: item.id, title: item.title, url: item.url, kind: "procedure" as const, retrievedAt: item.retrievedAt }));
  try {
    const summary = await dependencies.summarize(context, evidence, signal);
    return { ...context, summary: summary.overview, summarySourceIds: summary.overviewSourceIds, procedure: summary.procedure, sources: [...context.sources, ...sourcesFor(new Set([...summary.overviewSourceIds, ...(summary.procedure?.sourceIds ?? [])]))] };
  } catch {
    return { ...context, warnings: [...new Set([...context.warnings, "법령·절차 요약을 확인하지 못했어요."])] };
  }
}
