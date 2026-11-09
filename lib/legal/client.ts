import { StaleCache } from "./cache.ts";
import type { LegalApiDocument, LegalApiResult, LegalCandidate, LegalSearchReference } from "./types.ts";

const SEARCH_TTL_MS = 6 * 60 * 60_000;
const DETAIL_TTL_MS = 24 * 60 * 60_000;
const STALE_TTL_MS = 7 * 24 * 60 * 60_000;
const MAX_RESPONSE_BYTES = 2 * 1024 * 1024;
const DEFAULT_BASE_URL = "https://www.law.go.kr/DRF";

type ClientOptions = {
  oc: string;
  fetch?: typeof fetch;
  now?: () => number;
  timeoutMs?: number;
  baseUrl?: string;
};

export class LegalApiError extends Error {
  readonly code: string;
  readonly status: number;

  constructor(code: string, status = 502) {
    super(code);
    this.name = "LegalApiError";
    this.code = code;
    this.status = status;
  }
}

export type LegalApiClient = {
  search(reference: LegalSearchReference, signal?: AbortSignal): Promise<LegalApiResult<LegalCandidate[]>>;
  fetchBody(candidate: LegalCandidate, signal?: AbortSignal): Promise<LegalApiResult<LegalApiDocument>>;
  fetchHierarchy(candidate: LegalCandidate, signal?: AbortSignal): Promise<LegalApiResult<LegalApiDocument>>;
  fetchThreeTier(candidate: LegalCandidate, signal?: AbortSignal): Promise<LegalApiResult<LegalApiDocument>>;
};

function record(value: unknown): Record<string, unknown> | undefined {
  return value !== null && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : undefined;
}

function text(value: unknown): string {
  return typeof value === "string" || typeof value === "number" ? String(value).trim() : "";
}

function date(value: unknown): string {
  const digits = text(value).replace(/[^0-9]/g, "");
  return digits.length === 8 ? `${digits.slice(0, 4)}-${digits.slice(4, 6)}-${digits.slice(6)}` : "";
}

function list(value: unknown): unknown[] {
  if (Array.isArray(value)) return value;
  return value === undefined || value === null ? [] : [value];
}

function candidateFrom(value: unknown, target: "law" | "admrul"): LegalCandidate | undefined {
  const item = record(value);
  if (!item) return undefined;
  const serialNumber = text(item["법령일련번호"] ?? item["행정규칙일련번호"] ?? item["행정규칙ID"] ?? item.id);
  const name = text(item["법령명한글"] ?? item["행정규칙명"] ?? item["행정규칙명한글"] ?? item.name).replace(/<[^>]*>/g, "");
  if (!serialNumber || !name) return undefined;
  const history = text(item["현행연혁코드"] ?? item["현행여부"] ?? item.status);
  return {
    id: `${target === "law" ? "law" : "administrative_rule"}:${serialNumber}`,
    serialNumber,
    kind: target === "law" ? "law" : "administrative_rule",
    name,
    category: text(item["법령구분명"] ?? item["행정규칙종류"] ?? item.category),
    authority: text(item["소관부처명"] ?? item["발령기관명"] ?? item["소관부처"] ?? item.authority),
    promulgationNumber: text(item["공포번호"] ?? item["발령번호"] ?? item.number),
    promulgationDate: date(item["공포일자"] ?? item["발령일자"] ?? item.date),
    effectiveDate: date(item["시행일자"] ?? item.effectiveDate),
    status: /폐지|연혁/.test(history) ? "repealed" : /현행/.test(history) ? "current" : "unknown",
    apiTarget: target,
  };
}

function normalizeCandidates(payload: unknown, target: "law" | "admrul"): LegalCandidate[] {
  const root = record(payload);
  const search = record(root?.[target === "law" ? "LawSearch" : "AdmRulSearch"] ?? root?.[target === "law" ? "lawSearch" : "admRulSearch"] ?? root);
  const raw = search?.[target === "law" ? "law" : "admrul"] ?? search?.[target === "law" ? "laws" : "admRul"] ?? [];
  const seen = new Set<string>();
  return list(raw).flatMap((value) => {
    const candidate = candidateFrom(value, target);
    if (!candidate || seen.has(candidate.id)) return [];
    seen.add(candidate.id);
    return [candidate];
  });
}

async function readJson(response: Response): Promise<unknown> {
  const declared = Number(response.headers.get("content-length"));
  if (Number.isFinite(declared) && declared > MAX_RESPONSE_BYTES) {
    await response.body?.cancel();
    throw new LegalApiError("LEGAL_API_RESPONSE_TOO_LARGE");
  }
  if (!response.ok) {
    await response.body?.cancel();
    throw new LegalApiError(response.status === 429 ? "LEGAL_API_RATE_LIMIT" : "LEGAL_API_UPSTREAM_ERROR", response.status === 429 ? 429 : 502);
  }
  const reader = response.body?.getReader();
  if (!reader) throw new LegalApiError("LEGAL_API_INVALID_RESPONSE");
  const chunks: Uint8Array[] = [];
  let size = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > MAX_RESPONSE_BYTES) {
      await reader.cancel();
      throw new LegalApiError("LEGAL_API_RESPONSE_TOO_LARGE");
    }
    chunks.push(value);
  }
  try { return JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(Buffer.concat(chunks))); }
  catch { throw new LegalApiError("LEGAL_API_INVALID_RESPONSE"); }
}

export function createLegalApiClient(options: ClientOptions): LegalApiClient {
  const oc = options.oc.trim();
  if (!oc) throw new LegalApiError("LEGAL_API_NOT_CONFIGURED", 503);
  const fetchFn = options.fetch ?? globalThis.fetch;
  const now = options.now ?? Date.now;
  const timeoutMs = options.timeoutMs ?? 12_000;
  const baseUrl = options.baseUrl ?? DEFAULT_BASE_URL;
  const searchCache = new StaleCache<string, LegalApiResult<LegalCandidate[]>>({ freshTtlMs: SEARCH_TTL_MS, staleTtlMs: STALE_TTL_MS, capacity: 80, now });
  const detailCache = new StaleCache<string, LegalApiResult<LegalApiDocument>>({ freshTtlMs: DETAIL_TTL_MS, staleTtlMs: STALE_TTL_MS, capacity: 120, now });

  const request = async (path: string, parameters: Record<string, string>, signal?: AbortSignal): Promise<unknown> => {
    if (signal?.aborted) throw new LegalApiError("LEGAL_API_CANCELLED", 499);
    const timeout = new AbortController();
    const timer = setTimeout(() => timeout.abort(), timeoutMs);
    timer.unref?.();
    const combined = AbortSignal.any([timeout.signal, ...(signal ? [signal] : [])]);
    const url = new URL(`${baseUrl}/${path}`);
    url.search = new URLSearchParams({ OC: oc, type: "JSON", ...parameters }).toString();
    try {
      const response = await fetchFn(url.toString(), { method: "GET", cache: "no-store", signal: combined, headers: { Accept: "application/json" } });
      return await readJson(response);
    } catch (error) {
      if (error instanceof LegalApiError) throw error;
      if (signal?.aborted) throw new LegalApiError("LEGAL_API_CANCELLED", 499);
      if (timeout.signal.aborted) throw new LegalApiError("LEGAL_API_TIMEOUT", 504);
      throw new LegalApiError("LEGAL_API_UNAVAILABLE", 503);
    } finally { clearTimeout(timer); }
  };

  const cached = async <T>(cache: StaleCache<string, LegalApiResult<T>>, key: string, load: () => Promise<T>): Promise<LegalApiResult<T>> => {
    const fresh = cache.getFresh(key);
    if (fresh) return fresh;
    try {
      const result = { value: await load(), retrievedAt: new Date(now()).toISOString(), stale: false };
      cache.set(key, result);
      return result;
    } catch (error) {
      if (error instanceof LegalApiError && error.code === "LEGAL_API_CANCELLED") throw error;
      const stale = cache.getStale(key);
      if (stale) return { ...stale, stale: true };
      throw error;
    }
  };

  const detail = (target: string, candidate: LegalCandidate, signal?: AbortSignal) => {
    const idKey = candidate.apiTarget === "law" ? "MST" : "ID";
    const key = `${target}:${candidate.id}`;
    return cached(detailCache, key, async () => ({ target, payload: await request("lawService.do", { target, [idKey]: candidate.serialNumber }, signal) }));
  };

  return {
    search(reference, signal) {
      const target = reference.kind === "administrative_rule" ? "admrul" : "law";
      const key = JSON.stringify([target, reference.name.trim(), reference.authority ?? "", reference.number ?? "", reference.date ?? ""]);
      return cached(searchCache, key, async () => normalizeCandidates(await request("lawSearch.do", { target, query: reference.name.trim() }, signal), target));
    },
    fetchBody(candidate, signal) { return detail(candidate.apiTarget, candidate, signal); },
    fetchHierarchy(candidate, signal) { return detail("lsStmd", candidate, signal); },
    fetchThreeTier(candidate, signal) { return detail("thdCmp", candidate, signal); },
  };
}

