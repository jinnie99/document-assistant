import type { LegalApiClient } from "./client.ts";
import type { LegalCandidate, LegalContact, LegalContext, LegalHierarchy, LegalReferenceHints, LegalSearchReference } from "./types.ts";

export type LegalResolution = LegalContext;

const EMPTY_HIERARCHY = (): LegalHierarchy => ({ act: null, decree: null, rule: null, administrativeRules: [] });

function normalized(value: string): string {
  return value.normalize("NFKC").toLocaleLowerCase("ko-KR").replace(/[\s·ㆍ.,()\[\]{}「」『』제호_-]/g, "");
}

export function scoreLegalCandidate(reference: LegalSearchReference, candidate: LegalCandidate): number {
  const expected = normalized(reference.name);
  const actual = normalized(candidate.name);
  let score = expected === actual ? 60 : expected.includes(actual) || actual.includes(expected) ? 35 : 0;
  if (reference.formNumber && expected === actual) score += 15; /* 서식번호가 붙은 법령이 이 서식의 직접 근거다. */
  if (reference.kind === candidate.kind) score += 5;
  if (reference.authority && normalized(reference.authority) === normalized(candidate.authority)) score += 15;
  if (reference.number && normalized(reference.number) === normalized(candidate.promulgationNumber)) score += 15;
  if (reference.date && (reference.date === candidate.promulgationDate || reference.date === candidate.effectiveDate)) score += 10;
  if (candidate.status === "current") score += 5;
  if (candidate.status === "repealed") score -= 20;
  return score;
}

function empty(status: LegalContext["status"], hints: LegalReferenceHints, candidates: LegalCandidate[] = []): LegalContext {
  return {
    status, detectedReferences: hints.references, candidates, canonicalRule: null, hierarchy: EMPTY_HIERARCHY(),
    provisions: [], forms: [], authority: "", procedure: null, summary: "", sources: [], warnings: [], retrievedAt: "", stale: false,
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function text(value: unknown): string {
  return typeof value === "string" || typeof value === "number" ? String(value).trim() : "";
}

function isoDate(value: unknown): string {
  const digits = text(value).replace(/[^0-9]/g, "");
  return digits.length === 8 ? `${digits.slice(0, 4)}-${digits.slice(4, 6)}-${digits.slice(6)}` : text(value);
}

function walk(value: unknown, visit: (item: Record<string, unknown>) => void): void {
  if (Array.isArray(value)) { for (const item of value) walk(item, visit); return; }
  if (!isRecord(value)) return;
  visit(value);
  for (const child of Object.values(value)) walk(child, visit);
}

function relatedCandidate(value: Record<string, unknown>): LegalCandidate | undefined {
  if (typeof value.id === "string" && typeof value.serialNumber === "string" && (value.kind === "law" || value.kind === "administrative_rule") && typeof value.name === "string" && typeof value.apiTarget === "string") return value as unknown as LegalCandidate;
  const serialNumber = text(value["법령일련번호"] ?? value["행정규칙일련번호"] ?? value["행정규칙ID"]);
  const name = text(value["법령명한글"] ?? value["법령명_한글"] ?? value["행정규칙명"] ?? value["행정규칙명한글"]);
  if (!serialNumber || !name) return undefined;
  const category = text(value["법령구분명"] ?? value["행정규칙종류"]);
  const administrative = Boolean(value["행정규칙일련번호"] ?? value["행정규칙ID"]) || /(고시|훈령|예규|지침)/.test(category);
  const history = text(value["현행연혁코드"] ?? value["현행여부"]);
  return {
    id: `${administrative ? "administrative_rule" : "law"}:${serialNumber}`,
    serialNumber,
    kind: administrative ? "administrative_rule" : "law",
    name,
    category,
    authority: text(value["소관부처명"] ?? value["발령기관명"]),
    promulgationNumber: text(value["공포번호"] ?? value["발령번호"]),
    promulgationDate: isoDate(value["공포일자"] ?? value["발령일자"]),
    effectiveDate: isoDate(value["시행일자"]),
    status: /폐지|연혁/.test(history) ? "repealed" : /현행/.test(history) ? "current" : "unknown",
    apiTarget: administrative ? "admrul" : "law",
  };
}

function candidatesIn(payloads: unknown[]): LegalCandidate[] {
  const found = new Map<string, LegalCandidate>();
  for (const payload of payloads) walk(payload, item => {
    const candidate = relatedCandidate(item);
    if (candidate) found.set(candidate.id, candidate);
  });
  return [...found.values()];
}

function hierarchyFrom(canonical: LegalCandidate, payloads: unknown[]): LegalHierarchy {
  const hierarchy = EMPTY_HIERARCHY();
  const candidates = new Map(candidatesIn(payloads).map(item => [item.id, item]));
  candidates.set(canonical.id, canonical);
  for (const candidate of candidates.values()) {
    if (candidate.kind === "administrative_rule") {
      if (hierarchy.administrativeRules.length < 20) hierarchy.administrativeRules.push(candidate);
    } else if (/시행령$/.test(candidate.name) || /대통령령/.test(candidate.category)) {
      hierarchy.decree ??= candidate;
    } else if (/시행규칙$/.test(candidate.name) || /(총리령|부령)/.test(candidate.category)) {
      hierarchy.rule ??= candidate;
    } else if (/법률/.test(candidate.category)) {
      hierarchy.act ??= candidate;
    }
  }
  return hierarchy;
}

function officialUrl(candidate: LegalCandidate): string {
  const kind = candidate.kind === "administrative_rule" ? "행정규칙" : "법령";
  return `https://www.law.go.kr/${encodeURIComponent(kind)}/${encodeURIComponent(candidate.name)}`;
}

export function officialFormUrl(value: unknown): string { return safeOfficialUrl(value); }

function safeOfficialUrl(value: unknown): string {
  const raw = text(value);
  if (raw.startsWith("/LSW/") || raw.startsWith("/DRF/")) return `https://www.law.go.kr${raw}`;
  try {
    const url = new URL(raw);
    return url.protocol === "https:" && (url.hostname === "law.go.kr" || url.hostname.endsWith(".law.go.kr")) ? url.toString() : "";
  } catch { return ""; }
}

/** 별표내용은 문자열이나 중첩 배열로 올 수 있어 모든 문자열을 이어 붙인다. */
function flattenText(value: unknown): string {
  if (Array.isArray(value)) return value.map(flattenText).join(" ");
  return text(value);
}

function articleLabel(number: unknown, branch: unknown): string {
  const raw = text(number);
  if (!/^\d+$/.test(raw)) return raw.slice(0, 80);
  const extra = Number(text(branch));
  return `제${Number(raw)}조${extra > 0 ? `의${extra}` : ""}`;
}

function clauseLines(value: unknown, out: string[]): void {
  if (Array.isArray(value)) { for (const item of value) clauseLines(item, out); return; }
  if (!isRecord(value)) return;
  for (const key of ["항내용", "호내용", "목내용"]) { const line = flattenText(value[key]); if (line) out.push(line); }
  for (const key of ["호", "목"]) clauseLines(value[key], out);
}

function articleBody(item: Record<string, unknown>, content: string): string {
  const lines = [content];
  clauseLines(item["항"], lines);
  return lines.join(" ").replace(/\s+/g, " ").trim().slice(0, 5000);
}

function ministryName(value: unknown): string {
  return isRecord(value) ? text(value.content) : text(value);
}

function bodyDetails(payload: unknown, sourceId: string) {
  const provisions: LegalContext["provisions"] = [];
  const forms: LegalContext["forms"] = [];
  const contacts: LegalContact[] = [];
  let authority = "";
  let department = "";
  walk(payload, item => {
    if (!authority) authority = text(item["소관부처명"] ?? item["발령기관명"]) || ministryName(item["소관부처"]);
    if (!department) department = text(item["담당부서기관명"] ?? item["담당부서명"]);
    const contactName = text(item["부서명"]);
    const phone = text(item["부서연락처"]);
    if (contactName && phone && contacts.length < 10 && !contacts.some(contact => contact.department === contactName)) contacts.push({ department: contactName, phone });
    const article = articleLabel(item["조문번호"], item["조문가지번호"]);
    const content = text(item["조문내용"]);
    if (article && content && item["조문여부"] !== "전문" && provisions.length < 80) provisions.push({
      id: `provision-${provisions.length + 1}`, lawName: "", article, title: text(item["조문제목"]).replace(/\s+/g, " ").slice(0, 200), text: articleBody(item, content), sourceIds: [sourceId],
    });
    const formNumber = text(item["별표번호"] ?? item["별지번호"]);
    const formTitle = text(item["별표제목"] ?? item["별지제목"]);
    const url = safeOfficialUrl(item["별표서식파일링크"] ?? item["별지서식파일링크"] ?? item["별표PDF파일링크"]);
    if ((formNumber || formTitle) && url && forms.length < 120) {
      const number = Number(formNumber);
      const label = text(item["별표구분"]) === "서식" && Number.isInteger(number) && number > 0 ? `별지 제${number}호서식` : undefined;
      const revision = /<((?:개정|신설|전문개정)[^>]*\d[^>]*)>/.exec(flattenText(item["별표내용"]))?.[1]?.trim();
      forms.push({ id: `form-${forms.length + 1}`, title: (formTitle || formNumber).replace(/\s+/g, " ").slice(0, 300), url, sourceIds: [sourceId], ...(label ? { label } : {}), ...(revision ? { revision } : {}) });
    }
  });
  return { provisions, forms, authority, department, contacts };
}

export async function resolveSelectedLegalContext(hints: LegalReferenceHints, canonical: LegalCandidate, client: LegalApiClient, signal?: AbortSignal): Promise<LegalResolution> {
  const details = await Promise.allSettled([client.fetchBody(canonical, signal), client.fetchHierarchy(canonical, signal), client.fetchThreeTier(canonical, signal)]);
  const fulfilled = details.flatMap(item => item.status === "fulfilled" ? [item.value] : []);
  const stale = fulfilled.some(item => item.stale);
  const retrievedAt = fulfilled[0]?.retrievedAt ?? "";
  const payloads = fulfilled.map(item => item.value.payload);
  const sourceId = `legal-${canonical.kind === "law" ? "law" : "rule"}-${canonical.serialNumber.replace(/[^A-Za-z0-9_-]/g, "") || "source"}`;
  const body = bodyDetails(fulfilled.find(item => item.value.target === canonical.apiTarget)?.value.payload ?? payloads[0], sourceId);
  for (const provision of body.provisions) provision.lawName = canonical.name;
  const warnings: string[] = [];
  if (details.some(item => item.status === "rejected")) warnings.push("일부 법령 상세 정보를 확인하지 못했어요.");
  if (stale) warnings.push("국가법령정보 API 연결 문제로 마지막 확인 정보를 표시해요.");
  return {
    status: "completed", detectedReferences: hints.references, candidates: [canonical], canonicalRule: canonical,
    hierarchy: hierarchyFrom(canonical, payloads), provisions: body.provisions, forms: body.forms,
    authority: body.authority || canonical.authority, department: body.department, contacts: body.contacts, procedure: null, summary: "",
    sources: [{ id: sourceId, title: canonical.name, url: officialUrl(canonical), kind: canonical.kind, retrievedAt }],
    warnings, retrievedAt, stale,
  };
}

export async function resolveLegalContext(hints: LegalReferenceHints, client: LegalApiClient, signal?: AbortSignal): Promise<LegalResolution> {
  const resolved = await resolveReferences(hints, client, signal);
  return {
    ...resolved,
    ...(hints.receivingOffice ? { printedReceivingOffice: hints.receivingOffice } : {}),
    ...(hints.citedArticles?.length ? { printedArticles: hints.citedArticles } : {}),
  };
}

async function resolveReferences(hints: LegalReferenceHints, client: LegalApiClient, signal?: AbortSignal): Promise<LegalResolution> {
  if (!hints.references.length) return empty("not_found", hints);
  const searches = await Promise.allSettled(hints.references.map(reference => client.search(reference, signal)));
  if (searches.every(item => item.status === "rejected")) return empty("unavailable", hints);
  const candidates = new Map<string, LegalCandidate>();
  let retrievedAt = "";
  let stale = false;
  for (const item of searches) if (item.status === "fulfilled") {
    retrievedAt ||= item.value.retrievedAt;
    stale ||= item.value.stale;
    for (const candidate of item.value.value) candidates.set(candidate.id, candidate);
  }
  if (!candidates.size) return { ...empty("not_found", hints), retrievedAt, stale };
  const ranked = [...candidates.values()].map(candidate => ({ candidate, score: Math.max(...hints.references.map(reference => scoreLegalCandidate(reference, candidate))) }))
    .sort((a, b) => b.score - a.score || a.candidate.id.localeCompare(b.candidate.id));
  const top = ranked[0];
  const next = ranked[1];
  if (top.score < 60 || (next && top.score - next.score < 10)) return { ...empty("ambiguous", hints, ranked.slice(0, 20).map(item => item.candidate)), retrievedAt, stale };

  const resolved = await resolveSelectedLegalContext(hints, top.candidate, client, signal);
  return { ...resolved, candidates: ranked.slice(0, 20).map(item => item.candidate), stale: stale || resolved.stale, retrievedAt: resolved.retrievedAt || retrievedAt };
}
