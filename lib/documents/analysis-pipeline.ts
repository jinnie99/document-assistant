import { acquireBudget, errorResponse, InputError } from "./http.ts";
import { readDocument, readIdentity, readLegalReferences, searchDocument } from "./openai.ts";
import { analysisStore, type AnalysisStore } from "./store.ts";
import type { AnalysisEvent, AnalysisResult, DocumentIdentity, DocumentReading, SearchResult } from "./types.ts";
import { createLegalApiClient, type LegalApiClient } from "../legal/client.ts";
import { resolveLegalContext as resolveLegalReferences } from "../legal/resolver.ts";
import type { LegalContext, LegalReferenceHints } from "../legal/types.ts";
import { enrichLegalContext, type EnrichmentOptions } from "../legal/procedure.ts";

type AnalysisDependencies = {
  store: AnalysisStore;
  readIdentity: (image: string, signal: AbortSignal) => Promise<DocumentIdentity>;
  readDocument: (image: string, signal: AbortSignal, onProgress?: (reading: DocumentReading) => void) => Promise<DocumentReading>;
  searchDocument: (document: DocumentReading, signal: AbortSignal) => Promise<SearchResult>;
  readLegalReferences?: (image: string, signal: AbortSignal) => Promise<LegalReferenceHints>;
  resolveLegalContext?: (hints: LegalReferenceHints, signal: AbortSignal) => Promise<LegalContext>;
  enrichLegalContext?: (context: LegalContext, signal: AbortSignal, options?: EnrichmentOptions) => Promise<LegalContext>;
};

const pendingSearch: SearchResult = { status: "pending", case: "photo_only", summary: "같은 서류와 작성 안내를 찾고 있어요.", sources: [] };
const unavailableSearch: SearchResult = { status: "unavailable", case: "photo_only", summary: "검색을 마치지 못해 사진을 읽은 내용으로 안내해 드려요.", sources: [] };
const partialWarning = "사진의 일부 칸만 확인했어요. 보이지 않는 칸은 직접 골라서 추가할 수 있어요.";
const legalClients = globalThis as typeof globalThis & { documentLegalClient?: { oc: string; client: LegalApiClient } };

function legalClient(): LegalApiClient | undefined {
  const oc = process.env.LAW_OPEN_API_OC?.trim();
  if (!oc) return undefined;
  if (legalClients.documentLegalClient?.oc === oc) return legalClients.documentLegalClient.client;
  const client = createLegalApiClient({ oc });
  legalClients.documentLegalClient = { oc, client };
  return client;
}

function legalState(status: LegalContext["status"], hints: LegalReferenceHints = { references: [] }): LegalContext {
  return { status, detectedReferences: hints.references, candidates: [], canonicalRule: null, hierarchy: { act: null, decree: null, rule: null, administrativeRules: [] }, provisions: [], forms: [], authority: "", procedure: null, summary: "", sources: [], warnings: [], retrievedAt: "", stale: false };
}

function checkCancelled(signal: AbortSignal) {
  if (signal.aborted) throw new InputError("CANCELLED", 499);
}

function abortable<T>(task: Promise<T>, signal: AbortSignal): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const aborted = () => { signal.removeEventListener("abort", aborted); reject(new InputError("CANCELLED", 499)); };
    signal.addEventListener("abort", aborted, { once: true });
    task.then(value => { signal.removeEventListener("abort", aborted); resolve(value); }, error => { signal.removeEventListener("abort", aborted); reject(error); });
    if (signal.aborted) aborted();
  });
}

function identityFrom(document: DocumentReading): DocumentIdentity {
  const { title, institution, formNumber, revision, readable } = document;
  return { title, institution, formNumber, revision, description: "", readable };
}

export function createAnalysisStream(request: Request, image: string, overrides: Partial<AnalysisDependencies> = {}): Response {
  checkCancelled(request.signal);
  const release = acquireBudget(request);
  const configuredLegalClient = legalClient();
  const dependencies: AnalysisDependencies = {
    store: analysisStore, readIdentity, readDocument, searchDocument,
    ...(configuredLegalClient ? { readLegalReferences, resolveLegalContext: (hints: LegalReferenceHints, signal: AbortSignal) => resolveLegalReferences(hints, configuredLegalClient, signal), enrichLegalContext } : {}),
    ...overrides,
  };
  const work = new AbortController();
  const identifying = new AbortController();
  const identitySignal = AbortSignal.any([work.signal, identifying.signal]);
  const encoder = new TextEncoder();
  let controller: ReadableStreamDefaultController<Uint8Array>;
  let sessionId: string | undefined;
  let disconnected = false;
  let finished = false;
  let mappingComplete = false;
  let legalTask: Promise<void> | undefined;

  const retainAvailableFields = () => {
    const record = sessionId && dependencies.store.get(sessionId);
    if (!record) throw new InputError("SESSION_EXPIRED", 410);
    if (record.analysis.mappingStatus === "in_progress") {
      const document = record.analysis.document;
      dependencies.store.appendReading(record.analysis.id, { ...document, warnings: [...new Set([...document.warnings, partialWarning])] }, "partial");
    }
    if (record.analysis.legal?.status === "pending") dependencies.store.updateLegal(record.analysis.id, { ...record.analysis.legal, status: "unavailable", warnings: ["법령 조회 연결이 중단되었어요."] });
    return dependencies.store.updateSearch(record.analysis.id, unavailableSearch);
  };

  const cleanup = () => { request.signal.removeEventListener("abort", disconnect); release(); };
  const disconnect = () => {
    if (finished || disconnected) return;
    disconnected = true;
    work.abort(); identifying.abort();
    if (sessionId) {
      try { retainAvailableFields(); } catch { /* Deleted and expired sessions stay deleted. */ }
    }
    cleanup();
    try { controller.close(); } catch { /* The consumer may already have cancelled the body. */ }
  };
  const emit = (event: AnalysisEvent) => {
    checkCancelled(work.signal);
    controller.enqueue(encoder.encode(JSON.stringify(event) + "\n"));
  };

  const stream = new ReadableStream<Uint8Array>({
    async start(output) {
      controller = output;
      request.signal.addEventListener("abort", disconnect, { once: true });
      if (request.signal.aborted) disconnect();
      let identityTask: Promise<void> | undefined;
      try {
        checkCancelled(work.signal);
        emit({ type: "stage", stage: "identifying" });
        let identified = false;
        let identity: DocumentIdentity | undefined;
        const publishReading = (reading: DocumentReading, mappingStatus: NonNullable<AnalysisResult["mappingStatus"]>) => {
          checkCancelled(work.signal);
          const document = identity ? { ...reading, title: reading.title || identity.title, institution: reading.institution || identity.institution, formNumber: reading.formNumber || identity.formNumber, revision: reading.revision || identity.revision } : reading;
          if (!sessionId) {
            if (!identified) {
              identified = true;
              emit({ type: "identity", identity: identityFrom(document) });
              emit({ type: "stage", stage: "mapping" });
            }
            identifying.abort();
            const analysis = dependencies.store.put(document, pendingSearch, mappingStatus);
            sessionId = analysis.id;
            emit({ type: "mapped", analysis });
            return analysis;
          }
          const analysis = dependencies.store.appendReading(sessionId, document, mappingStatus);
          emit({ type: "fields", analysis });
          return analysis;
        };
        identityTask = abortable(Promise.resolve().then(() => { checkCancelled(identitySignal); return dependencies.readIdentity(image, identitySignal); }), identitySignal)
          .then(result => {
            checkCancelled(work.signal);
            if (identified || sessionId) return;
            identity = result;
            identified = true;
            emit({ type: "identity", identity: result });
            emit({ type: "stage", stage: "mapping" });
          }).catch(() => { /* The complete field reading supplies a safe identity fallback. */ });
        const document = await abortable(Promise.resolve().then(() => {
          checkCancelled(work.signal);
          return dependencies.readDocument(image, work.signal, reading => {
            if (work.signal.aborted || disconnected || finished || mappingComplete || !reading.fields.length) return;
            publishReading(reading, "in_progress");
          });
        }), work.signal);
        checkCancelled(work.signal);
        mappingComplete = true;
        publishReading(document, "completed");
        if (dependencies.readLegalReferences && dependencies.resolveLegalContext) {
          const analysisId = sessionId!;
          dependencies.store.updateLegal(analysisId, legalState("pending"));
          emit({ type: "legal_started", analysisId });
          legalTask = (async () => {
            try {
              const hints = await abortable(dependencies.readLegalReferences!(image, work.signal), work.signal);
              checkCancelled(work.signal);
              dependencies.store.updateLegal(analysisId, legalState("pending", hints));
              emit({ type: "legal_reference", analysisId, references: hints.references });
              const resolved = await abortable(dependencies.resolveLegalContext!(hints, work.signal), work.signal);
              const legal = dependencies.enrichLegalContext ? await abortable(dependencies.enrichLegalContext(resolved, work.signal, { document: { title: document.title, fieldLabels: document.fields.map(field => field.label) }, client: configuredLegalClient }), work.signal) : resolved;
              checkCancelled(work.signal);
              const analysis = dependencies.store.updateLegal(analysisId, legal);
              emit(legal.status === "unavailable" ? { type: "legal_unavailable", analysis } : { type: "legal_complete", analysis });
            } catch {
              if (work.signal.aborted || disconnected || finished) return;
              const record = dependencies.store.get(analysisId);
              if (!record) return;
              const analysis = dependencies.store.updateLegal(analysisId, { ...legalState("unavailable", { references: record.analysis.legal?.detectedReferences ?? [] }), warnings: ["법령 정보를 확인하지 못했어요."] });
              emit({ type: "legal_unavailable", analysis });
            }
          })();
        }
        emit({ type: "stage", stage: "searching" });
        const search = await abortable(Promise.resolve().then(() => {
          checkCancelled(work.signal);
          const record = dependencies.store.get(sessionId!);
          if (!record) throw new InputError("SESSION_EXPIRED", 410);
          return dependencies.searchDocument(record.analysis.document, work.signal);
        }), work.signal);
        checkCancelled(work.signal);
        const analysis = dependencies.store.updateSearch(sessionId!, search);
        await legalTask;
        checkCancelled(work.signal);
        const completed = dependencies.store.get(sessionId!)?.analysis ?? analysis;
        finished = true;
        emit({ type: "complete", analysis: completed });
        controller.close();
      } catch (error) {
        work.abort(); identifying.abort();
        if (!disconnected) {
          let terminalError = error;
          let terminal: AnalysisEvent | undefined;
          if (sessionId) {
            try { terminal = { type: "complete", analysis: retainAvailableFields() }; }
            catch (expired) { terminalError = expired; }
          }
          if (!terminal) terminal = { type: "error", ...await errorResponse(terminalError).json() as { code: string; error: string } };
          if (!disconnected) {
            finished = true;
            controller.enqueue(encoder.encode(JSON.stringify(terminal) + "\n"));
            controller.close();
          }
        }
      } finally {
        identifying.abort();
        await Promise.allSettled([identityTask, legalTask]);
        finished = true;
        cleanup();
      }
    },
    cancel() { disconnect(); },
  });
  return new Response(stream, { headers: { "Content-Type": "application/x-ndjson; charset=utf-8", "Cache-Control": "no-store, no-transform", "X-Content-Type-Options": "nosniff" } });
}
