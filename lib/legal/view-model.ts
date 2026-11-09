import type { LegalCandidate, LegalContact, LegalContext, LegalSearchReference, LegalSource } from "./types.ts";

export type LegalViewState = "hidden" | "pending" | "ambiguous" | "not_found" | "unavailable" | "completed";

export type LegalViewRow = { label: string; value: string };

export type LegalFormGuide = {
  formLabel: string;
  printedRevision: string;
  currentRevision: string;
  currentTitle: string;
  download: { label: string; url: string } | null;
  revisionMismatch: boolean;
  articles: { heading: string; url: string; note: string }[];
  lawUrl: string;
  differentForm: boolean;
  documentTitle: string;
};

export type LegalViewCandidate = {
  id: string;
  name: string;
  detail: string;
  selectable: boolean;
};

export type LegalViewOfficeRow = { label: string; value: string };

export type LegalViewProvision = { id: string; heading: string; text: string; sourceIds: string[] };

export type LegalViewSource = { id: string; title: string; url: string; label: string };

export type LegalViewModel = {
  state: LegalViewState;
  headline: string;
  canonicalName: string;
  candidates: LegalViewCandidate[];
  hierarchy: LegalViewRow[];
  administrativeRules: LegalViewRow[];
  moreAdministrativeRules: number;
  provisions: LegalViewProvision[];
  procedure: LegalViewRow[] | null;
  procedureMissing: boolean;
  office: LegalViewOfficeRow[];
  formGuide: LegalFormGuide | null;
  contacts: LegalContact[];
  noThreeTier: boolean;
  oldFormMismatch: boolean;
  summary: string;
  summarySourceIds: string[];
  sources: LegalViewSource[];
  notices: string[];
  queryTime: string;
  disclaimer: string;
};

export const LEGAL_DISCLAIMER = "법령과 절차 안내는 참고용이에요. 서류 작성을 대신하지 않으며, 최종 내용은 소관 기관에 확인해 주세요.";

const SOURCE_LABELS: Record<LegalSource["kind"], string> = {
  law: "법령 정본",
  administrative_rule: "행정규칙",
  procedure: "공식 안내",
  form: "서식",
};

const PROCEDURE_LABELS: [keyof NonNullable<LegalContext["procedure"]>, string][] = [
  ["reception", "접수처"],
  ["submission", "제출 방법"],
  ["requiredItems", "준비물"],
  ["fee", "수수료"],
  ["processingTime", "처리기간"],
  ["contact", "문의처"],
];

const KIND_LABELS: Record<LegalCandidate["kind"], string> = { law: "법령", administrative_rule: "행정규칙" };

function normalized(value: string): string {
  return value.normalize("NFKC").replace(/[\s·ㆍ.,()\[\]{}「」『』제호_-]/g, "").toLocaleLowerCase("ko-KR");
}

function effectiveText(candidate: LegalCandidate): string {
  return candidate.effectiveDate ? ` · 시행 ${candidate.effectiveDate}` : "";
}

function queryTimeText(iso: string): string {
  const time = Date.parse(iso);
  if (Number.isNaN(time)) return "";
  const kst = new Date(time + 9 * 60 * 60_000);
  const pad = (value: number) => String(value).padStart(2, "0");
  return `${kst.getUTCFullYear()}.${pad(kst.getUTCMonth() + 1)}.${pad(kst.getUTCDate())} ${pad(kst.getUTCHours())}:${pad(kst.getUTCMinutes())} 기준`;
}

/** 서식에 인쇄된 번호·날짜가 현행 정본과 하나도 맞지 않으면 예전 서식일 수 있다. */
function oldFormMismatch(context: LegalContext): boolean {
  const canonical = context.canonicalRule;
  if (!canonical) return false;
  return context.detectedReferences.some((reference: LegalSearchReference) => {
    const checks: boolean[] = [];
    if (reference.number) checks.push(normalized(reference.number) === normalized(canonical.promulgationNumber));
    if (reference.date) checks.push(reference.date === canonical.promulgationDate || reference.date === canonical.effectiveDate);
    return checks.length > 0 && !checks.some(Boolean);
  });
}

function isoFromPrinted(value: string): string {
  const match = /(\d{4})\D{0,3}(\d{1,2})\D{0,3}(\d{1,2})/.exec(value);
  if (!match) return "";
  return `${match[1]}-${match[2].padStart(2, "0")}-${match[3].padStart(2, "0")}`;
}

function currentRevisionIso(value: string): string {
  return isoFromPrinted(value);
}

function articleNumber(article: string): string {
  const match = /^제?\s*(\d+(?:의\d+)?)\s*조?$/.exec(article.trim());
  return match ? match[1] : "";
}

/** 사진 머리글의 "[별지 제N호서식] <개정 …>"에서 서식 안내를 만든다. */
function sameTitle(a: string, b: string): boolean {
  const x = normalized(a), y = normalized(b);
  return Boolean(x && y && (x.includes(y) || y.includes(x)));
}

function articleBase(article: string): string {
  const match = /^제(\d+)조(의\d+)?/.exec(article.replace(/\s/g, ""));
  return match ? `제${match[1]}조${match[2] ?? ""}` : "";
}

function articleUrl(lawName: string, base: string): string {
  return `https://www.law.go.kr/법령/${encodeURIComponent(lawName)}/${encodeURIComponent(base)}`;
}

/** 서류에 인쇄된 조문 중 국가법령정보에서 확인된 법령의 것만 링크로 만든다. */
function printedArticleLinks(context: LegalContext): LegalFormGuide["articles"] {
  const related = [context.canonicalRule, ...context.candidates, context.hierarchy.act, context.hierarchy.decree, context.hierarchy.rule];
  const known = new Map(related.flatMap(item => item ? [[normalized(item.name), item.name] as const] : []));
  return (context.printedArticles ?? []).flatMap(item => {
    const lawName = known.get(normalized(item.lawName)), base = articleBase(item.article);
    if (!lawName || !base) return [];
    const provision = lawName === context.canonicalRule?.name ? context.provisions.find(entry => entry.article === base) : undefined;
    const removed = provision ? /^제\d+조(의\d+)?\s*삭제/.test(provision.text) : false;
    return [{ heading: `${lawName} ${item.article}`, url: articleUrl(lawName, base), note: removed ? "현행 법령에서 삭제된 조문이에요" : "서류에 적힌 조문이에요" }];
  });
}

function formGuideFor(context: LegalContext, documentTitle: string): LegalFormGuide | null {
  const reference = context.detectedReferences.find(item => /\d/.test(item.formNumber ?? ""));
  const number = reference ? (/\d+/.exec(reference.formNumber ?? "")?.[0] ?? "") : "";
  if (!number) return null;
  const formLabel = `별지 제${Number(number)}호서식`;
  const current = context.forms.find(item => item.label === formLabel);
  const differentForm = Boolean(documentTitle && current && !sameTitle(documentTitle, current.title));
  const sameNameForm = documentTitle && (!current || differentForm) ? context.forms.find(item => sameTitle(documentTitle, item.title)) : undefined;
  const target = documentTitle ? (differentForm || !current ? sameNameForm : current) : current;
  const shown = target ?? current;
  const printedRevision = isoFromPrinted(reference?.date ?? "");
  const currentRevision = shown?.revision ?? "";
  const currentIso = currentRevisionIso(currentRevision);
  const legalName = context.canonicalRule?.name ?? "";
  const citing = differentForm ? [] : context.provisions
    .filter(item => item.text.includes(formLabel) || item.text.includes(`제${Number(number)}호서식`))
    .flatMap(item => {
      const digits = articleNumber(item.article);
      if (!digits || !legalName) return [];
      return [{ heading: `${item.lawName || legalName} 제${digits}조${item.title ? ` (${item.title})` : ""}`, url: articleUrl(legalName, `제${digits}조`), note: "" }];
    });
  const seen = new Set<string>();
  const articles = [...printedArticleLinks(context), ...citing].filter(item => !seen.has(item.url) && Boolean(seen.add(item.url))).slice(0, 5);
  return {
    formLabel,
    printedRevision,
    currentRevision,
    currentTitle: shown?.title ?? "",
    download: target ? { label: `현행 ${target.label ?? formLabel} 내려받기`, url: target.url } : null,
    revisionMismatch: Boolean(target && printedRevision && currentIso && printedRevision !== currentIso),
    differentForm,
    documentTitle,
    articles,
    lawUrl: legalName ? `https://www.law.go.kr/법령/${encodeURIComponent(legalName)}` : "",
  };
}

function headlineFor(state: LegalViewState): string {
  switch (state) {
    case "pending": return "관련 법령과 절차를 찾고 있어요.";
    case "ambiguous": return "비슷한 법령이 여러 개예요. 서류와 맞는 것을 골라 주세요.";
    case "not_found": return "이 서류와 맞는 법령을 찾지 못했어요.";
    case "unavailable": return "지금은 법령 정보를 확인하지 못했어요.";
    case "completed": return "이 서류의 관련 법령과 절차예요.";
    default: return "";
  }
}

function sourceLabel(source: LegalSource): string {
  return SOURCE_LABELS[source.kind] ?? "참고 자료";
}

function emptyModel(state: LegalViewState): LegalViewModel {
  return {
    state, headline: headlineFor(state), canonicalName: "", candidates: [], hierarchy: [], administrativeRules: [], moreAdministrativeRules: 0, provisions: [],
    procedure: null, procedureMissing: false, office: [], formGuide: null, contacts: [], noThreeTier: false, oldFormMismatch: false, summary: "", summarySourceIds: [],
    sources: [], notices: [], queryTime: "", disclaimer: LEGAL_DISCLAIMER,
  };
}

export function pendingLegalContext(references: LegalSearchReference[] = []): LegalContext {
  return {
    status: "pending", detectedReferences: references, candidates: [], canonicalRule: null,
    hierarchy: { act: null, decree: null, rule: null, administrativeRules: [] }, provisions: [], forms: [], authority: "",
    procedure: null, summary: "", sources: [], warnings: [], retrievedAt: "", stale: false,
  };
}

export function buildLegalViewModel(context: LegalContext | undefined, options: { documentTitle?: string } = {}): LegalViewModel {
  if (!context) return emptyModel("hidden");
  const state: LegalViewState = context.status;
  const model = emptyModel(state);
  const notices = [...context.warnings];
  const printedOffice: LegalViewOfficeRow[] = context.printedReceivingOffice ? [{ label: "서류에 적힌 수신처", value: context.printedReceivingOffice }] : [];

  if (state === "ambiguous" || (state === "completed" && context.candidates.length > 1)) {
    model.candidates = context.candidates.map(candidate => ({
      id: candidate.id,
      name: candidate.name,
      detail: `${KIND_LABELS[candidate.kind]} · ${candidate.authority || "소관 미상"}${candidate.promulgationNumber ? ` · ${candidate.promulgationNumber}` : ""}${effectiveText(candidate)}${candidate.status === "repealed" ? " · 폐지됨" : ""}`,
      selectable: true,
    }));
  }

  if (state !== "completed" || !context.canonicalRule) {
    model.office = printedOffice;
    model.notices = notices;
    model.queryTime = queryTimeText(context.retrievedAt);
    return model;
  }

  const canonical = context.canonicalRule;
  model.canonicalName = canonical.name;
  const { act, decree, rule } = context.hierarchy;
  const tiers: [string, LegalCandidate | null][] = [["법률", act], ["시행령", decree], ["시행규칙", rule]];
  model.hierarchy = tiers.flatMap(([label, candidate]) => candidate ? [{ label, value: `${candidate.name}${effectiveText(candidate)}` }] : []);
  model.noThreeTier = !act && !decree && !rule;
  model.moreAdministrativeRules = Math.max(0, context.hierarchy.administrativeRules.length - 3);
  model.administrativeRules = context.hierarchy.administrativeRules.slice(0, 3).map(candidate => ({ label: "행정규칙", value: `${candidate.name}${effectiveText(candidate)}` }));
  const printedHere = new Set((context.printedArticles ?? []).filter(item => normalized(item.lawName) === normalized(canonical.name)).map(item => articleBase(item.article)));
  model.provisions = context.provisions.filter(item => printedHere.has(item.article)).slice(0, 8).map(item => ({ id: item.id, heading: `${item.lawName} ${item.article}${item.title ? ` (${item.title})` : ""}`, text: item.text, sourceIds: item.sourceIds }));

  const procedure = context.procedure;
  const rows = procedure ? PROCEDURE_LABELS.flatMap(([key, label]) => {
    const raw = procedure[key];
    const value = Array.isArray(raw) ? raw.join(", ") : raw;
    return value ? [{ label, value }] : [];
  }) : [];
  model.procedure = rows.length ? rows : null;
  model.procedureMissing = !rows.length;

  const authority = context.authority || canonical.authority;
  model.office = [
    ...printedOffice,
    ...(authority ? [{ label: "소관 기관", value: authority }] : []),
    ...(context.department ? [{ label: "담당 부서", value: context.department }] : []),
  ];

  model.oldFormMismatch = oldFormMismatch(context);
  model.contacts = context.contacts ?? [];
  model.formGuide = formGuideFor(context, options.documentTitle?.trim() ?? "");
  if (model.formGuide?.revisionMismatch) notices.push(`사진의 서식(${model.formGuide.printedRevision} 개정)은 현행 ${model.formGuide.formLabel}(${model.formGuide.currentRevision}, 서식 이름: ${model.formGuide.currentTitle || "확인 필요"})과 달라요. 예전 서식이거나 번호가 바뀌었을 수 있으니 현행 서식을 내려받아 확인해 주세요.`);
  model.summary = context.summary;
  model.summarySourceIds = context.summary ? context.summarySourceIds ?? [] : [];
  model.sources = context.sources.map(source => ({ id: source.id, title: source.title, url: source.url, label: sourceLabel(source) }));
  model.queryTime = queryTimeText(context.retrievedAt);

  if (context.stale) notices.push("국가법령정보 연결 문제로 마지막으로 확인한 정보를 보여드려요.");
  if (model.formGuide?.differentForm) notices.push(model.formGuide.download
    ? `현행 ${model.formGuide.formLabel}은 다른 서식이에요. '${model.formGuide.documentTitle}'는 번호가 바뀐 현행 서식으로 안내해요.`
    : `현행 ${model.formGuide.formLabel}은 사진의 '${model.formGuide.documentTitle}'와 다른 서식이에요. 이 법령의 현행 서식에서 찾지 못했으니 접수 기관에 현행 서식을 확인해 주세요.`);
  if (model.oldFormMismatch && !model.formGuide?.revisionMismatch && !model.formGuide?.differentForm) notices.push("서식에 적힌 번호나 날짜가 현행 기준과 달라요. 예전 서식이거나 개정됐을 수 있어요.");
  if (model.noThreeTier) notices.push("법률·시행령·시행규칙 관계를 찾지 못해 정본 정보만 보여드려요.");
  if (!model.office.length) notices.push("소관 기관을 확인하지 못했어요. 서류에 적힌 기관이나 공식 안내에서 확인해 주세요.");
  if (model.procedureMissing) notices.push("공식 민원 절차 안내를 찾지 못했어요. 접수처와 준비물은 소관 기관에 확인해 주세요.");
  model.notices = [...new Set(notices)];
  return model;
}
