export class InputError extends Error {
  code: string;
  status: number;
  constructor(code: string, status = 400) { super(code); this.code = code; this.status = status; }
}

const messages: Record<string, string> = {
  INVALID_JSON: "요청을 읽지 못했어요. 다시 시도해 주세요.",
  REQUEST_TOO_LARGE: "사진이 너무 커요. 더 작은 사진으로 다시 골라 주세요.",
  INVALID_IMAGE: "JPG 또는 PNG 사진으로 다시 골라 주세요.",
  AI_NOT_CONFIGURED: "AI 연결 설정이 필요해요. 서비스 관리자에게 알려 주세요.",
  AI_KEY_REJECTED: "AI 연결을 확인하지 못했어요. 서비스 관리자에게 알려 주세요.",
  AI_RATE_LIMIT: "요청이 많아요. 잠시 후 다시 눌러 주세요.",
  AI_TIMEOUT: "사진을 살펴보는 데 시간이 걸려요. 다시 시도해 주세요.",
  AI_UNAVAILABLE: "AI 연결이 원활하지 않아요. 잠시 후 다시 시도해 주세요.",
  SESSION_EXPIRED: "이전에 본 서류의 시간이 지났어요. 사진을 다시 살펴볼게요.",
  UNKNOWN_FIELD: "이 칸을 찾지 못했어요. 다른 칸을 골라 주세요.",
  INVALID_ANSWER: "선택한 답을 확인하지 못했어요. 다시 골라 주세요.",
  CANCELLED: "안내 요청을 멈췄어요.",
  INVALID_REGION: "칸을 조금 더 넓게 골라 주세요. 서류 안쪽에서 영역을 선택해 주세요.",
  REGION_NOT_READABLE: "선택한 곳에서 작성할 칸을 읽지 못했어요. 항목 이름과 적을 곳을 함께 골라 주세요.",
  REGION_CONFLICT: "서류의 칸이 바뀌었어요. 현재 화면을 확인하고 다시 시도해 주세요.",
  FIELD_LIMIT: "이 사진에는 안내할 칸이 많아요. 필요한 부분만 가까이 찍어 새로 시작해 주세요.",
  UNKNOWN_LEGAL_CANDIDATE: "선택한 법령 후보를 찾지 못했어요. 목록을 다시 확인해 주세요.",
  LEGAL_CONTEXT_CONFLICT: "법령 선택이 바뀌었어요. 현재 법령 정보를 다시 확인해 주세요.",
  LEGAL_NOT_READY: "아직 법령 정보를 준비하고 있어요.",
  LEGAL_API_NOT_CONFIGURED: "국가법령정보 연결 설정이 필요해요. 서비스 관리자에게 알려 주세요.",
};

export function json(value: unknown, status = 200) {
  return Response.json(value, { status, headers: { "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff" } });
}

export function errorResponse(error: unknown) {
  const candidate = error as { code?: string; status?: number };
  const code = candidate?.code || "AI_INVALID_RESPONSE";
  return json({ code, error: messages[code] || "안내를 준비하지 못했어요. 다시 시도해 주세요." }, candidate?.status || 502);
}

export async function requestJson(request: Request): Promise<Record<string, unknown>> {
  const origin = request.headers.get("origin");
  if (origin) {
    const target = new URL(request.url);
    let from: URL;
    try { from = new URL(origin); } catch { throw new InputError("INVALID_JSON", 403); }
    const localHosts = new Set(["localhost", "127.0.0.1", "[::1]"]);
    const localAlias = localHosts.has(from.hostname) && localHosts.has(target.hostname) && from.port === target.port && from.protocol === target.protocol && request.headers.get("host") === from.host;
    if (from.origin !== target.origin && !localAlias) throw new InputError("INVALID_JSON", 403);
  }
  if (!request.headers.get("content-type")?.toLowerCase().startsWith("application/json")) throw new InputError("INVALID_JSON", 415);
  const limit = 9 * 1024 * 1024;
  const declared = Number(request.headers.get("content-length"));
  if (declared > limit) throw new InputError("REQUEST_TOO_LARGE", 413);
  const reader = request.body?.getReader();
  if (!reader) throw new InputError("INVALID_JSON");
  let size = 0;
  const chunks: Uint8Array[] = [];
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.length;
      if (size > limit) { await reader.cancel(); throw new InputError("REQUEST_TOO_LARGE", 413); }
      chunks.push(value);
    }
    const parsed = JSON.parse(Buffer.concat(chunks).toString("utf8"));
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) throw new InputError("INVALID_JSON");
    return parsed;
  } catch (error) {
    if (error instanceof InputError) throw error;
    throw new InputError("INVALID_JSON");
  }
}

const requestBudget = globalThis as typeof globalThis & { documentRequestBudget?: { active: number; windows: Map<string, number[]> } };
const budget: { active: number; windows: Map<string, number[]> } = requestBudget.documentRequestBudget ??= { active: 0, windows: new Map<string, number[]>() };

export function acquireBudget(request: Request): () => void {
  const now = Date.now();
  for (const [key, calls] of budget.windows) if (calls.every((time) => time < now - 60_000)) budget.windows.delete(key);
  const client = request.headers.get("x-forwarded-for")?.split(",")[0]?.trim().slice(0, 80) || "local";
  const calls = (budget.windows.get(client) || []).filter((time) => time > now - 60_000);
  if (calls.length >= 30 || budget.active >= 2) throw new InputError("AI_RATE_LIMIT", 429);
  if (budget.windows.size >= 1000 && !budget.windows.has(client)) throw new InputError("AI_RATE_LIMIT", 429);
  budget.windows.set(client, [...calls, now]);
  budget.active++;
  let released = false;
  return () => { if (!released) { released = true; budget.active--; } };
}

export async function withBudget<T>(request: Request, task: () => Promise<T>): Promise<T> {
  const release = acquireBudget(request);
  try { return await task(); } finally { release(); }
}
