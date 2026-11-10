import type { LegalApiClient } from "./client.ts";
import { officialFormUrl } from "./resolver.ts";
import type { LegalCandidate, LegalCurrentForm, LegalFormListing, LegalPrintedArticle } from "./types.ts";

export type DocumentHint = { title: string; fieldLabels: string[] };

export type LocatedForm = { form: LegalCurrentForm; candidate: LegalCandidate; bodyText: string; sourceId: string };

const MIN_MATCH = 0.6;
const MIN_LEAD = 0.15;

function normalized(value: string): string {
  return value.normalize("NFKC").replace(/[\s·ㆍ.,()\[\]{}「」『』_-]/g, "").toLocaleLowerCase("ko-KR");
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function text(value: unknown): string {
  return typeof value === "string" || typeof value === "number" ? String(value).trim() : "";
}

function flatten(value: unknown): string {
  return Array.isArray(value) ? value.map(flatten).join(" ") : text(value);
}

/** 별지 본문의 표 괘선을 지워 문구만 남긴다. */
export function formBodyText(value: unknown): string {
  return flatten(value).replace(/[─-╿■?]+/g, " ").replace(/\s+/g, " ").trim().slice(0, 12_000);
}

function walk(value: unknown, visit: (item: Record<string, unknown>) => void): void {
  if (Array.isArray(value)) { for (const item of value) walk(item, visit); return; }
  if (!isRecord(value)) return;
  visit(value);
  for (const child of Object.values(value)) walk(child, visit);
}

function isoDate(value: unknown): string {
  const digits = text(value).replace(/[^0-9]/g, "");
  return digits.length === 8 ? `${digits.slice(0, 4)}-${digits.slice(4, 6)}-${digits.slice(6)}` : "";
}

function lawCandidate(listing: LegalFormListing): LegalCandidate {
  return {
    id: `law:${listing.lawSerial}`, serialNumber: listing.lawSerial, kind: "law", name: listing.lawName, category: "",
    authority: listing.authority.slice(0, 100), promulgationNumber: "", promulgationDate: listing.date, effectiveDate: "", status: "current", apiTarget: "law",
  };
}

function bodyItem(payload: unknown, number: string): { item?: Record<string, unknown>; effectiveDate: string } {
  let found: Record<string, unknown> | undefined;
  let effectiveDate = "";
  walk(payload, item => {
    if (!effectiveDate) effectiveDate = isoDate(item["시행일자"]);
    if (!found && text(item["별표구분"]) === "서식" && `${text(item["별표번호"])}${text(item["별표가지번호"]) || "00"}` === number) found = item;
  });
  return { item: found, effectiveDate };
}

/** 사진에서 읽은 칸 이름이 후보 서식 본문에 얼마나 들어 있는지 본다. */
export function fieldOverlap(fieldLabels: string[], body: string): number {
  const haystack = normalized(body);
  const labels = [...new Set(fieldLabels.map(normalized).filter(label => label.length >= 2))];
  if (!labels.length) return 0;
  return labels.filter(label => haystack.includes(label)).length / labels.length;
}

/** 서식 본문의 "「OO법」 제N조 및 같은 법 시행규칙 제M조제K항"을 현행 근거 조문으로 읽는다. */
export function citedArticlesIn(body: string): LegalPrintedArticle[] {
  const articles: LegalPrintedArticle[] = [];
  const pattern = /「([^」]{2,80})」\s*(제\s*\d+\s*조(?:의\s*\d+)?(?:\s*제\s*\d+\s*항)?)(?:[^「。]{0,12}?같은\s*법\s*(시행령|시행규칙)\s*(제\s*\d+\s*조(?:의\s*\d+)?(?:\s*제\s*\d+\s*항)?))?/g;
  for (const match of body.matchAll(pattern)) {
    articles.push({ lawName: match[1].trim(), article: match[2].replace(/\s/g, "") });
    if (match[3] && match[4]) articles.push({ lawName: `${match[1].trim()} ${match[3]}`, article: match[4].replace(/\s/g, "") });
    if (articles.length >= 4) break;
  }
  return articles;
}

function formLabel(number: string): string {
  const main = Number(number.slice(0, 4)), branch = Number(number.slice(4));
  return `별지 제${main}호${branch > 0 ? `의${branch}` : ""}서식`;
}

/**
 * 서류 제목으로 국가법령정보의 전체 별표·서식을 찾고, 같은 제목 중 사진의 칸 구성과 맞는 서식 하나만 고른다.
 * 제목만 같은 다른 법령의 서식을 내려받게 하지 않도록 확신이 없으면 null을 돌려준다.
 */
export async function locateCurrentForm(document: DocumentHint, client: LegalApiClient, signal?: AbortSignal): Promise<LocatedForm | null> {
  const title = normalized(document.title);
  if (title.length < 4 || !client.searchForms) return null;
  const listing = await client.searchForms(document.title, signal);
  const exact = listing.value.filter(item => normalized(item.title) === title).slice(0, 6);
  if (!exact.length) return null;
  const checked = await Promise.allSettled(exact.map(async entry => {
    const candidate = lawCandidate(entry);
    const detail = await client.fetchBody(candidate, signal);
    const { item, effectiveDate } = bodyItem(detail.value.payload, entry.number);
    if (!item) return null;
    const body = formBodyText(item["별표내용"]);
    return { entry, item, body, candidate: { ...candidate, effectiveDate }, score: fieldOverlap(document.fieldLabels, body) };
  }));
  const ranked = checked.flatMap(result => result.status === "fulfilled" && result.value ? [result.value] : []).sort((a, b) => b.score - a.score);
  const [best, next] = ranked;
  if (!best || best.score < MIN_MATCH || (next && best.score - next.score < MIN_LEAD)) return null;
  const hwpUrl = officialFormUrl(best.item["별표서식파일링크"]);
  const pdfUrl = officialFormUrl(best.item["별표서식PDF파일링크"]);
  if (!hwpUrl && !pdfUrl) return null;
  const revision = /<((?:개정|신설|전문개정)[^>]*\d[^>]*)>/.exec(best.body)?.[1]?.trim() ?? "";
  return {
    candidate: best.candidate,
    bodyText: best.body,
    sourceId: `legal-form-${best.entry.lawSerial}-${best.entry.number}`.replace(/[^A-Za-z0-9_-]/g, "").slice(0, 64),
    form: {
      title: best.entry.title.slice(0, 300), lawName: best.entry.lawName.slice(0, 200), lawSerial: best.entry.lawSerial.slice(0, 100), label: formLabel(best.entry.number),
      revision: revision.slice(0, 80), hwpUrl, pdfUrl, articles: citedArticlesIn(best.body),
    },
  };
}
