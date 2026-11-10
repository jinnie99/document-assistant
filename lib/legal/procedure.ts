import { searchOfficialProcedureSources } from "../documents/openai.ts";
import type { LegalApiClient } from "./client.ts";
import { locateCurrentForm, type DocumentHint, type LocatedForm } from "./current-form.ts";
import { fetchOfficialEvidence, type OfficialEvidence } from "./official-url.ts";
import { resolveSelectedLegalContext } from "./resolver.ts";
import { summarizeLegalContext, type GroundedLegalSummary } from "./summary.ts";
import type { LegalCandidate, LegalContext, LegalReferenceHints, ProcedureInfo } from "./types.ts";

export type ProcedureSearchQuery = {
  lawName: string;
  authority: string;
  formNumber: string;
  documentTitle?: string;
  institution?: string;
};

export function discoverOfficialProcedureSources(query: ProcedureSearchQuery, signal?: AbortSignal, verifiedHosts: ReadonlySet<string> = new Set()): Promise<string[]> {
  return searchOfficialProcedureSources(query, signal, verifiedHosts);
}

type EnrichmentDependencies = {
  discover: (query: ProcedureSearchQuery, signal?: AbortSignal) => Promise<string[]>;
  fetchEvidence: (url: string, signal?: AbortSignal) => Promise<OfficialEvidence>;
  summarize: (context: LegalContext, evidence: OfficialEvidence[], signal?: AbortSignal) => Promise<GroundedLegalSummary>;
  locate: (document: DocumentHint, client: LegalApiClient, signal?: AbortSignal) => Promise<LocatedForm | null>;
  resolveSelected: (hints: LegalReferenceHints, candidate: LegalCandidate, client: LegalApiClient, signal?: AbortSignal) => Promise<LegalContext>;
};

export type EnrichmentOptions = Partial<EnrichmentDependencies> & {
  /** 사진에서 읽은 서류 제목과 칸 이름. 현행 서식을 찾는 데만 쓰고 외부 검색에는 제목만 보낸다. */
  document?: DocumentHint;
  client?: LegalApiClient;
  /** 사용자가 직접 고른 법령은 현행 서식을 찾아도 바꾸지 않는다. */
  keepCanonical?: boolean;
};

/* 법령 본문은 국가법령정보 API가 정본이다. 연혁·신구법 화면은 옛 시행일을 섞으므로 절차 근거로 쓰지 않는다. */
const LAW_HISTORY_PAGE = /법령\(연혁\)|신구법\s*비교/;
const FIELDS = ["reception", "submission", "requiredItems", "fee", "processingTime", "contact"] as const;
type Field = typeof FIELDS[number];

const defaults: EnrichmentDependencies = {
  discover: discoverOfficialProcedureSources,
  fetchEvidence: (url, signal) => fetchOfficialEvidence(url, { publicInstitutions: true }, signal),
  summarize: summarizeLegalContext,
  locate: locateCurrentForm,
  resolveSelected: resolveSelectedLegalContext,
};

function normalized(value: string): string {
  return value.normalize("NFKC").replace(/[\s·ㆍ.,()\[\]{}「」『』_-]/g, "").toLocaleLowerCase("ko-KR");
}

function articleBase(article: string): string {
  const match = /^제(\d+)조(의\d+)?/.exec(article.replace(/\s/g, ""));
  return match ? `제${match[1]}조${match[2] ?? ""}` : "";
}

/** 서류에 적힌 조문이 지금 법령에서 삭제됐는지 표시한다. 법령을 바꾸기 전에 확인해야 한다. */
function markRemovedArticles(context: LegalContext): LegalContext {
  const canonical = context.canonicalRule;
  if (!canonical || !context.printedArticles?.length) return context;
  return {
    ...context,
    printedArticles: context.printedArticles.map(item => {
      if (normalized(item.lawName) !== normalized(canonical.name)) return item;
      const provision = context.provisions.find(entry => entry.article === articleBase(item.article));
      return provision && /^제\d+조(의\d+)?\s*삭제/.test(provision.text) ? { ...item, removed: true } : item;
    }),
  };
}

function lawUrl(name: string): string {
  return `https://www.law.go.kr/법령/${encodeURIComponent(name)}`;
}

/** 법령 안의 근거: 현행 서식 본문과 그 서식을 인용한 조문 */
function lawEvidence(context: LegalContext, located: LocatedForm | null, now: string): OfficialEvidence[] {
  const evidence: OfficialEvidence[] = [];
  const canonical = context.canonicalRule;
  const label = located?.form.label ?? (() => {
    const printed = /\d+/.exec(context.detectedReferences.find(item => /\d/.test(item.formNumber ?? ""))?.formNumber ?? "")?.[0];
    return printed ? `별지 제${Number(printed)}호서식` : "";
  })();
  if (located) evidence.push({
    id: located.sourceId, title: `${located.form.lawName} ${located.form.label}`.slice(0, 300), url: located.form.pdfUrl || located.form.hwpUrl,
    text: located.bodyText, contentType: "text/plain", linkOnly: false, retrievedAt: now, kind: "form",
  });
  if (canonical && label && (!located || located.candidate.serialNumber === canonical.serialNumber)) {
    const citing = context.provisions.filter(item => item.text.includes(label));
    if (citing.length) evidence.push({
      id: `legal-article-${canonical.serialNumber}`.replace(/[^A-Za-z0-9_-]/g, "").slice(0, 64), title: `${canonical.name} ${citing.map(item => item.article).join(", ")}`.slice(0, 300),
      url: lawUrl(canonical.name), text: citing.map(item => item.text).join(" ").slice(0, 20_000), contentType: "text/plain", linkOnly: false, retrievedAt: now, kind: "law",
    });
  }
  return evidence;
}

function filled(procedure: ProcedureInfo | null, field: Field): boolean {
  const value = procedure?.[field];
  return Array.isArray(value) ? value.length > 0 : Boolean(value);
}

/** 법령에서 찾은 항목을 먼저 쓰고, 빈 항목만 웹 자료로 채운다. */
function mergeProcedure(law: ProcedureInfo | null, web: ProcedureInfo | null): ProcedureInfo | null {
  const merged: ProcedureInfo = { reception: "", submission: "", requiredItems: [], fee: "", processingTime: "", contact: "", sourceIds: [], fieldOrigins: {} };
  let usedLaw = false, usedWeb = false;
  for (const field of FIELDS) {
    const from = filled(law, field) ? law : filled(web, field) ? web : null;
    if (!from) continue;
    if (field === "requiredItems") merged.requiredItems = from.requiredItems; else merged[field] = from[field];
    merged.fieldOrigins![field] = from === law ? "law" : "web";
    if (from === law) usedLaw = true; else usedWeb = true;
  }
  if (!usedLaw && !usedWeb) return null;
  merged.sourceIds = [...new Set([...(usedLaw ? law!.sourceIds : []), ...(usedWeb ? web!.sourceIds : [])])].slice(0, 20);
  return merged;
}

function lawHost(url: string): boolean {
  try { const host = new URL(url).hostname; return host === "law.go.kr" || host.endsWith(".law.go.kr"); } catch { return false; }
}

export async function enrichLegalContext(context: LegalContext, signal?: AbortSignal, options: EnrichmentOptions = {}): Promise<LegalContext> {
  const { document, client, keepCanonical, ...overrides } = options;
  const dependencies = { ...defaults, ...overrides };
  let working = markRemovedArticles(context);

  /* 1. 제목과 칸 구성이 같은 현행 서식을 법령 전체에서 찾는다. */
  let located: LocatedForm | null = null;
  if (document && client) {
    try { located = await dependencies.locate(document, client, signal); }
    catch (error) { if (signal?.aborted) throw error; }
  }
  if (located) {
    if (!keepCanonical && working.canonicalRule?.serialNumber !== located.candidate.serialNumber) {
      try {
        const swapped = await dependencies.resolveSelected({ references: working.detectedReferences }, located.candidate, client!, signal);
        const candidates = [located.candidate, ...working.candidates.filter(item => item.id !== located!.candidate.id)].slice(0, 20);
        working = { ...swapped, detectedReferences: working.detectedReferences, candidates, printedReceivingOffice: working.printedReceivingOffice, printedArticles: working.printedArticles };
      } catch (error) { if (signal?.aborted) throw error; }
    }
    working = { ...working, currentForm: located.form };
  }
  if (working.status !== "completed" || !working.canonicalRule) return working;

  /* 2. 절차는 법령(서식 본문·조문)에서 먼저 찾는다. */
  const now = new Date().toISOString();
  const fromLaw = lawEvidence(working, located, now);
  let overview = "", overviewSourceIds: string[] = [], law: ProcedureInfo | null = null;
  if (fromLaw.length) {
    try { const summary = await dependencies.summarize(working, fromLaw, signal); overview = summary.overview; overviewSourceIds = summary.overviewSourceIds; law = summary.procedure; }
    catch (error) { if (signal?.aborted) throw error; }
  }

  /* 3. 법령에 없는 항목만 기관 웹 자료로 채운다. */
  const warnings = [...working.warnings];
  let web: ProcedureInfo | null = null, fromWeb: OfficialEvidence[] = [];
  if (FIELDS.some(field => !filled(law, field))) {
    const reference = working.detectedReferences.find(item => item.formNumber);
    const query: ProcedureSearchQuery = {
      lawName: working.canonicalRule.name, authority: working.authority || working.canonicalRule.authority, formNumber: located?.form.label ?? reference?.formNumber ?? "",
      ...(document?.title ? { documentTitle: document.title.slice(0, 120) } : {}),
      ...(working.printedReceivingOffice ? { institution: working.printedReceivingOffice.replace(/\s*귀하\s*$/, "").slice(0, 100) } : {}),
    };
    let urls: string[] | null = null;
    try { urls = await dependencies.discover(query, signal); }
    catch (error) { if (signal?.aborted) throw error; if (!law) warnings.push("공식 민원 절차 자료를 찾지 못했어요."); }
    if (urls) {
      const fetched = await Promise.allSettled(urls.slice(0, 5).map(url => dependencies.fetchEvidence(url, signal)));
      fromWeb = fetched.flatMap(item => item.status === "fulfilled" && !item.value.linkOnly && !LAW_HISTORY_PAGE.test(item.value.text) && !lawHost(item.value.url) ? [item.value] : []);
      if (fromWeb.length || !fromLaw.length) {
        try {
          const summary = await dependencies.summarize(working, fromWeb, signal);
          if (!overview) { overview = summary.overview; overviewSourceIds = summary.overviewSourceIds; }
          web = summary.procedure;
        } catch (error) { if (signal?.aborted) throw error; if (!law && !overview) warnings.push("법령·절차 요약을 확인하지 못했어요."); }
      }
    }
  }

  const procedure = mergeProcedure(law, web);
  const cited = new Set([...overviewSourceIds, ...(procedure?.sourceIds ?? [])]);
  const known = new Set(working.sources.map(item => item.id));
  const sources = [...fromLaw, ...fromWeb].filter(item => cited.has(item.id) && !known.has(item.id) && item.url)
    .map(item => ({ id: item.id, title: item.title, url: item.url, kind: item.kind ?? "procedure" as const, retrievedAt: item.retrievedAt }));
  return { ...working, summary: overview, summarySourceIds: overviewSourceIds, procedure, sources: [...working.sources, ...sources].slice(0, 40), warnings: [...new Set(warnings)].slice(0, 12) };
}
