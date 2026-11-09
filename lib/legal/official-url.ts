import { createHash } from "node:crypto";
import { lookup } from "node:dns/promises";
import { isIP } from "node:net";

const MAX_HTML_BYTES = 1024 * 1024;
const REDIRECTS = new Set([301, 302, 303, 307, 308]);

export type OfficialEvidence = {
  id: string;
  title: string;
  url: string;
  text: string;
  contentType: string;
  linkOnly: boolean;
  retrievedAt: string;
};

type PolicyDependencies = {
  resolveHost?: (hostname: string) => Promise<string[]>;
  verifiedHosts?: ReadonlySet<string>;
};

type FetchDependencies = PolicyDependencies & {
  fetch?: typeof fetch;
  now?: () => number;
  timeoutMs?: number;
};

async function systemResolve(hostname: string): Promise<string[]> {
  return (await lookup(hostname, { all: true, verbatim: true })).map(item => item.address);
}

function publicAddress(address: string): boolean {
  const version = isIP(address);
  if (version === 4) {
    const parts = address.split(".").map(Number);
    const [a, b] = parts;
    if (a === 0 || a === 10 || a === 127 || a >= 224) return false;
    if (a === 100 && b >= 64 && b <= 127) return false;
    if (a === 169 && b === 254) return false;
    if (a === 172 && b >= 16 && b <= 31) return false;
    if (a === 192 && b === 168) return false;
    if (a === 198 && (b === 18 || b === 19)) return false;
    return true;
  }
  if (version === 6) {
    const value = address.toLowerCase().split("%")[0];
    if (value === "::" || value === "::1" || value.startsWith("fc") || value.startsWith("fd")) return false;
    if (/^fe[89ab]/.test(value)) return false;
    if (value.startsWith("::ffff:")) return publicAddress(value.slice(7));
    return true;
  }
  return false;
}

function allowedHostname(hostname: string, verifiedHosts: ReadonlySet<string>): boolean {
  const host = hostname.toLowerCase().replace(/\.$/, "");
  return host === "gov.kr" || host.endsWith(".gov.kr") || host === "law.go.kr" || host.endsWith(".law.go.kr") || host.endsWith(".go.kr") || verifiedHosts.has(host);
}

export function isPotentialOfficialUrl(value: string, verifiedHosts: ReadonlySet<string> = new Set()): boolean {
  try {
    const url = new URL(value);
    return url.protocol === "https:" && !url.username && !url.password && !url.port && !isIP(url.hostname) && allowedHostname(url.hostname, verifiedHosts);
  } catch { return false; }
}

export async function validateOfficialUrl(value: string, dependencies: PolicyDependencies = {}): Promise<URL> {
  let url: URL;
  try { url = new URL(value); } catch { throw new Error("UNSAFE_OFFICIAL_URL"); }
  const verifiedHosts = new Set([...(dependencies.verifiedHosts ?? [])].map(host => host.toLowerCase().replace(/\.$/, "")));
  if (url.protocol !== "https:" || url.username || url.password || url.port || !allowedHostname(url.hostname, verifiedHosts) || isIP(url.hostname)) throw new Error("UNSAFE_OFFICIAL_URL");
  const resolveHost = dependencies.resolveHost ?? systemResolve;
  for (let check = 0; check < 2; check++) {
    let addresses: string[];
    try { addresses = await resolveHost(url.hostname); } catch { throw new Error("UNSAFE_OFFICIAL_URL"); }
    if (!addresses.length || addresses.some(address => !publicAddress(address))) throw new Error("UNSAFE_OFFICIAL_URL");
  }
  url.hash = "";
  return url;
}

async function boundedText(response: Response): Promise<string> {
  const declared = Number(response.headers.get("content-length"));
  if (Number.isFinite(declared) && declared > MAX_HTML_BYTES) {
    await response.body?.cancel();
    throw new Error("OFFICIAL_RESPONSE_TOO_LARGE");
  }
  const reader = response.body?.getReader();
  if (!reader) return "";
  const chunks: Uint8Array[] = [];
  let size = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > MAX_HTML_BYTES) {
      await reader.cancel();
      throw new Error("OFFICIAL_RESPONSE_TOO_LARGE");
    }
    chunks.push(value);
  }
  try { return new TextDecoder("utf-8", { fatal: true }).decode(Buffer.concat(chunks)); }
  catch { throw new Error("OFFICIAL_INVALID_RESPONSE"); }
}

function decodeEntities(value: string): string {
  const named: Record<string, string> = { amp: "&", lt: "<", gt: ">", quot: "\"", apos: "'", nbsp: " " };
  return value.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (_match, entity: string) => {
    if (entity.startsWith("#x")) return String.fromCodePoint(Number.parseInt(entity.slice(2), 16));
    if (entity.startsWith("#")) return String.fromCodePoint(Number.parseInt(entity.slice(1), 10));
    return named[entity.toLowerCase()] ?? " ";
  });
}

function htmlText(html: string): { title: string; text: string } {
  const title = decodeEntities(html.match(/<title\b[^>]*>([\s\S]*?)<\/title>/i)?.[1] ?? "").replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim().slice(0, 300);
  const text = decodeEntities(html.replace(/<(script|style|noscript|template)\b[^>]*>[\s\S]*?<\/\1>/gi, " ").replace(/<!--([\s\S]*?)-->/g, " ").replace(/<[^>]+>/g, " ")).replace(/\s+/g, " ").trim().slice(0, 200_000);
  return { title, text };
}

export async function fetchOfficialEvidence(value: string, dependencies: FetchDependencies = {}, signal?: AbortSignal): Promise<OfficialEvidence> {
  const fetchFn = dependencies.fetch ?? globalThis.fetch;
  const timeout = new AbortController();
  const timer = setTimeout(() => timeout.abort(), dependencies.timeoutMs ?? 10_000);
  timer.unref?.();
  const combined = AbortSignal.any([timeout.signal, ...(signal ? [signal] : [])]);
  try {
    let current = await validateOfficialUrl(value, dependencies);
    for (let redirects = 0; redirects <= 3; redirects++) {
      let response: Response;
      try { response = await fetchFn(current.toString(), { method: "GET", cache: "no-store", redirect: "manual", signal: combined, headers: { Accept: "text/html,application/pdf;q=0.5" } }); }
      catch {
        if (signal?.aborted) throw new Error("OFFICIAL_CANCELLED");
        if (timeout.signal.aborted) throw new Error("OFFICIAL_TIMEOUT");
        throw new Error("OFFICIAL_UNAVAILABLE");
      }
      if (REDIRECTS.has(response.status)) {
        const location = response.headers.get("location");
        await response.body?.cancel();
        if (!location || redirects === 3) throw new Error("UNSAFE_OFFICIAL_URL");
        current = await validateOfficialUrl(new URL(location, current).toString(), dependencies);
        continue;
      }
      if (!response.ok) { await response.body?.cancel(); throw new Error("OFFICIAL_UPSTREAM_ERROR"); }
      const contentType = response.headers.get("content-type")?.split(";")[0].trim().toLowerCase() || "application/octet-stream";
      const retrievedAt = new Date((dependencies.now ?? Date.now)()).toISOString();
      const id = `procedure-${createHash("sha256").update(current.toString()).digest("hex").slice(0, 16)}`;
      if (contentType !== "text/html" && contentType !== "application/xhtml+xml") {
        await response.body?.cancel();
        return { id, title: current.pathname.split("/").pop() || current.hostname, url: current.toString(), text: "", contentType, linkOnly: true, retrievedAt };
      }
      const parsed = htmlText(await boundedText(response));
      return { id, title: parsed.title || current.hostname, url: current.toString(), text: parsed.text, contentType, linkOnly: false, retrievedAt };
    }
    throw new Error("UNSAFE_OFFICIAL_URL");
  } finally { clearTimeout(timer); }
}
